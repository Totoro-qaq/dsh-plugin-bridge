/**
 * `/bridge` —— 人发起的跨 preset 迁移命令。
 *
 * 这是本插件的主入口，形状对齐上游 `dsh-plan-mode` 的 `/plan`：命令由 UI 直接
 * 派发给注册表，**不经过模型**，命令结果也不进模型历史。于是
 *
 *   - 不需要模型「愿意」加载什么东西，也不需要 bash 或环境变量；
 *   - `minimal` 这种没有 skill 工具的 preset 照样能发起迁移；
 *   - 结果文本只给人看，原会话的上下文一个字都不动。
 *
 * 上游 `session.prompt` 的契约保证了这一点：「A prompt whose content is exactly
 * one text block starting with '/' is a slash command: the host executes it
 * through the command registry (mode-agnostic) and it is never sent to the
 * model.」——所以在官方 WebUI 的输入框里打 `/bridge code` 就能用。
 */
import {
  executeMigration,
  findSession,
  listPresets,
  migratedTitle,
  previewMigration,
  titleOf,
  type InjectMode,
  type Lang,
  type ModelTier,
  type PresetRow,
  type SessionRow,
} from './migrate.ts';
import type { MethodProbe } from './api-rpc.ts';
import { RpcError, type Rpc } from './rpc.ts';

/** 命令处理器从注册表拿到的东西（结构化声明，不 import 上游类型）。 */
export interface BridgeInvocation {
  agent?: { session?: { id?: string; header?: { id?: string } } };
  rawInput?: string;
  /**
   * rc.8 起注册表会传这个字段（随命令提交的图片块）。`/bridge` 没有声明
   * `input.images`，所以带图片的调用会在进入这里之前就被注册表挡下来；
   * 声明出来只是为了让类型如实反映上游传了什么。
   */
  attachments?: readonly unknown[];
  signal?: AbortSignal;
}

export type BridgeResult =
  | { kind: 'success'; text?: string }
  | { kind: 'error'; text: string };

export interface BridgeCommandConfig {
  modelTier: ModelTier;
  sourceCharBudget: number;
  summaryCharBudget: number;
  goalRounds: number;
  inject: InjectMode;
  lang: Lang;
  workerProvider?: string;
  workerModel?: string;
  /** 命令路径下等压缩工人的上限。命令是同步返回的，不能等太久。 */
  previewTimeoutMs: number;
}

export interface BridgeCommandDeps {
  /** 按本次调用的取消信号建一个 Rpc。 */
  rpcFor: (signal?: AbortSignal) => Rpc;
  /** 自检：这套 host 的网关面还是不是插件预期的形状。 */
  probe?: () => MethodProbe[];
  config: BridgeCommandConfig;
  /** 摘要落盘，返回路径；给「改完再执行」这条路用。失败返回 undefined。 */
  writeSummary?: (sessionId: string, summary: string) => string | undefined;
  readSummary?: (path: string) => string;
  now?: () => number;
}

/** 预览与执行之间暂存的摘要。 */
interface Pending {
  preset: string;
  summary: string;
  lang: 'zh' | 'en';
  file?: string;
  at: number;
}

/** 暂存有效期：超过就要求重新预览，免得拿一份很旧的摘要迁过去。 */
const PENDING_TTL_MS = 30 * 60_000;

interface ParsedInput {
  preset?: string;
  go: boolean;
  doctor: boolean;
  autoContinue: boolean;
  tier?: ModelTier;
  lang?: Lang;
  inject?: InjectMode;
  goalRounds?: number;
  file?: string;
  help: boolean;
  error?: string;
}

