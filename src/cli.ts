#!/usr/bin/env node
/**
 * dsh-bridge：跨 preset 会话迁移的命令行入口。
 *
 * **日常使用请在会话里打 `/bridge <preset>`**（见 src/command.ts）——那条路走
 * 进程内的 `ctx.apiProxy`，不需要端口也不需要环境变量。
 *
 * 这个 CLI 是手动 / 脚本路径：从 minimal 之类拿不到命令面的地方迁出来、
 * 在终端里批量操作、或者给评测 harness 复用同一套编排。会话身份取自
 * `DSH_SESSION_ID`（模型 shell 环境里有），网关地址取自 `DSH_WEB_URL`。
 *
 *   node <pkg>/lib/cli.js presets
 *   node <pkg>/lib/cli.js preview --to code
 *   node <pkg>/lib/cli.js migrate --to code --summary-file <预览给出的路径>
 *   node <pkg>/lib/cli.js doctor
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SOURCE_CHAR_BUDGET, SUMMARY_CHAR_BUDGET, estimateSummaryTokens } from './compression.ts';
import {
  executeMigration,
  findSession,
  listPresets,
  migratedTitle,
  previewMigration,
  resolveWorkerModel,
  titleOf,
  type InjectMode,
  type Lang,
  type ModelTier,
} from './migrate.ts';
import { RpcError, createRpc, resolveApiBase } from './rpc.ts';

interface Args {
  command: string;
  flags: Map<string, string | true>;
}

const HELP = `dsh-bridge · 跨 preset 会话迁移

用法：
  dsh-bridge presets                          列出可迁入的模式
  dsh-bridge preview --to <preset>            生成交接摘要并打印（不改动任何会话）
  dsh-bridge migrate --to <preset> --summary-file <path>
                                              用（可能已编辑过的）摘要建新会话并交接
  dsh-bridge run --to <preset>                预览 + 迁移一步到位（无人值守时用）
  dsh-bridge doctor                           自检：网关、会话身份、可用模式

通用参数：
  --session <id>        源会话 id（默认取环境变量 DSH_SESSION_ID）
  --api <url>           网关地址（默认 DSH_API，其次 DSH_WEB_URL/api，其次 127.0.0.1:3080/api）
  --json                输出 JSON，便于程序消费
  --quiet               不打印进度

preview / run：
  --tier <flash|current|pro>   压缩档位（默认 pro）
  --provider <id> --model <id> 直接指定压缩模型，跳过档位推断
  --lang <zh|en|auto>          摘要语言（默认 auto，跟着会话内容走）
  --source-budget <n>          取材字符预算（默认 ${SOURCE_CHAR_BUDGET}）
  --summary-budget <n>         摘要字符预算（默认 ${SUMMARY_CHAR_BUDGET}）
  --poll-ms <n>                轮询工人是否跑完的间隔（默认 2000，调试用）
  --worker-timeout <ms>        工人单轮上限（默认 360000）

migrate / run：
  --summary-file <path>        摘要正文（migrate 必填；run 忽略）
  --goal-rounds <n>            目标自主轮次上限（默认 1；上游部署默认是 256）
  --inject <goal|prompt|both>  摘要注入方式（默认 both）
  --continue                   复述后自动继续；默认复述后暂停等待确认
  --no-kickoff                 不发首轮交接指令
  --title <text>               新会话标题（默认「<原标题> → <preset>」）
`;

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq > 0) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { command: positional[0] ?? 'help', flags };
}

function str(args: Args, key: string): string | undefined {
  const value = args.flags.get(key);
  return typeof value === 'string' ? value : undefined;
}

function num(args: Args, key: string): number | undefined {
  const value = str(args, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new UsageError(`--${key} 需要一个数字，收到 "${value}"`);
  return parsed;
}

function bool(args: Args, key: string): boolean {
  return args.flags.has(key);
}

class UsageError extends Error {}

function resolveSessionId(args: Args): string {
  const explicit = str(args, 'session');
  if (explicit) return explicit;
  const fromEnv = process.env.DSH_SESSION_ID;
  if (fromEnv) return fromEnv;
  throw new UsageError(
    '取不到当前会话 id。dsh 的模型 shell 环境会自动注入 DSH_SESSION_ID；'
    + '如果你是在普通终端里手动跑，请用 --session <id> 指定（`dsh-bridge doctor` 会列出候选）。',
  );
}

function tierOf(args: Args): ModelTier {
  const value = str(args, 'tier') ?? 'pro';
  if (value !== 'flash' && value !== 'current' && value !== 'pro') {
    throw new UsageError(`--tier 只能是 flash / current / pro，收到 "${value}"`);
  }
  return value;
}

function langOf(args: Args): Lang {
  const value = str(args, 'lang') ?? 'auto';
  if (value !== 'zh' && value !== 'en' && value !== 'auto') {
    throw new UsageError(`--lang 只能是 zh / en / auto，收到 "${value}"`);
  }
  return value;
}

function injectOf(args: Args): InjectMode {
  const value = str(args, 'inject') ?? 'both';
  if (value !== 'goal' && value !== 'prompt' && value !== 'both') {
    throw new UsageError(`--inject 只能是 goal / prompt / both，收到 "${value}"`);
  }
  return value;
}

function requireTarget(args: Args): string {
  const to = str(args, 'to');
  if (!to) throw new UsageError('缺少 --to <preset>。先跑 `dsh-bridge presets` 看有哪些模式。');
  return to;
}

function writeSummaryFile(sessionId: string, summary: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
  const file = join(dir, `summary-${sessionId.slice(0, 12)}.md`);
  writeFileSync(file, summary, 'utf8');
  return file;
}

/* ------------------------------------------------------------------ 命令 */

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === 'help' || bool(args, 'help')) {
    process.stdout.write(HELP);
    return 0;
  }

  const json = bool(args, 'json');
  const quiet = bool(args, 'quiet') || json;
  const api = resolveApiBase(str(args, 'api'));
  const rpc = createRpc({ api, prefix: 'bridge-cli' });
  const progress = (message: string): void => {
    if (!quiet) process.stderr.write(`… ${message}\n`);
  };
  const out = (value: unknown, human: () => string): void => {
    process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : human());
  };

  switch (args.command) {
    case 'doctor': {
      const report: Record<string, unknown> = { api, sessionIdFromEnv: process.env.DSH_SESSION_ID ?? null };
      try {
        const presets = await listPresets(rpc);
        report.gateway = 'ok';
        report.presets = presets.map((p) => p.id);
      } catch (error) {
        report.gateway = error instanceof Error ? error.message : String(error);
      }
      const sessionId = str(args, 'session') ?? process.env.DSH_SESSION_ID;
      if (sessionId) {
        const row = await findSession(rpc, sessionId).catch(() => undefined);
        report.session = row ? { sessionId: row.sessionId, agentPreset: row.agentPreset, cwd: row.cwd } : 'not-found';
      }
      out(report, () => {
        const lines = [`网关：${api} — ${String(report.gateway)}`];
        lines.push(`会话 id：${String(report.sessionIdFromEnv ?? '（环境变量 DSH_SESSION_ID 未设置）')}`);
        if (report.session) lines.push(`会话：${JSON.stringify(report.session)}`);
        if (report.presets) lines.push(`可用模式：${(report.presets as string[]).join(' / ')}`);
        return `${lines.join('\n')}\n`;
      });
      return report.gateway === 'ok' ? 0 : 1;
    }

    case 'presets': {
      const sessionId = str(args, 'session') ?? process.env.DSH_SESSION_ID;
      const current = sessionId ? (await findSession(rpc, sessionId).catch(() => undefined))?.agentPreset : undefined;
      const presets = await listPresets(rpc);
      const rows = presets.map((p) => ({ ...p, current: p.id === current }));
      out({ current, presets: rows }, () => {
        const lines = rows.map((p) => {
          const mark = p.current ? '（当前）' : '';
          const name = p.name ? ` ${p.name}` : '';
          const desc = p.description ? ` — ${p.description}` : '';
          return `  ${p.id}${name}${mark}${desc}`;
        });
        return `可迁入的模式：\n${lines.join('\n')}\n`;
      });
      return 0;
    }

    case 'preview': {
      const sessionId = resolveSessionId(args);
      const to = str(args, 'to');
      const result = await previewMigration(rpc, {
        sessionId,
        tier: tierOf(args),
        provider: str(args, 'provider'),
        model: str(args, 'model'),
        sourceCharBudget: num(args, 'source-budget'),
        summaryCharBudget: num(args, 'summary-budget'),
        lang: langOf(args),
        ...(num(args, 'poll-ms') === undefined ? {} : { pollMs: num(args, 'poll-ms') }),
        ...(num(args, 'worker-timeout') === undefined ? {} : { workerTimeoutMs: num(args, 'worker-timeout') }),
        onProgress: progress,
      });
      const file = writeSummaryFile(sessionId, result.summary);
      const cost = estimateSummaryTokens(result.source.text.length, {
        summaryCharBudget: num(args, 'summary-budget'),
      });
      out(
        {
          summary: result.summary,
          summaryFile: file,
          lang: result.lang,
          worker: result.worker,
          capped: result.capped,
          source: {
            chars: result.source.text.length,
            userMessagesUsed: result.source.userMessagesUsed,
            userMessagesTotal: result.source.userMessagesTotal,
            reusedCompaction: result.source.reusedCompaction,
            truncated: result.source.truncated,
            dropped: result.source.dropped,
          },
          estimatedTokens: cost,
          nextCommand: `dsh-bridge migrate --to ${to ?? '<preset>'} --summary-file ${file}`,
        },
        () => {
          const s = result.source;
          const lines = [
            '',
            '─── 交接摘要（请人工过目，尤其是数字与路径）───',
            result.summary,
            '─────────────────────────────────────────────',
            `取材：${s.text.length} 字符 · 用户消息 ${s.userMessagesUsed}/${s.userMessagesTotal} 条`
            + `${s.reusedCompaction ? ' · 复用了 compaction 底稿' : ''}`,
          ];
          if (s.truncated) lines.push(`⚠ 取材因预算被裁剪，受影响分区：${s.dropped.join(' / ')}`);
          if (result.capped) lines.push('⚠ 压缩工人超时被取消，摘要按已产出文本计');
          lines.push(`压缩模型：${result.worker.model || '（会话默认）'}（${result.worker.reason}）`);
          lines.push(`摘要已写入：${file}`);
          lines.push(`确认无误后执行：dsh-bridge migrate --to ${to ?? '<preset>'} --summary-file ${file}`);
          lines.push('');
          return `${lines.join('\n')}\n`;
        },
      );
      return 0;
    }

    case 'migrate': {
      const sessionId = resolveSessionId(args);
      const to = requireTarget(args);
      const file = str(args, 'summary-file');
      if (!file) throw new UsageError('缺少 --summary-file <path>（先跑 `dsh-bridge preview --to ' + to + '`）。');
      let summary: string;
      try {
        summary = readFileSync(file, 'utf8');
      } catch (error) {
        throw new UsageError(`读不到摘要文件 ${file}：${error instanceof Error ? error.message : String(error)}`);
      }
      const source = await findSession(rpc, sessionId).catch(() => undefined);
      const result = await executeMigration(rpc, {
        sessionId,
        to,
        summary,
        goalRounds: num(args, 'goal-rounds'),
        inject: injectOf(args),
        kickoff: !bool(args, 'no-kickoff'),
        autoContinue: bool(args, 'continue'),
        title: str(args, 'title') ?? migratedTitle(titleOf(source), to),
        onProgress: progress,
      });
      out(result, () => {
        const lines = [`已在 ${result.agentPreset} 模式下建好新会话：${result.sessionId}`];
        if (result.kickoffSent) {
          lines.push(result.goalPaused ? '交接目标已暂停；新会话复述后等待你确认。' : '交接目标未暂停。');
        } else {
          lines.push('新会话没有自动启动；请检查警告后手动继续。');
        }
        lines.push('原会话原封不动，随时可以点回去。');
        for (const warning of result.warnings) lines.push(`⚠ ${warning}`);
        return `${lines.join('\n')}\n`;
      });
      return 0;
    }

    case 'run': {
      const sessionId = resolveSessionId(args);
      const to = requireTarget(args);
      const preview = await previewMigration(rpc, {
        sessionId,
        tier: tierOf(args),
        provider: str(args, 'provider'),
        model: str(args, 'model'),
        sourceCharBudget: num(args, 'source-budget'),
        summaryCharBudget: num(args, 'summary-budget'),
        lang: langOf(args),
        ...(num(args, 'poll-ms') === undefined ? {} : { pollMs: num(args, 'poll-ms') }),
        ...(num(args, 'worker-timeout') === undefined ? {} : { workerTimeoutMs: num(args, 'worker-timeout') }),
        onProgress: progress,
      });
      const source = await findSession(rpc, sessionId).catch(() => undefined);
      const result = await executeMigration(rpc, {
        sessionId,
        to,
        summary: preview.summary,
        lang: preview.lang,
        goalRounds: num(args, 'goal-rounds'),
        inject: injectOf(args),
        kickoff: !bool(args, 'no-kickoff'),
        autoContinue: bool(args, 'continue'),
        title: str(args, 'title') ?? migratedTitle(titleOf(source), to),
        onProgress: progress,
      });
      out({ ...result, summary: preview.summary, source: preview.source }, () =>
        `已迁移到 ${result.agentPreset}：${result.sessionId}\n\n${preview.summary}\n`);
      return 0;
    }

    case 'worker-model': {
      // 诊断用：只回答「档位会挑到哪个模型」，不建任何会话。
      const sessionId = resolveSessionId(args);
      const route = await resolveWorkerModel(rpc, sessionId, tierOf(args), {
        provider: str(args, 'provider'),
        model: str(args, 'model'),
      });
      out(route, () => `${route.provider} / ${route.model}（${route.reason}）\n`);
      return 0;
    }

    default:
      process.stderr.write(`未知命令 "${args.command}"\n\n${HELP}`);
      return 2;
  }
}

const exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (error instanceof RpcError) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  return 1;
});
process.exit(exitCode);
