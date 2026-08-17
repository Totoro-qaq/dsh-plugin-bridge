#!/usr/bin/env node
/**
 * Bridge 迁移评测 harness：复刻客户端全链路（history → 压缩 → goal 注入 → 探针 → 漂移）。
 *
 * 前置：本地跑着 `dsh web`（默认 http://127.0.0.1:3080，可用 DSH_API 覆盖），
 *       且 host 已配好模型凭据（评测消耗的是你自己的 token，不进 CI）。
 *
 * 用法：
 *   node eval/run.mjs [并发=2]            # 全量：测试集矩阵 + 源对照 + 验证集
 *   BRIDGE_ONLY='^T0[13]$' node eval/run.mjs
 *   DSH_API=http://127.0.0.1:3080/api node eval/run.mjs 3
 *
 * 输出：reports/eval-<timestamp>.jsonl（逐 run）+ .raw.json（汇总）。
 */
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { foldSessionEvents } from './fold.ts';
import {
  buildBridgeSource,
  buildBridgeInstruction,
  buildBridgeKickoff,
} from '../src/compression.ts';

const API = (process.env.DSH_API ?? 'http://127.0.0.1:3080/api').replace(/\/$/, '');
const TZ = process.env.TZ_NAME ?? 'Asia/Shanghai';
const CONCURRENCY = Number(process.argv[2] ?? 2);
const MAX_RETRY = 1;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = new URL('../reports/', import.meta.url).pathname;
const JSONL = `${OUT_DIR}eval-${STAMP}.jsonl`;

/* 单轮上限：超时即 session.cancel，按已产出文本计分并记 caps（防 agentic preset 跑飞）。 */
const CAPS = { plant: 150_000, worker: 360_000, target: 240_000 };

const MODELS = { flash: 'deepseek-v4-flash', pro: 'deepseek-v4-pro' };
const PROVIDER = 'deepseek-official';
const PRESETS = ['standard', 'code', 'minimal', 'cordis'];

let rpcSeq = 0;
async function rpc(method, payload = {}, timeoutMs = 30_000) {
  const rpcId = `eval-${++rpcSeq}`;
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  const env = await res.json();
  if (env.rpcId !== rpcId) throw new Error(`${method} rpcId mismatch`);
  if (!env.result.ok) throw new Error(`${method} ${env.result.error?.code}: ${env.result.error?.message}`);
  return env.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIdle(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  await sleep(2000);
  while (Date.now() < deadline) {
    const page = await rpc('session.list', {}).catch(() => null);
    const row = page?.items?.find((i) => i.sessionId === sessionId);
    if (row && !row.running) return true;
    await sleep(2500);
  }
  return false;
}

async function promptCap(sessionId, text, capMs) {
  await rpc('session.prompt', {
    sessionId, mode: 'queue',
    content: [{ type: 'text', text }],
    clientTimeZone: TZ,
  });
  if (await waitIdle(sessionId, capMs)) return false;
  await rpc('session.cancel', { sessionId }).catch(() => undefined);
  await sleep(2500);
  return true;
}

async function lastAssistantText(sessionId) {
  const page = await rpc('session.history', { sessionId, maxMessages: 20 });
  const folded = foldSessionEvents(page.events.map((e) => e.event));
  return [...folded].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content.trim() ?? '';
}

async function foldedMessages(sessionId) {
  const page = await rpc('session.history', { sessionId, maxMessages: 60 });
  return foldSessionEvents(page.events.map((e) => e.event));
}

async function tokenUsage(sessionId) {
  const page = await rpc('session.list', {}).catch(() => null);
  const u = page?.items?.find((i) => i.sessionId === sessionId)?.projections?.values?.tokenUsage;
  return u ? { in: u.uncachedInputTokens ?? 0, out: u.outputTokens ?? 0, cacheRead: u.cacheReadTokens ?? 0 } : null;
}

/* ---------- 数据集 → run 矩阵 ---------- */
const fill = (tpl, t) =>
  tpl.replaceAll('{name}', t.name).replaceAll('{port}', t.port).replaceAll('{db}', t.db)
    .replaceAll('{ban}', t.ban).replaceAll('{path}', t.path).replaceAll('{lang}', t.lang);

async function loadDataset(name) {
  return JSON.parse(await readFile(new URL(`../datasets/${name}.json`, import.meta.url), 'utf8'));
}

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
  return runs.map((r, i) => ({ ...r, id: `${r.set}${String(i + 1).padStart(2, '0')}` }));
}

const SECTIONS = ['## 目标', '## 当前状态', '## 关键决策', '## 关键文件', '## 下一步'];
const hit = (text, variants) => {
  const lower = text.toLowerCase();
  return variants.some((v) => lower.includes(String(v).toLowerCase()));
};
const score = (text, facts) => facts.filter((f) => hit(text, f.expect)).length;