/** `<preset> [--go] [--continue] [--tier x] [--lang l] [--inject m] [--goal-rounds n] [--file p]` */
export function parseBridgeInput(rawInput: string): ParsedInput {
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
  const out: ParsedInput = { go: false, help: false, doctor: false, autoContinue: false };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (!token.startsWith('--')) {
      if (out.preset === undefined) out.preset = token;
      else return { ...out, error: `多余的参数 "${token}"` };
      continue;
    }
    const eq = token.indexOf('=');
    const key = eq > 0 ? token.slice(2, eq) : token.slice(2);
    const inlineValue = eq > 0 ? token.slice(eq + 1) : undefined;
    const take = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = tokens[i + 1];
      if (next === undefined || next.startsWith('--')) return undefined;
      i += 1;
      return next;
    };
    switch (key) {
      case 'go': out.go = true; break;
      case 'help': out.help = true; break;
      case 'doctor': out.doctor = true; break;
      case 'continue': out.autoContinue = true; break;
      case 'tier': {
        const value = take();
        if (value !== 'flash' && value !== 'current' && value !== 'pro') {
          return { ...out, error: `--tier 只能是 flash / current / pro` };
        }
        out.tier = value;
        break;
      }
      case 'lang': {
        const value = take();
        if (value !== 'zh' && value !== 'en' && value !== 'auto') return { ...out, error: '--lang 只能是 zh / en / auto' };
        out.lang = value;
        break;
      }
      case 'inject': {
        const value = take();
        if (value !== 'goal' && value !== 'prompt' && value !== 'both') return { ...out, error: '--inject 只能是 goal / prompt / both' };
        out.inject = value;
        break;
      }
      case 'goal-rounds': {
        const value = Number(take());
        if (!Number.isFinite(value) || value < 1) return { ...out, error: '--goal-rounds 需要一个 ≥1 的数字' };
        out.goalRounds = value;
        break;
      }
      case 'file': {
        const value = take();
        if (!value) return { ...out, error: '--file 需要一个路径' };
        out.file = value;
        break;
      }
      default:
        return { ...out, error: `不认识的参数 --${key}` };
    }
  }
  return out;
}

type DisplayLang = 'zh' | 'en';

function displayLang(lang: Lang | undefined): DisplayLang {
  return lang === 'en' ? 'en' : 'zh';
}

function usage(presets: PresetRow[], current: string | undefined, lang: DisplayLang): string {
  const targets = presets.filter((p) => p.id !== current).map((p) => p.id);
  if (lang === 'en') {
    return [
      'Usage:',
      '  /bridge <preset>          Preview a handoff without changing either session',
      '  /bridge <preset> --go     Migrate after review; the new session restates and waits',
      '  /bridge <preset> --go --continue  Restate and continue in the same model request',
      '',
      `Available: ${targets.length ? targets.join(' · ') : '(no other presets in this deployment)'}`,
      ...(current ? [`Current: ${current}`] : []),
      '',
      'Options: --continue · --tier flash|current|pro · --lang zh|en|auto · --goal-rounds N · --file <edited-summary>',
      'Check: /bridge --doctor',
    ].join('\n');
  }
  return [
    '用法：',
    '  /bridge <模式>          生成交接摘要给你过目（不改动任何会话）',
    '  /bridge <模式> --go     确认后迁移；新会话复述理解后暂停',
    '  /bridge <模式> --go --continue  同一轮复述并继续下一步',
    '',
    `可迁入：${targets.length ? targets.join(' · ') : '（这套部署没有其他 preset）'}`,
    ...(current ? [`当前：${current}`] : []),
    '',
    '可选：--continue · --tier flash|current|pro · --lang zh|en|auto · --goal-rounds N · --file <改过的摘要文件>',
    '排查：/bridge --doctor',
  ].join('\n');
}

function commandMetadata(lang: Lang): { description: string; hint: string } {
  if (lang === 'en') {
    return {
      description: 'Migrate this session to another tool preset while keeping the original untouched',
      hint: '<preset> [--go] [--continue] | --doctor',
    };
  }
  if (lang === 'zh') {
    return {
      description: '把这个会话迁移到另一工具 preset，原会话保持不动',
      hint: '<模式> [--go] [--continue] | --doctor',
    };
  }
  return {
    description: 'Migrate across tool presets; keep the original untouched · 跨 preset 迁移会话，原会话保持不动',
    hint: '<preset/模式> [--go] [--continue] | --doctor',
  };
}

