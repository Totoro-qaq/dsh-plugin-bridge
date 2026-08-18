#!/usr/bin/env node
/**
 * Bridge 迁移评测 harness：复刻**产品代码**的全链路
 * （history → 取材 → 压缩工人 → 目标会话注入 → 探针 → 漂移）。
 *
 * 与 0.1 的关键区别：折叠、取材、RPC、等待空闲、迁移编排全部 import 自 `src/`，
 * 评测跑的就是用户跑的那条路径；harness 只负责埋点、打分与记账。
 *
 * 前置：本地跑着 `dsh web`（默认 http://127.0.0.1:3080，可用 DSH_API 覆盖），
 *       且 host 已配好模型凭据（评测消耗的是你自己的 token，不进 CI）。
 *
 * 用法：
 *   node eval/run.mjs [并发=2]            # 全量：测试集矩阵 + 源对照 + 验证集
 *   BRIDGE_ONLY='电商' node eval/run.mjs   # id 子串/正则筛选
 *   DSH_API=http://127.0.0.1:3080/api node eval/run.mjs 3
 *
 * 对照臂（BRIDGE_ARM）：
 *   summary  完整 bridge 流水线（默认）
 *   bare     裸重开：新会话只带任务标题
 *   guess    猜测基线：不埋点，直接问探针 —— 打分口径的下限，必须减掉它再读命中率
 *   ab       summary + bare 成对
 *   all      三臂齐发
 *
 * 输出：reports/eval-<timestamp>.jsonl（逐 run）+ .raw.json（汇总）。
 */
import { mkdir, mkdtemp, writeFile, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildBridgeInstruction, buildBridgeSource, buildBridgeKickoff } from '../src/compression.ts';
import {
  executeMigration,
  foldedHistory,
  lastAssistantText,
  listSessions,
  resolveWorkerModel,
  resolveWorkerPreset,
  waitIdle,
} from '../src/migrate.ts';
import { createRpc, resolveApiBase, sleep } from '../src/rpc.ts';

const API = resolveApiBase(process.env.DSH_API);
const TZ = process.env.TZ_NAME ?? 'Asia/Shanghai';
const CONCURRENCY = Number(process.argv[2] ?? 2);
const MAX_RETRY = 1;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = new URL('../reports/', import.meta.url).pathname;
const JSONL = `${OUT_DIR}eval-${STAMP}.jsonl`;

const rpc = createRpc({ api: API, prefix: 'eval' });

/* 单轮上限：超时即 session.cancel，按已产出文本计分并记 caps（防 agentic preset 跑飞）。 */
const CAPS = {
  plant: Number(process.env.BRIDGE_CAP_PLANT ?? 150_000),
  worker: Number(process.env.BRIDGE_CAP_WORKER ?? 360_000),
  target: Number(process.env.BRIDGE_CAP_TARGET ?? 240_000),
};
/**
 * 目标会话拿到的 goal 自主轮次上限。
 * 上游默认 256——0.1 的评测没设它，目标会话因此进入自主循环，
 * 这正是「25/26 的 kickoff 轮触顶、单会话均值烧 53 万 tokens」的来源。
 */
const GOAL_ROUNDS = Number(process.env.BRIDGE_GOAL_ROUNDS ?? 1);

const PRESETS = ['standard', 'code', 'minimal', 'cordis'];

const ARM = process.env.BRIDGE_ARM ?? 'summary';
const TIER_FILTER = process.env.BRIDGE_TIER ? new RegExp(process.env.BRIDGE_TIER) : null;
const TO_FILTER = process.env.BRIDGE_TO ? new RegExp(process.env.BRIDGE_TO) : null;

async function promptCap(sessionId, text, capMs) {
  await rpc('session.prompt', {
    sessionId, mode: 'queue',
    content: [{ type: 'text', text }],
    clientTimeZone: TZ,
  });
  const settled = await waitIdle(rpc, sessionId, { timeoutMs: capMs });
  if (settled.idle) return false;
  await rpc('session.cancel', { sessionId }).catch(() => undefined);
  await sleep(2500);
  return true;
}

async function tokenUsage(sessionId) {
  const row = (await listSessions(rpc).catch(() => [])).find((i) => i.sessionId === sessionId);
  const u = row?.projections?.values?.tokenUsage;
  return u ? { in: u.uncachedInputTokens ?? 0, out: u.outputTokens ?? 0, cacheRead: u.cacheReadTokens ?? 0 } : null;
}

/* ---------- 每 run 一个隔离工作区 ----------
 * 0.1 的所有 run 共用 workspace.list() 的第一个工作区，于是对照臂的 agent 能从
 * 磁盘上的 host 会话日志（甚至本仓库的 datasets/*.json）里把埋点事实翻出来，
 * bare→code 因此拿到 9/10 的探针分。空目录 + 用完即删，从根上消除这条污染。 */