async function runOnce(r, workspaceId) {
  const t = r.theme;
  const rec = {
    id: r.id, set: r.set, tier: r.tier, from: r.from, to: r.to, theme: t.name,
    factsTotal: t.facts.length, summaryHits: 0, kickoffHits: 0, probeHits: 0, driftHits: 0,
    sectionsHit: 0, summaryChars: 0, truncated: false, retried: false,
    tokens: { plant: null, worker: null, target: null }, ms: 0, error: null,
  };
  const cleanup = [];
  const t0 = Date.now();
  try {
    const src = await rpc('session.create', { workspaceId, agentPreset: r.from });
    cleanup.push(src.sessionId);
    if (await promptCap(src.sessionId, fill(r.templates.plant, t), CAPS.plant)) rec.caps = [...(rec.caps ?? []), 'plant'];
    rec.tokens.plant = await tokenUsage(src.sessionId);

    const source = buildBridgeSource(await foldedMessages(src.sessionId));
    rec.truncated = source.truncated;

    const worker = await rpc('session.create', { workspaceId, agentPreset: 'minimal' });
    cleanup.push(worker.sessionId);
    await rpc('session.selectModel', { sessionId: worker.sessionId, provider: PROVIDER, model: MODELS[r.tier] });
    if (await promptCap(worker.sessionId, `${buildBridgeInstruction('zh')}${source.text}`, CAPS.worker)) rec.caps = [...(rec.caps ?? []), 'worker'];
    const summary = await lastAssistantText(worker.sessionId);
    if (!summary) throw new Error('worker-empty');
    rec.tokens.worker = await tokenUsage(worker.sessionId);
    rec.summaryChars = summary.length;
    rec.sectionsHit = SECTIONS.filter((s) => summary.includes(s)).length;
    rec.summaryHits = score(summary, t.facts);

    const dst = await rpc('session.create', { workspaceId, agentPreset: r.to });
    cleanup.push(dst.sessionId);
    await rpc('goal.create', { sessionId: dst.sessionId, objective: summary });
    if (await promptCap(dst.sessionId, buildBridgeKickoff('zh'), CAPS.target)) rec.caps = [...(rec.caps ?? []), 'kickoff'];
    rec.kickoffHits = score(await lastAssistantText(dst.sessionId), t.facts);

    if (await promptCap(dst.sessionId, r.templates.probe, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'probe'];
    rec.probeHits = score(await lastAssistantText(dst.sessionId), t.facts);

    if (await promptCap(dst.sessionId, r.templates.drift, CAPS.target)) rec.caps = [...(rec.caps ?? []), 'drift'];
    rec.driftHits = score(await lastAssistantText(dst.sessionId), t.facts);
    rec.tokens.target = await tokenUsage(dst.sessionId);
  } catch (err) {
    rec.error = err instanceof Error ? err.message : String(err);
  } finally {
    for (const sid of cleanup) await rpc('workspace.archiveSession', { sessionId: sid }).catch(() => undefined);
    rec.ms = Date.now() - t0;
  }
  return rec;
}

async function runCase(r, workspaceId) {
  let rec = await runOnce(r, workspaceId);
  if (rec.error && MAX_RETRY > 0) {
    const again = await runOnce(r, workspaceId);
    again.retried = true;
    if (!again.error) rec = again;
  }
  return rec;
}

await mkdir(OUT_DIR, { recursive: true });
let workspaceId;
try {
  const ws = await rpc('workspace.list', {});
  workspaceId = (ws?.items ?? ws?.workspaces ?? [])[0]?.workspaceId;
} catch { workspaceId = undefined; }

const all = await buildRuns();
const only = process.env.BRIDGE_ONLY ? new RegExp(process.env.BRIDGE_ONLY) : null;
const runs = only ? all.filter((r) => only.test(r.id)) : all;
console.log(`runs=${runs.length} concurrency=${CONCURRENCY} api=${API} workspace=${workspaceId ?? '(default)'}`);

const results = [];
let cursor = 0;
async function lane() {
  while (cursor < runs.length) {
    const r = runs[cursor++];
    const rec = await runCase(r, workspaceId);
    results.push(rec);
    await appendFile(JSONL, `${JSON.stringify(rec)}\n`);
    console.log(
      `${rec.id} ${rec.tier} ${rec.from}→${rec.to} [${rec.theme}] ` +
      (rec.error ? `ERROR ${rec.error}` : `摘${rec.summaryHits} 复述${rec.kickoffHits} 探${rec.probeHits} 漂${rec.driftHits}/${rec.factsTotal} 构${rec.sectionsHit}/5`) +
      `${rec.caps?.length ? ` 限速:${rec.caps.join('/')}` : ''} ${(rec.ms / 1000).toFixed(0)}s${rec.retried ? ' (重试)' : ''}`,
    );
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, lane));
await writeFile(`${OUT_DIR}eval-${STAMP}.raw.json`, JSON.stringify(results, null, 2));
console.log(`\n原始数据: ${OUT_DIR}eval-${STAMP}.raw.json`);