/** 建一个 `/bridge` 命令定义。返回值形状对齐上游 `CommandDefinition`。 */
export function createBridgeCommand(deps: BridgeCommandDeps): {
  name: string;
  description: string;
  input: { hint: string };
  handler: (invocation: BridgeInvocation) => Promise<BridgeResult>;
} {
  const pending = new Map<string, Pending>();
  const now = deps.now ?? (() => Date.now());
  const metadata = commandMetadata(deps.config.lang);

  return {
    name: 'bridge',
    description: metadata.description,
    input: { hint: metadata.hint },
    handler: async (invocation: BridgeInvocation): Promise<BridgeResult> => {
      const sessionId = invocation.agent?.session?.id ?? invocation.agent?.session?.header?.id;
      if (!sessionId) return { kind: 'error', text: '取不到当前会话身份，无法迁移。' };

      const parsed = parseBridgeInput(invocation.rawInput ?? '');
      const initialLang = displayLang(parsed.lang ?? deps.config.lang);
      if (parsed.error) {
        return {
          kind: 'error',
          text: initialLang === 'en' ? `${parsed.error}\n\nUse /bridge to see the available syntax.` : `${parsed.error}\n\n用 /bridge 看用法。`,
        };
      }

      const rpc = deps.rpcFor(invocation.signal);
      const config = deps.config;

      let presets: PresetRow[];
      let sourceSession: SessionRow | undefined;
      let current: string | undefined;
      try {
        presets = await listPresets(rpc);
        sourceSession = await findSession(rpc, sessionId);
        current = sourceSession?.agentPreset;
      } catch (error) {
        return { kind: 'error', text: describe(error) };
      }

      if (parsed.doctor) {
        const probes = deps.probe?.() ?? [];
        const missing = probes.filter((probe) => !probe.available).map((probe) => probe.method);
        const available = presets.filter((p) => p.id !== current).map((p) => p.id).join(' · ');
        const lines = initialLang === 'en'
          ? [
              `Gateway: in-process ctx.apiProxy · ${probes.length - missing.length}/${probes.length} methods available`,
              `Current preset: ${current ?? '(unavailable)'}`,
              `Available targets: ${available || '(none)'}`,
              `Config: tier ${config.modelTier} · source ${config.sourceCharBudget} chars · summary ${config.summaryCharBudget} chars`
              + ` · goal ${config.goalRounds} rounds · injection ${config.inject}`,
            ]
          : [
              `网关：进程内 ctx.apiProxy · ${probes.length - missing.length}/${probes.length} 个方法可用`,
              `当前模式：${current ?? '（读不到）'}`,
              `可迁入：${available || '（无）'}`,
              `配置：档位 ${config.modelTier} · 取材 ${config.sourceCharBudget} 字符 · 摘要 ${config.summaryCharBudget} 字符`
              + ` · goal ${config.goalRounds} 轮 · 注入 ${config.inject}`,
            ];
        if (missing.length) {
          lines.push('');
          if (initialLang === 'en') {
            lines.push(`⚠ Missing: ${missing.join(', ')}`);
            lines.push('This host gateway does not match the plugin contract; the upstream API is still a developer preview.');
            lines.push('Report your dsh version at https://github.com/Totoro-qaq/dsh-plugin-bridge/issues.');
          } else {
            lines.push(`⚠ 缺少：${missing.join(', ')}`);
            lines.push('这套 host 的网关面和插件预期的不一致（上游是 developer preview，接口会变）。');
            lines.push('请到 https://github.com/Totoro-qaq/dsh-plugin-bridge/issues 报一下你的 dsh 版本。');
          }
          return { kind: 'error', text: lines.join('\n') };
        }
        return { kind: 'success', text: lines.join('\n') };
      }

      if (parsed.help || !parsed.preset) return { kind: 'success', text: usage(presets, current, initialLang) };

      const target = parsed.preset;
      if (!presets.some((p) => p.id === target)) {
        return {
          kind: 'error',
          text: initialLang === 'en'
            ? `No usable preset named "${target}".\n\n${usage(presets, current, initialLang)}`
            : `没有叫 "${target}" 的模式（或者它当前是坏的）。\n\n${usage(presets, current, initialLang)}`,
        };
      }
      if (target === current) {
        return { kind: 'error', text: initialLang === 'en' ? `This session already uses the ${target} preset.` : `这个会话已经在 ${target} 模式了。` };
      }

      /* ---------------- 执行 ---------------- */
      if (parsed.go) {
        let summary: string | undefined;
        let pendingLang: DisplayLang | undefined;
        if (parsed.file) {
          try {
            summary = deps.readSummary?.(parsed.file);
          } catch (error) {
            return { kind: 'error', text: initialLang === 'en' ? `Cannot read ${parsed.file}: ${describe(error)}` : `读不到 ${parsed.file}：${describe(error)}` };
          }
        } else {
          const stashed = pending.get(sessionId);
          if (stashed && stashed.preset === target && now() - stashed.at < PENDING_TTL_MS) {
            summary = stashed.summary;
            pendingLang = stashed.lang;
          }
        }
        const runLang = parsed.lang === 'en' || parsed.lang === 'zh' ? parsed.lang : pendingLang ?? initialLang;
        const source = parsed.file ?? (runLang === 'en' ? 'the reviewed preview' : '暂存的预览');
        if (!summary?.trim()) {
          return {
            kind: 'error',
            text: runLang === 'en'
              ? `No usable handoff is available; the preview may have expired. Run /bridge ${target}, review it, then add --go.`
              : `没有可用的摘要（预览可能已过期）。先跑 /bridge ${target} 看一眼，确认后再 --go。`,
          };
        }
        try {
          const sourceTitle = titleOf(sourceSession);
          const targetTitle = sourceTitle ? migratedTitle(sourceTitle, target) : (runLang === 'en' ? `Migrated to ${target}` : migratedTitle(sourceTitle, target));
          const result = await executeMigration(rpc, {
            sessionId,
            sourceSession,
            to: target,
            summary,
            goalRounds: parsed.goalRounds ?? config.goalRounds,
            inject: parsed.inject ?? config.inject,
            title: targetTitle,
            autoContinue: parsed.autoContinue,
            lang: runLang,
          });
          pending.delete(sessionId);
          const lines = runLang === 'en'
            ? [
                `Created a new session in the ${result.agentPreset} preset from ${source}.`,
                `Target session: ${targetTitle} · ${result.sessionId}`,
                result.kickoffSent
                  ? (parsed.autoContinue
                      ? 'The handoff goal is paused; the new session will restate and continue in the same request without an extra goal round.'
                      : 'The new session will only restate the handoff, then wait for your confirmation.')
                  : 'The new session did not start automatically; inspect the warnings below before continuing manually.',
                'The source session is untouched and remains available; archive the target if the handoff is unsatisfactory.',
              ]
            : [
                `已在 ${result.agentPreset} 模式下建好新会话，摘要来自${source}。`,
                `目标会话：${targetTitle} · ${result.sessionId}`,
                result.kickoffSent
                  ? (parsed.autoContinue
                      ? '交接目标已暂停；新会话会在同一轮复述理解并继续下一步，不触发额外 goal 轮次。'
                      : '新会话只会复述理解，然后暂停等待你确认。')
                  : '新会话没有自动启动；请按下面的警告检查后手动继续。',
                '原会话原封不动，随时点回来；新会话不满意就归档。',
              ];
          if (result.imagesSent) {
            lines.push(runLang === 'en'
              ? `Images: ${result.imagesSent} unresolved source image(s) were attached to the vision target kickoff.`
              : `图片：${result.imagesSent} 张尚未解析的原图已随 kickoff 搬到视觉目标。`);
          }
          for (const warning of result.warnings) lines.push(`⚠ ${warning}`);
          return { kind: 'success', text: lines.join('\n') };
        } catch (error) {
          return { kind: 'error', text: describe(error) };
        }
      }

      /* ---------------- 预览 ---------------- */
      const startedAt = now();
      try {
        const preview = await previewMigration(rpc, {
          sessionId,
          sourceSession,
          tier: parsed.tier ?? config.modelTier,
          sourceCharBudget: config.sourceCharBudget,
          summaryCharBudget: config.summaryCharBudget,
          lang: parsed.lang ?? config.lang,
          workerTimeoutMs: config.previewTimeoutMs,
          pollMs: 750,
          ...(config.workerProvider ? { provider: config.workerProvider } : {}),
          ...(config.workerModel ? { model: config.workerModel } : {}),
        });
        const file = deps.writeSummary?.(sessionId, preview.summary);
        pending.set(sessionId, { preset: target, summary: preview.summary, lang: preview.lang, at: now(), ...(file ? { file } : {}) });

        const s = preview.source;
        const outputLang = preview.lang;
        const lines = outputLang === 'en'
          ? [
              `─── Handoff · ${current ?? 'current preset'} → ${target} (review numbers and paths) ───`,
              preview.summary,
              '───────────────────────────────────────────',
              `Source ${s.text.length} chars · user messages ${s.userMessagesUsed}/${s.userMessagesTotal}`
              + `${s.reusedCompaction ? ' · reused compaction' : ''}`
              + ` · worker ${preview.worker.model || '(session default)'} · ${Math.round((now() - startedAt) / 1000)}s`,
            ]
          : [
              `─── 交接摘要 · ${current ?? '当前模式'} → ${target}（请过目，重点看数字与路径）───`,
              preview.summary,
              '───────────────────────────────────────────',
              `取材 ${s.text.length} 字符 · 用户消息 ${s.userMessagesUsed}/${s.userMessagesTotal} 条`
              + `${s.reusedCompaction ? ' · 复用了 compaction 底稿' : ''}`
              + ` · 压缩模型 ${preview.worker.model || '（会话默认）'} · 用时 ${Math.round((now() - startedAt) / 1000)}s`,
            ];
        if (s.visualEvidence.images) {
          lines.push(outputLang === 'en'
            ? `Images ${s.visualEvidence.images} / ${s.visualEvidence.imageMessages} messages`
              + ` · represented ${s.visualEvidence.represented} · unresolved ${s.visualEvidence.unresolved}`
            : `图片 ${s.visualEvidence.images} 张 / ${s.visualEvidence.imageMessages} 条消息`
              + ` · 有关联原文 ${s.visualEvidence.represented} 条 · 未解析 ${s.visualEvidence.unresolved} 条`);
        }
        if (s.truncated) {
          lines.push(outputLang === 'en'
            ? `⚠ Source material was truncated by budget (${s.dropped.join(' / ')}); this handoff reflects the bounded history.`
            : `⚠ 取材因预算被裁剪（${s.dropped.join(' / ')}），摘要是基于被裁过的历史写的`);
        }
        if (preview.capped) lines.push(outputLang === 'en' ? '⚠ The summary worker timed out; the handoff uses the text produced before cancellation.' : '⚠ 压缩工人超时被取消，摘要按已产出文本计');
        lines.push('');
        lines.push(outputLang === 'en' ? `Review and run: /bridge ${target} --go` : `没问题就执行：/bridge ${target} --go`);
        if (file) {
          lines.push(outputLang === 'en'
            ? `Edit first: update ${file}, then run /bridge ${target} --go --file ${file}`
            : `要改：编辑 ${file} 之后 /bridge ${target} --go --file ${file}`);
        }
        return { kind: 'success', text: lines.join('\n') };
      } catch (error) {
        return { kind: 'error', text: describe(error) };
      }
    },
  };
}

function describe(error: unknown): string {
  if (error instanceof RpcError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