async function withWorkspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bridge-eval-'));
  let workspaceId;
  try {
    const created = await rpc('workspace.create', { path: dir });
    workspaceId = created?.workspace?.workspaceId;
  } catch {
    workspaceId = undefined; // 没有工作区注册表的部署：退回按 cwd 建会话
  }
  try {
    return await fn({ workspaceId, cwd: dir });
  } finally {
    if (workspaceId) await rpc('workspace.delete', { workspaceId }).catch(() => undefined);
  }
}

const placement = (ws) => (ws.workspaceId ? { workspaceId: ws.workspaceId } : { cwd: ws.cwd });

/* ---------- 数据集 → run 矩阵 ---------- */
const fill = (tpl, t) =>
  tpl.replaceAll('{name}', t.name).replaceAll('{port}', t.port).replaceAll('{db}', t.db)
    .replaceAll('{ban}', t.ban).replaceAll('{path}', t.path).replaceAll('{lang}', t.lang);

async function loadDataset(name) {
  return JSON.parse(await readFile(new URL(`../datasets/${name}.json`, import.meta.url), 'utf8'));
}

/** 稳定 id：由配置本身派生，加题材不会让历史 id 全部重编号。 */
const idOf = (r) => `${r.set}-${r.tier}-${r.from}→${r.to}-${r.theme.name}`;

async function buildRuns() {
  const test = await loadDataset('test');
  const valid = await loadDataset('validation');
  const runs = [];
  for (const tier of ['flash', 'pro'])
    for (const to of PRESETS)
      for (const t of test.themes)
        runs.push({ set: 'T', tier, from: 'minimal', to, theme: t, templates: test.templates });
  for (const from of PRESETS)
    runs.push({ set: 'C', tier: 'pro', from, to: 'code', theme: test.themes[0], templates: test.templates });
  for (const t of valid.themes)
    for (const d of t.directions)
      runs.push({ set: 'V', tier: d.tier, from: d.from, to: d.to, theme: t, templates: valid.templates });
  let base = runs.map((r) => ({ ...r, id: idOf(r) }));
  if (TIER_FILTER) base = base.filter((r) => TIER_FILTER.test(r.tier));
  if (TO_FILTER) base = base.filter((r) => TO_FILTER.test(r.to));
  const arms = ARM === 'ab' ? ['summary', 'bare'] : ARM === 'all' ? ['summary', 'bare', 'guess'] : [ARM];
  if (arms.length === 1) return base.map((r) => ({ ...r, arm: arms[0] }));
  return base.flatMap((r) => arms.map((arm) => ({ ...r, arm, id: `${r.id}#${arm}` })));
}

const SECTIONS = ['## 目标', '## 当前状态', '## 关键决策', '## 关键文件', '## 下一步'];
const hit = (text, variants) => {
  const lower = text.toLowerCase();
  return variants.some((v) => lower.includes(String(v).toLowerCase()));
};
const score = (text, facts) => facts.filter((f) => hit(text, f.expect)).length;

async function runOnce(r) {
  const t = r.theme;
  const rec = {
    id: r.id, set: r.set, arm: r.arm, tier: r.tier, from: r.from, to: r.to, theme: t.name,
    factsTotal: t.facts.length, summaryHits: 0, kickoffHits: 0, probeHits: 0, driftHits: 0,
    sectionsHit: 0, summaryChars: 0, truncated: false, dropped: [], retried: false,
    tokens: { plant: null, worker: null, target: null }, ms: 0, error: null,
  };
  const t0 = Date.now();
  try {
    return await withWorkspace(async (ws) => {
      const cleanup = [];
      try {
        /* 猜测基线：不埋点，直接开目标会话问探针。任何非零命中都是打分口径的下限。 */
        if (r.arm === 'guess') {
          const dst = await rpc('session.create', { ...placement(ws), agentPreset: r.to });
          cleanup.push(dst.sessionId);
          await rpc('goal.create', { sessionId: dst.sessionId, objective: fill(r.templates.bare, t), maxGoalRounds: GOAL_ROUNDS });
          if (await promptCap(dst.sessionId, r.templates.probeBare, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'probe'];
          rec.probeHits = score(await lastAssistantText(rpc, dst.sessionId), t.facts);
          if (await promptCap(dst.sessionId, r.templates.driftBare, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'drift'];
          rec.driftHits = score(await lastAssistantText(rpc, dst.sessionId), t.facts);
          rec.tokens.target = await tokenUsage(dst.sessionId);
          return rec;
        }

        const src = await rpc('session.create', { ...placement(ws), agentPreset: r.from });
        cleanup.push(src.sessionId);
        if (await promptCap(src.sessionId, fill(r.templates.plant, t), CAPS.plant)) rec.caps = [...(rec.caps ?? []), 'plant'];
        rec.tokens.plant = await tokenUsage(src.sessionId);

        if (r.arm === 'bare') {
          const dst = await rpc('session.create', { ...placement(ws), agentPreset: r.to });
          cleanup.push(dst.sessionId);
          await rpc('goal.create', { sessionId: dst.sessionId, objective: fill(r.templates.bare, t), maxGoalRounds: GOAL_ROUNDS });
          if (await promptCap(dst.sessionId, '请继续。', CAPS.target)) rec.caps = [...(rec.caps ?? []), 'kickoff'];
          rec.kickoffHits = score(await lastAssistantText(rpc, dst.sessionId), t.facts);
          if (await promptCap(dst.sessionId, r.templates.probeBare, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'probe'];
          rec.probeHits = score(await lastAssistantText(rpc, dst.sessionId), t.facts);
          if (await promptCap(dst.sessionId, r.templates.driftBare, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'drift'];
          rec.driftHits = score(await lastAssistantText(rpc, dst.sessionId), t.facts);
          rec.tokens.target = await tokenUsage(dst.sessionId);
          return rec;
        }

        /* summary 臂：与 CLI 完全同一条代码路径。 */
        const messages = await foldedHistory(rpc, src.sessionId);
        const source = buildBridgeSource(messages);
        rec.truncated = source.truncated;
        rec.dropped = source.dropped;

        const preset = await resolveWorkerPreset(rpc);
        const route = await resolveWorkerModel(rpc, src.sessionId, r.tier);
        const worker = await rpc('session.create', { ...placement(ws), agentPreset: preset });
        cleanup.push(worker.sessionId);
        if (route.provider && route.model) {
          await rpc('session.selectModel', { sessionId: worker.sessionId, provider: route.provider, model: route.model })
            .catch(() => undefined);
        }
        if (await promptCap(worker.sessionId, `${buildBridgeInstruction('zh')}${source.text}`, CAPS.worker)) {
          rec.caps = [...(rec.caps ?? []), 'worker'];
        }
        const summary = await lastAssistantText(rpc, worker.sessionId);
        if (!summary) throw new Error('worker-empty');
        rec.tokens.worker = await tokenUsage(worker.sessionId);
        rec.summaryChars = summary.length;
        rec.sectionsHit = SECTIONS.filter((s) => summary.includes(s)).length;
        rec.summaryHits = score(summary, t.facts);
        rec.workerModel = route.model;

        const migrated = await executeMigration(rpc, {
          sessionId: src.sessionId,
          to: r.to,
          summary,
          lang: 'zh',
          goalRounds: GOAL_ROUNDS,
          inject: process.env.BRIDGE_INJECT ?? 'both',
          kickoff: false, // kickoff 由下面的限速轮统一发，便于计时与打分
          title: undefined,
        });
        cleanup.push(migrated.sessionId);
        rec.goalCreated = migrated.goalCreated;

        if (await promptCap(migrated.sessionId, buildBridgeKickoff('zh'), CAPS.target)) rec.caps = [...(rec.caps ?? []), 'kickoff'];
        rec.kickoffHits = score(await lastAssistantText(rpc, migrated.sessionId), t.facts);
        if (await promptCap(migrated.sessionId, r.templates.probe, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'probe'];
        rec.probeHits = score(await lastAssistantText(rpc, migrated.sessionId), t.facts);
        if (await promptCap(migrated.sessionId, r.templates.drift, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'drift'];
        rec.driftHits = score(await lastAssistantText(rpc, migrated.sessionId), t.facts);
        rec.tokens.target = await tokenUsage(migrated.sessionId);
        return rec;
      } finally {
        for (const sid of cleanup) await rpc('workspace.archiveSession', { sessionId: sid }).catch(() => undefined);
      }
    });
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
    return rec;
  } finally {
    rec.ms = Date.now() - t0;
  }
}

async function runCase(r) {
  let rec = await runOnce(r);
  if (rec.error && MAX_RETRY > 0) {
    const again = await runOnce(r);
    again.retried = true;
    rec = again.error ? { ...rec, retried: true } : again;
  }
  return rec;
}

await mkdir(OUT_DIR, { recursive: true });

const all = await buildRuns();
const only = process.env.BRIDGE_ONLY ? new RegExp(process.env.BRIDGE_ONLY) : null;
const runs = only ? all.filter((r) => only.test(r.id)) : all;
console.log(`runs=${runs.length} concurrency=${CONCURRENCY} api=${API} arm=${ARM} goalRounds=${GOAL_ROUNDS}`);

const results = [];
let cursor = 0;
async function lane() {
  while (cursor < runs.length) {
    const r = runs[cursor++];
    const rec = await runCase(r);
    results.push(rec);
    await appendFile(JSONL, `${JSON.stringify(rec)}\n`);
    console.log(
      `${rec.id} ${rec.tier} ${rec.from}→${rec.to} ` +
      (rec.error ? `ERROR ${rec.error}` : `摘${rec.summaryHits} 复述${rec.kickoffHits} 探${rec.probeHits} 漂${rec.driftHits}/${rec.factsTotal} 构${rec.sectionsHit}/5`) +
      `${rec.caps?.length ? ` 限速:${rec.caps.join('/')}` : ''} ${(rec.ms / 1000).toFixed(0)}s${rec.retried ? ' (重试)' : ''}`,
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, lane));
await writeFile(`${OUT_DIR}eval-${STAMP}.raw.json`, JSON.stringify(results, null, 2));
console.log(`\n原始数据: ${OUT_DIR}eval-${STAMP}.raw.json`);
