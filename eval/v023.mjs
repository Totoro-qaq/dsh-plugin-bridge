#!/usr/bin/env node
/**
 * v0.2.3 release acceptance:
 *   short / compacted × minimal / standard / code × confirm / continue
 *
 * Unlike the historical harness, this script exercises executeMigration with
 * kickoff=true so the target receives the exact prompt shipped by v0.2.3.
 * Confirm/continue pairs share one frozen source and summary.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildBridgeInstruction,
  buildBridgeSource,
} from '../src/compression.ts';
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

if (process.env.BRIDGE_E2E_ACK !== '1' || !process.env.DSH_API?.trim()) {
  throw new Error(
    'This live evaluation creates model requests and archives its own sessions. '
    + 'Run it only against an explicit isolated DSH_API with BRIDGE_E2E_ACK=1.',
  );
}

const API = resolveApiBase(process.env.DSH_API);
const TZ = process.env.TZ_NAME ?? 'Asia/Shanghai';
const HARD_TOKEN_BUDGET = Number(process.env.BRIDGE_TOKEN_BUDGET ?? 120_000);
const STOP_SCHEDULING_AT = Number(process.env.BRIDGE_STOP_AT ?? 110_000);
const PROCESSED_CEILING = Number(process.env.BRIDGE_PROCESSED_CEILING ?? 220_000);
const SETUP_USAGE = {
  uncachedInput: Number(process.env.BRIDGE_SETUP_UNCACHED ?? 0),
  cacheRead: Number(process.env.BRIDGE_SETUP_CACHE_READ ?? 0),
  cacheWrite: Number(process.env.BRIDGE_SETUP_CACHE_WRITE ?? 0),
  output: Number(process.env.BRIDGE_SETUP_OUTPUT ?? 0),
};
SETUP_USAGE.nominal = SETUP_USAGE.uncachedInput + SETUP_USAGE.output;
SETUP_USAGE.processed = SETUP_USAGE.nominal + SETUP_USAGE.cacheRead + SETUP_USAGE.cacheWrite;
const SHORT_CONCURRENCY = Number(process.env.BRIDGE_SHORT_CONCURRENCY ?? 3);
const LONG_CONCURRENCY = Number(process.env.BRIDGE_LONG_CONCURRENCY ?? 2);
const SOAK_MS = Number(process.env.BRIDGE_SOAK_MS ?? 12_000);
const WAIT_FOR_RESTART = process.env.BRIDGE_RESTART_CHECK !== '0';
const PREVIOUS_REPORT = process.env.BRIDGE_PREVIOUS_REPORT?.trim() || null;
const EVAL_DSH_HOME = process.env.BRIDGE_DSH_HOME?.trim() || null;
const REUSE_LONG_SOURCES = process.env.BRIDGE_REUSE_LONG_SOURCES
  ? JSON.parse(process.env.BRIDGE_REUSE_LONG_SOURCES)
  : null;
const REUSED_SOURCES_FINALIZED = process.env.BRIDGE_REUSED_SOURCES_FINALIZED === '1';
const USE_FROZEN_COMPACTED = process.env.BRIDGE_USE_FROZEN_COMPACTED === '1';
const TARGET_FIXTURE_IDS = new Set(
  (process.env.BRIDGE_TARGET_FIXTURES ?? '').split(',').map((item) => item.trim()).filter(Boolean),
);
const TARGET_MODES = new Set(
  (process.env.BRIDGE_TARGET_MODES ?? '').split(',').map((item) => item.trim()).filter(Boolean),
);
const CODE_SUMMARY_REPORT = process.env.BRIDGE_CODE_SUMMARY_REPORT?.trim() || null;
const SUMMARY_REPORTS = [
  ...(process.env.BRIDGE_SUMMARY_REPORTS ?? '').split(',').map((item) => item.trim()).filter(Boolean),
  ...(CODE_SUMMARY_REPORT ? [CODE_SUMMARY_REPORT] : []),
];
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = new URL('../reports/', import.meta.url).pathname;
const OUT = `${OUT_DIR}v0.2.3-e2e-${STAMP}.raw.json`;
const MANIFEST = `${OUT_DIR}v0.2.3-e2e-${STAMP}.manifest.json`;

const CAPS = {
  source: Number(process.env.BRIDGE_CAP_SOURCE ?? 180_000),
  compact: Number(process.env.BRIDGE_CAP_COMPACT ?? 240_000),
  worker: Number(process.env.BRIDGE_CAP_WORKER ?? 240_000),
  target: Number(process.env.BRIDGE_CAP_TARGET ?? 180_000),
};

const rpc = createRpc({ api: API, prefix: `v023-${STAMP}` });
const trackedSessions = new Set();
const trackedWorkspaces = new Map();
const usageLedger = new Map();
const usageBaselines = new Map();
const archiveAttempts = [];
let budgetStopped = false;
let reservedTokens = 0;

const FIXTURES = [
  {
    id: 'short-minimal', kind: 'short', target: 'minimal', name: 'Ember lease',
    facts: { port: '43179', db: 'SQLite', ban: 'Redis', path: 'apps/ember/api/lease.v2.ts', prefix: 'EMBER17:' },
  },
  {
    id: 'short-standard', kind: 'short', target: 'standard', name: 'Opal fold',
    facts: { port: '45283', db: 'DuckDB', ban: 'Kafka', path: 'jobs/opal_29/fold.py', prefix: 'OPAL29:' },
  },
  {
    id: 'short-code', kind: 'short', target: 'code', name: 'Quartz checkpoint',
    facts: { port: '46721', db: 'PostgreSQL 17', ban: 'MongoDB', path: 'src/quartz_41/checkpoint.rs', prefix: 'Q41:' },
  },
  {
    id: 'compacted-minimal', kind: 'compacted', target: 'minimal', name: 'Atlas state',
    facts: { port: '51743', db: 'libSQL', ban: 'S3', path: 'services/atlas_73/state.ts', prefix: 'ATLAS73:' },
    old: { ban: 'MinIO', path: 'legacy/atlas/state.js', prefix: 'OLD-ATLAS:' },
  },
  {
    id: 'compacted-standard', kind: 'compacted', target: 'standard', name: 'Nori merge',
    facts: { port: '53609', db: 'ClickHouse', ban: 'Hadoop', path: 'pipelines/nori_88/merge.py', prefix: 'NORI88:' },
    old: { ban: 'Spark', path: 'legacy/nori/merge.scala', prefix: 'OLD-NORI:' },
  },
  {
    id: 'compacted-code', kind: 'compacted', target: 'code', name: 'Vesper window',
    facts: { port: '55837', db: 'TimescaleDB', ban: 'InfluxDB', path: 'crates/vesper_52/src/window.rs', prefix: 'V52:' },
    old: { ban: 'Prometheus', path: 'legacy/vesper/window.go', prefix: 'OLD-V52:' },
  },
];

function zeroUsage() {
  return { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, nominal: 0, processed: 0 };
}

function normalizeUsage(value) {
  const uncachedInput = value?.uncachedInputTokens ?? 0;
  const cacheRead = value?.cacheReadTokens ?? 0;
  const cacheWrite = value?.cacheWriteTokens ?? 0;
  const output = value?.outputTokens ?? 0;
  return {
    uncachedInput, cacheRead, cacheWrite, output,
    nominal: uncachedInput + output,
    processed: uncachedInput + cacheRead + cacheWrite + output,
  };
}

function addUsage(...values) {
  return values.reduce((sum, value) => ({
    uncachedInput: sum.uncachedInput + (value?.uncachedInput ?? 0),
    cacheRead: sum.cacheRead + (value?.cacheRead ?? 0),
    cacheWrite: sum.cacheWrite + (value?.cacheWrite ?? 0),
    output: sum.output + (value?.output ?? 0),
    nominal: sum.nominal + (value?.nominal ?? 0),
    processed: sum.processed + (value?.processed ?? 0),
  }), zeroUsage());
}

function deltaUsage(after, before) {
  return {
    uncachedInput: Math.max(0, after.uncachedInput - before.uncachedInput),
    cacheRead: Math.max(0, after.cacheRead - before.cacheRead),
    cacheWrite: Math.max(0, after.cacheWrite - before.cacheWrite),
    output: Math.max(0, after.output - before.output),
    nominal: Math.max(0, after.nominal - before.nominal),
    processed: Math.max(0, after.processed - before.processed),
  };
}

function measuredUsage() {
  return addUsage(SETUP_USAGE, ...usageLedger.values());
}

function reserveFor(label) {
  if (label.startsWith('compact:')) return 8_000;
  if (label.startsWith('target:')) return 3_000;
  if (label.startsWith('worker:')) return 6_000;
  return 4_000;
}

function budgetGuard(label) {
  const usage = measuredUsage();
  const reserve = reserveFor(label);
  if (budgetStopped
    || usage.nominal >= STOP_SCHEDULING_AT
    || usage.nominal + reservedTokens + reserve > HARD_TOKEN_BUDGET
    || usage.processed >= PROCESSED_CEILING) {
    budgetStopped = true;
    throw new Error(`budget-stop:${label}: nominal=${usage.nominal}, processed=${usage.processed}, reserved=${reservedTokens}, next=${reserve}, hard=${HARD_TOKEN_BUDGET}`);
  }
  reservedTokens += reserve;
  return () => { reservedTokens = Math.max(0, reservedTokens - reserve); };
}

async function tokenUsage(sessionId, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const row = (await listSessions(rpc).catch(() => [])).find((item) => item.sessionId === sessionId);
    const value = row?.projections?.values?.tokenUsage;
    if (value) {
      const normalized = deltaUsage(normalizeUsage(value), usageBaselines.get(sessionId) ?? zeroUsage());
      // Previous-stage sessions can be read during restart audits, but their
      // usage is already included in SETUP_USAGE. Only sessions created by
      // this process belong in the incremental ledger.
      if (trackedSessions.has(sessionId)) usageLedger.set(sessionId, normalized);
      if (measuredUsage().nominal >= HARD_TOKEN_BUDGET || measuredUsage().processed >= PROCESSED_CEILING) budgetStopped = true;
      return normalized;
    }
    await sleep(500);
  }
  return usageLedger.get(sessionId) ?? zeroUsage();
}

async function waitForTurn(sessionId, capMs) {
  const settled = await waitIdle(rpc, sessionId, { timeoutMs: capMs, pollMs: 1000, startGraceMs: 30_000 });
  if (settled.idle) return { capped: false, started: settled.started };
  await rpc('session.cancel', { sessionId }).catch(() => undefined);
  await sleep(2500);
  return { capped: true, started: settled.started };
}

async function promptAndWait(sessionId, text, capMs, label) {
  const release = budgetGuard(label);
  try {
    const before = await tokenUsage(sessionId);
    const response = await rpc('session.prompt', {
      sessionId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: TZ,
    });
    const settled = await waitForTurn(sessionId, capMs);
    const after = await tokenUsage(sessionId);
    return { response, settled, before, after, delta: deltaUsage(after, before) };
  } finally {
    release();
  }
}

async function historyEvents(sessionId) {
  const result = await rpc('session.history', { sessionId, maxMessages: 80 }, 60_000);
  return (result.events ?? []).map((entry) => entry.event);
}

async function requestCount(sessionId) {
  return (await historyEvents(sessionId)).filter((event) => event.type === 'turn/start').length;
}

async function compactionCount(sessionId) {
  return (await historyEvents(sessionId)).filter((event) => event.type === 'compaction/summary').length;
}

async function archiveSession(sessionId, phase) {
  try {
    await rpc('session.cancel', { sessionId }).catch(() => undefined);
    await rpc('workspace.archiveSession', { sessionId });
    archiveAttempts.push({ sessionId, phase, ok: true });
    return true;
  } catch (error) {
    archiveAttempts.push({ sessionId, phase, ok: false, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function persistManifest(extra = {}) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(MANIFEST, JSON.stringify({
    stamp: STAMP,
    api: API,
    sessions: [...trackedSessions],
    workspaces: [...trackedWorkspaces.entries()].map(([workspaceId, path]) => ({ workspaceId, path })),
    archiveAttempts,
    measuredUsage: measuredUsage(),
    ...extra,
  }, null, 2));
}

async function createFixtureWorkspace(fixture) {
  const path = await mkdtemp(join(tmpdir(), `dsh-bridge-v023-${fixture.id}-`));
  const created = await rpc('workspace.create', { path });
  const workspaceId = created?.workspace?.workspaceId;
  if (!workspaceId) throw new Error(`workspace-create-empty:${fixture.id}`);
  trackedWorkspaces.set(workspaceId, path);
  // rc8's minimal preset intentionally does not mount the native /compact
  // command. Compacted fixtures therefore use standard as their source while
  // still varying the *target* preset across minimal / standard / code.
  const sourcePreset = fixture.kind === 'compacted' ? 'standard' : 'minimal';
  const source = await rpc('session.create', { workspaceId, agentPreset: sourcePreset });
  trackedSessions.add(source.sessionId);
  await persistManifest({ state: `source-created:${fixture.id}` });
  return { ...fixture, workspaceId, path, sourceSessionId: source.sessionId, sourceTurns: [], compaction: null };
}

async function createReusedCompactedWorkspace(fixture) {
  const parentSessionId = REUSE_LONG_SOURCES?.[fixture.id];
  if (!parentSessionId) throw new Error(`missing-reused-source:${fixture.id}`);
  const rows = await listSessions(rpc);
  const parent = rows.find((item) => item.sessionId === parentSessionId);
  if (!parent?.cwd) throw new Error(`reused-source-cwd-unavailable:${fixture.id}`);
  await mkdir(parent.cwd, { recursive: true });
  const created = await rpc('workspace.create', { path: parent.cwd });
  const workspaceId = created?.workspace?.workspaceId;
  if (!workspaceId) throw new Error(`workspace-create-empty:${fixture.id}`);
  trackedWorkspaces.set(workspaceId, parent.cwd);
  const forked = await rpc('session.fork', { sessionId: parentSessionId });
  if (!forked?.sessionId) throw new Error(`session-fork-empty:${fixture.id}`);
  // A fork of a detached/archived source is intentionally loose. Resuming the
  // explicit child id through session.create attaches it to the eval workspace
  // without replaying any model turns.
  await rpc('session.create', {
    workspaceId,
    sessionId: forked.sessionId,
    agentPreset: 'standard',
  });
  trackedSessions.add(forked.sessionId);
  const forkRows = await listSessions(rpc);
  const forkRow = forkRows.find((item) => item.sessionId === forked.sessionId);
  usageBaselines.set(forked.sessionId, normalizeUsage(forkRow?.projections?.values?.tokenUsage));
  usageLedger.set(forked.sessionId, zeroUsage());
  await persistManifest({ state: `source-reused:${fixture.id}`, parentSessionId });
  return {
    ...fixture,
    workspaceId,
    path: parent.cwd,
    sourceSessionId: forked.sessionId,
    parentSessionId,
    sourceTurns: [],
    compaction: null,
    reusedTwentyTurnHistory: true,
  };
}

async function createCarrierWorkspace(fixture) {
  const path = await mkdtemp(join(tmpdir(), `dsh-bridge-v023-carrier-${fixture.id}-`));
  const created = await rpc('workspace.create', { path });
  const workspaceId = created?.workspace?.workspaceId;
  if (!workspaceId) throw new Error(`carrier-workspace-create-empty:${fixture.id}`);
  trackedWorkspaces.set(workspaceId, path);
  const source = await rpc('session.create', { workspaceId, agentPreset: 'standard' });
  trackedSessions.add(source.sessionId);
  await persistManifest({ state: `carrier-created:${fixture.id}` });
  return {
    ...fixture,
    workspaceId,
    path,
    sourceSessionId: source.sessionId,
    frozenSummaryCarrier: true,
  };
}

function contract(facts) {
  return `PORT=${facts.port}\nDB=${facts.db}\nBAN=${facts.ban}\nPATH=${facts.path}\nPREFIX=${facts.prefix}`;
}

function nextStep(facts) {
  return `迁移后的下一步只做文字输出，不使用任何工具：在简短复述之后，逐行原样输出以下五行执行契约：\n${contract(facts)}`;
}

async function prepareShortSource(item) {
  const f = item.facts;
  item.sourceTurns.push(await promptAndWait(
    item.sourceSessionId,
    `我们在做 ${item.name}。当前硬约定：本地端口必须是 ${f.port}；数据库固定为 ${f.db}；明确禁止 ${f.ban}。请只回复“已记录第一组约定”，不要使用工具。`,
    CAPS.source,
    `source:${item.id}:1`,
  ));
  item.sourceTurns.push(await promptAndWait(
    item.sourceSessionId,
    `补充硬约定：唯一核心路径是 ${f.path}；提交前缀必须是 ${f.prefix}。${nextStep(f)} 请只回复“已记录第二组约定”，现在不要执行下一步，也不要使用工具。`,
    CAPS.source,
    `source:${item.id}:2`,
  ));
  item.sourceUsage = await tokenUsage(item.sourceSessionId);
  return item;
}

async function prepareCompactedSource(item) {
  const f = item.facts;
  const old = item.old;
  item.sourceTurns.push(await promptAndWait(
    item.sourceSessionId,
    `我们在做 ${item.name}。已经定下且不会改变：本地端口 ${f.port}，数据库 ${f.db}。请只回复“已记录基础约定”，不要使用工具。`,
    CAPS.source,
    `source:${item.id}:1`,
  ));
  item.sourceTurns.push(await promptAndWait(
    item.sourceSessionId,
    `早期方案曾经写过：禁止 ${old.ban}、路径 ${old.path}、前缀 ${old.prefix}。这些只是旧方案，稍后会给最终替代值。请只回复“已标记为旧方案”，不要使用工具。`,
    CAPS.source,
    `source:${item.id}:2`,
  ));
  item.sourceTurns.push(await promptAndWait(
    item.sourceSessionId,
    `当前状态：目标和 ${f.port}/${f.db} 已确认，等待旧方案替换后再迁移。请只回复“等待最终替换值”，不要使用工具。`,
    CAPS.source,
    `source:${item.id}:3`,
  ));
  return item;
}

async function waitForBrowserCompactions(items) {
  await persistManifest({
    state: 'awaiting-browser-compaction',
    compactedSources: items.map((item) => ({ id: item.id, sessionId: item.sourceSessionId, workspaceId: item.workspaceId })),
  });
  console.log(`BRIDGE_V023_READY_FOR_COMPACTION ${items.map((item) => `${item.id}=${item.sourceSessionId}`).join(' ')}`);
  const deadline = Date.now() + CAPS.compact;
  while (Date.now() < deadline) {
    const counts = await Promise.all(items.map((item) => compactionCount(item.sourceSessionId).catch(() => 0)));
    if (counts.every((count) => count > 0)) {
      counts.forEach((count, index) => { items[index].compactionCount = count; });
      return items;
    }
    await sleep(1000);
  }
  throw new Error('browser-compaction-timeout');
}

async function finalizeCompactedSource(item) {
  const f = item.facts;
  const old = item.old;
  item.sourceTurns.push(await promptAndWait(
    item.sourceSessionId,
    `最终替换值现在生效并覆盖旧方案：明确禁止 ${f.ban}；唯一核心路径改为 ${f.path}；提交前缀改为 ${f.prefix}。旧的 ${old.ban}、${old.path}、${old.prefix} 全部作废，不得恢复。${nextStep(f)} 请只回复“最终约定已生效”，现在不要执行下一步，也不要使用工具。`,
    CAPS.source,
    `source:${item.id}:final`,
  ));
  item.sourceUsage = await tokenUsage(item.sourceSessionId);
  return item;
}

async function compressFixture(item) {
  const messages = await foldedHistory(rpc, item.sourceSessionId);
  const source = buildBridgeSource(messages);
  const preset = await resolveWorkerPreset(rpc);
  const route = await resolveWorkerModel(rpc, item.sourceSessionId, 'pro');
  const worker = await rpc('session.create', {
    workspaceId: item.workspaceId,
    ...(preset === undefined ? {} : { agentPreset: preset }),
  });
  trackedSessions.add(worker.sessionId);
  await persistManifest({ state: `worker-created:${item.id}` });
  try {
    if (route.provider && route.model) {
      await rpc('session.selectModel', {
        sessionId: worker.sessionId, provider: route.provider, model: route.model,
      });
    }
    const workerTurn = await promptAndWait(
      worker.sessionId,
      `${buildBridgeInstruction('zh')}${source.text}`,
      CAPS.worker,
      `worker:${item.id}`,
    );
    const summary = await lastAssistantText(rpc, worker.sessionId);
    if (!summary) throw new Error(`worker-empty:${item.id}`);
    item.source = {
      chars: source.text.length,
      userMessagesUsed: source.userMessagesUsed,
      userMessagesTotal: source.userMessagesTotal,
      reusedCompaction: source.reusedCompaction,
      truncated: source.truncated,
      dropped: source.dropped,
    };
    item.worker = {
      sessionId: worker.sessionId,
      preset,
      provider: route.provider,
      model: route.model,
      reason: route.reason,
      capped: workerTurn.settled.capped,
      usage: workerTurn.delta,
    };
    item.summary = summary;
    item.summaryChars = summary.length;
    item.summaryEstimatedTokens = Math.ceil(summary.length / (2400 / 900));
    item.summaryScore = scoreFacts(summary, item);
    return item;
  } finally {
    await archiveSession(worker.sessionId, `worker:${item.id}`);
    await persistManifest({ state: `worker-archived:${item.id}` });
  }
}

function scoreFacts(text, fixture) {
  const entries = Object.entries(fixture.facts);
  const hits = Object.fromEntries(entries.map(([key, value]) => [key, text.toLowerCase().includes(String(value).toLowerCase())]));
  const oldLeaks = fixture.old
    ? Object.fromEntries(Object.entries(fixture.old).map(([key, value]) => [key, text.toLowerCase().includes(String(value).toLowerCase())]))
    : {};
  return {
    hits,
    hitCount: Object.values(hits).filter(Boolean).length,
    criticalHitCount: ['port', 'ban', 'path'].filter((key) => hits[key]).length,
    oldLeaks,
    oldLeakCount: Object.values(oldLeaks).filter(Boolean).length,
  };
}

async function soak(sessionId) {
  const before = await tokenUsage(sessionId);
  const turnsBefore = await requestCount(sessionId);
  await sleep(SOAK_MS);
  const after = await tokenUsage(sessionId);
  const turnsAfter = await requestCount(sessionId);
  return { before, after, delta: deltaUsage(after, before), turnsBefore, turnsAfter };
}

async function runCell(item, mode) {
  const releaseKickoff = budgetGuard(`target:${item.id}:${mode}:kickoff`);
  let migration;
  try {
    migration = await executeMigration(rpc, {
      sessionId: item.sourceSessionId,
      to: item.target,
      summary: item.summary,
      lang: 'zh',
      goalRounds: 1,
      inject: 'both',
      kickoff: true,
      autoContinue: mode === 'continue',
      title: `v0.2.3 eval ${item.id} ${mode}`,
    });
  } catch (error) {
    releaseKickoff();
    throw error;
  }
  trackedSessions.add(migration.sessionId);
  await persistManifest({ state: `target-created:${item.id}:${mode}` });

  const kickoffBefore = zeroUsage();
  let kickoffSettled;
  let kickoffAfter;
  try {
    kickoffSettled = await waitForTurn(migration.sessionId, CAPS.target);
    kickoffAfter = await tokenUsage(migration.sessionId);
  } finally {
    releaseKickoff();
  }
  const kickoffText = await lastAssistantText(rpc, migration.sessionId);
  const kickoffTurns = await requestCount(migration.sessionId);
  const firstSoak = await soak(migration.sessionId);

  let workText = kickoffText;
  let workTurn = null;
  if (mode === 'confirm') {
    workTurn = await promptAndWait(
      migration.sessionId,
      '确认交接无误。现在执行摘要中的下一步；不要使用任何工具，直接输出要求的五行执行契约。',
      CAPS.target,
      `target:${item.id}:${mode}:work`,
    );
    workText = await lastAssistantText(rpc, migration.sessionId);
  }
  const finalUsage = await tokenUsage(migration.sessionId);
  const finalTurns = await requestCount(migration.sessionId);
  const secondSoak = await soak(migration.sessionId);

  const result = {
    id: `${item.id}-${mode}`,
    fixtureId: item.id,
    kind: item.kind,
    target: item.target,
    mode,
    sourceSessionId: item.sourceSessionId,
    targetSessionId: migration.sessionId,
    migration,
    kickoff: {
      capped: kickoffSettled.capped,
      text: kickoffText,
      score: scoreFacts(kickoffText, item),
      turns: kickoffTurns,
      usage: deltaUsage(kickoffAfter, kickoffBefore),
    },
    work: {
      capped: workTurn?.settled.capped ?? kickoffSettled.capped,
      text: workText,
      score: scoreFacts(workText, item),
      exactContract: contract(item.facts).split('\n').every((line) => workText.includes(line)),
      turns: finalTurns,
      usage: mode === 'confirm' ? workTurn.delta : deltaUsage(kickoffAfter, kickoffBefore),
    },
    firstSoak,
    secondSoak,
    usage: {
      targetToFirstWork: finalUsage,
      migrationAndFirstWork: addUsage(item.worker.usage, finalUsage),
      summaryInjectionSharePct: kickoffAfter.processed > 0
        ? Number((item.summaryEstimatedTokens / (kickoffAfter.uncachedInput + kickoffAfter.cacheRead + kickoffAfter.cacheWrite) * 100).toFixed(2))
        : null,
    },
  };
  return result;
}

function fixtureGate(items, cells, kind) {
  const fixtures = items.filter((item) => item.kind === kind);
  const selected = cells.filter((cell) => cell.kind === kind);
  const summaryFacts = fixtures.reduce((sum, item) => sum + item.summaryScore.hitCount, 0);
  const summaryCritical = fixtures.reduce((sum, item) => sum + item.summaryScore.criticalHitCount, 0);
  const workFacts = selected.reduce((sum, cell) => sum + cell.work.score.hitCount, 0);
  const workCritical = selected.reduce((sum, cell) => sum + cell.work.score.criticalHitCount, 0);
  const hardFailures = [];
  for (const item of fixtures) {
    if (item.summaryScore.criticalHitCount < 3) hardFailures.push(`${item.id}:summary-critical`);
    if (kind === 'compacted' && (!item.source.reusedCompaction || (item.compactionCount ?? 0) < 1)) hardFailures.push(`${item.id}:compaction-not-reused`);
  }
  for (const cell of selected) {
    if (!cell.migration.goalCreated || !cell.migration.goalPaused || !cell.migration.kickoffSent) hardFailures.push(`${cell.id}:goal-or-kickoff`);
    if (cell.work.score.criticalHitCount < 3) hardFailures.push(`${cell.id}:work-critical`);
    if (cell.work.score.oldLeakCount > 0) hardFailures.push(`${cell.id}:old-value-leak`);
    if (!cell.work.exactContract) hardFailures.push(`${cell.id}:contract`);
    if (cell.mode === 'continue' && cell.work.turns !== 1) hardFailures.push(`${cell.id}:continue-turns-${cell.work.turns}`);
    if (cell.mode === 'confirm' && cell.work.turns !== 2) hardFailures.push(`${cell.id}:confirm-turns-${cell.work.turns}`);
    if (cell.firstSoak.delta.processed !== 0 || cell.firstSoak.turnsAfter !== cell.firstSoak.turnsBefore) hardFailures.push(`${cell.id}:first-soak`);
    if (cell.secondSoak.delta.processed !== 0 || cell.secondSoak.turnsAfter !== cell.secondSoak.turnsBefore) hardFailures.push(`${cell.id}:second-soak`);
  }
  return {
    kind,
    summaryFacts: `${summaryFacts}/${fixtures.length * 5}`,
    summaryCritical: `${summaryCritical}/${fixtures.length * 3}`,
    workFacts: `${workFacts}/${selected.length * 5}`,
    workCritical: `${workCritical}/${selected.length * 3}`,
    hardFailures,
    pass: hardFailures.length === 0
      && summaryFacts >= fixtures.length * 5 - 1
      && workFacts >= Math.ceil(selected.length * 5 * 0.95),
  };
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  const errors = [];
  let stopped = false;
  async function lane() {
    while (!stopped && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await fn(items[index], index);
      } catch (error) {
        errors.push(error);
        stopped = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  if (errors.length) throw errors[0];
  return output;
}

async function waitForHostRestart() {
  console.log(`BRIDGE_V023_READY_FOR_HOST_RESTART manifest=${MANIFEST}`);
  let sawDown = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      await rpc('session.list', {}, 2000);
      if (sawDown) return { observed: true };
    } catch {
      sawDown = true;
    }
    await sleep(500);
  }
  return { observed: false, error: 'restart-not-observed-within-180s' };
}

async function restartAudit(cells) {
  const before = new Map();
  for (const cell of cells) {
    before.set(cell.targetSessionId, {
      turns: await requestCount(cell.targetSessionId),
      usage: await tokenUsage(cell.targetSessionId),
    });
  }
  await persistManifest({ state: 'awaiting-host-restart', report: OUT });
  const restart = await waitForHostRestart();
  if (!restart.observed) return { ...restart, stable: false, sessions: [] };
  await sleep(SOAK_MS);
  const sessions = [];
  for (const cell of cells) {
    const previous = before.get(cell.targetSessionId);
    const turns = await requestCount(cell.targetSessionId);
    const usage = await tokenUsage(cell.targetSessionId);
    sessions.push({
      id: cell.id,
      sessionId: cell.targetSessionId,
      turnsBefore: previous.turns,
      turnsAfter: turns,
      usageDelta: deltaUsage(usage, previous.usage),
      stable: turns === previous.turns && deltaUsage(usage, previous.usage).processed === 0,
    });
  }
  return { observed: true, stable: sessions.every((item) => item.stable), sessions };
}

async function cleanup() {
  for (const sessionId of trackedSessions) await archiveSession(sessionId, 'final-sweep');
  const workspaceErrors = [];
  for (const [workspaceId, path] of trackedWorkspaces) {
    try {
      await rpc('workspace.delete', { workspaceId });
    } catch (error) {
      workspaceErrors.push({ workspaceId, error: error instanceof Error ? error.message : String(error) });
    }
    await rm(path, { recursive: true, force: true });
  }
  // rc8 session.list includes archived rows, so presence in that response is
  // not a visibility test. In an isolated eval home we can verify the durable
  // archive set directly without reading any credential material.
  let archivedTracked = [];
  let archiveVerification = EVAL_DSH_HOME ? 'workspace-storage' : 'rpc-only';
  if (EVAL_DSH_HOME) {
    try {
      const storage = JSON.parse(await readFile(join(EVAL_DSH_HOME, 'storages', 'workspace.json'), 'utf8'));
      const archived = new Set(storage?.global?.archivedSessionIds ?? []);
      archivedTracked = [...trackedSessions].filter((sessionId) => archived.has(sessionId));
    } catch (error) {
      archiveVerification = `workspace-storage-error:${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const workspaces = await rpc('workspace.list', {}).catch(() => ({ items: [] }));
  const remainingWorkspaces = (workspaces.items ?? []).filter((item) => trackedWorkspaces.has(item.workspaceId));
  return {
    trackedSessions: trackedSessions.size,
    successfulArchiveCalls: archiveAttempts.filter((item) => item.ok).length,
    failedArchiveCalls: archiveAttempts.filter((item) => !item.ok),
    archiveVerification,
    archivedTracked,
    missingFromArchive: EVAL_DSH_HOME ? [...trackedSessions].filter((sessionId) => !archivedTracked.includes(sessionId)) : [],
    workspaceErrors,
    remainingWorkspaces: remainingWorkspaces.map((item) => item.workspaceId),
    pass: archiveAttempts.every((item) => item.ok)
      && (!EVAL_DSH_HOME || archivedTracked.length === trackedSessions.size)
      && workspaceErrors.length === 0
      && remainingWorkspaces.length === 0,
  };
}

await mkdir(OUT_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const fixtures = [];
const cells = [];
let shortGate = null;
let compactedGate = null;
let restart = { observed: false, stable: false, skipped: !WAIT_FOR_RESTART, sessions: [] };
let fatalError = null;
let cleanupResult = null;

try {
  console.log(`v0.2.3 E2E api=${API} budget=${HARD_TOKEN_BUDGET} stopAt=${STOP_SCHEDULING_AT}`);
  if (PREVIOUS_REPORT) {
    const previous = JSON.parse(await readFile(PREVIOUS_REPORT, 'utf8'));
    if (previous.gates?.short?.pass !== true) throw new Error('previous-short-gate-not-passed');
    fixtures.push(...previous.fixtures.filter((item) => item.kind === 'short'));
    cells.push(...previous.cells.filter((item) => item.kind === 'short'));
    shortGate = previous.gates.short;
    console.log(`SHORT_GATE resumed=true facts=${shortGate.workFacts}`);
  } else {
    const shortItems = await mapLimit(
      await Promise.all(FIXTURES.filter((item) => item.kind === 'short').map(createFixtureWorkspace)),
      SHORT_CONCURRENCY,
      prepareShortSource,
    );
    const shortCompressed = await mapLimit(shortItems, SHORT_CONCURRENCY, compressFixture);
    fixtures.push(...shortCompressed);
    const shortCells = await mapLimit(
      shortCompressed.flatMap((item) => ['confirm', 'continue'].map((mode) => ({ item, mode }))),
      SHORT_CONCURRENCY,
      ({ item, mode }) => runCell(item, mode),
    );
    cells.push(...shortCells);
    shortGate = fixtureGate(fixtures, cells, 'short');
    console.log(`SHORT_GATE pass=${shortGate.pass} facts=${shortGate.workFacts} nominal=${measuredUsage().nominal} processed=${measuredUsage().processed}`);
    if (!shortGate.pass) throw new Error(`short-gate-failed:${shortGate.hardFailures.join(',')}`);
  }

  let compactedCompressed;
  if (USE_FROZEN_COMPACTED) {
    if (!PREVIOUS_REPORT) throw new Error('frozen-compacted-requires-previous-report');
    const previous = JSON.parse(await readFile(PREVIOUS_REPORT, 'utf8'));
    const frozen = previous.fixtures.filter((item) => item.kind === 'compacted');
    if (frozen.length !== 3 || frozen.some((item) => item.summaryScore?.criticalHitCount !== 3)) {
      throw new Error('frozen-compacted-fixtures-invalid');
    }
    for (const reportPath of SUMMARY_REPORTS) {
      const fixed = JSON.parse(await readFile(reportPath, 'utf8'));
      const fixtureId = fixed.fixtureId ?? (reportPath.includes('code-summary-fixed') ? 'compacted-code' : null);
      if (fixed.pass !== true || typeof fixed.summary !== 'string' || !fixtureId) {
        throw new Error(`summary-report-invalid:${reportPath}`);
      }
      const fixture = frozen.find((item) => item.id === fixtureId);
      if (!fixture) throw new Error(`summary-report-fixture-missing:${fixtureId}`);
      fixture.summary = fixed.summary;
      fixture.summaryChars = fixed.summary.length;
      fixture.summaryEstimatedTokens = Math.ceil(fixed.summary.length / (2400 / 900));
      fixture.summaryScore = scoreFacts(fixed.summary, fixture);
    }
    compactedCompressed = await Promise.all(frozen.map(createCarrierWorkspace));
  } else {
    let compactedItems;
    if (REUSE_LONG_SOURCES) {
      compactedItems = await Promise.all(
        FIXTURES.filter((item) => item.kind === 'compacted').map(createReusedCompactedWorkspace),
      );
    } else {
      compactedItems = await mapLimit(
        await Promise.all(FIXTURES.filter((item) => item.kind === 'compacted').map(createFixtureWorkspace)),
        LONG_CONCURRENCY,
        prepareCompactedSource,
      );
    }
    if (REUSED_SOURCES_FINALIZED) {
      const counts = await Promise.all(compactedItems.map((item) => compactionCount(item.sourceSessionId)));
      if (counts.some((count) => count < 1)) throw new Error('reused-finalized-source-missing-compaction');
      counts.forEach((count, index) => { compactedItems[index].compactionCount = count; });
    } else {
      compactedItems = await waitForBrowserCompactions(compactedItems);
      compactedItems = await mapLimit(compactedItems, LONG_CONCURRENCY, finalizeCompactedSource);
    }
    compactedCompressed = await mapLimit(compactedItems, LONG_CONCURRENCY, compressFixture);
  }
  fixtures.push(...compactedCompressed);
  const longLimit = measuredUsage().nominal >= 90_000 ? 1 : LONG_CONCURRENCY;
  const targetFixtures = TARGET_FIXTURE_IDS.size > 0
    ? compactedCompressed.filter((item) => TARGET_FIXTURE_IDS.has(item.id))
    : compactedCompressed;
  const targetModes = TARGET_MODES.size > 0
    ? ['confirm', 'continue'].filter((mode) => TARGET_MODES.has(mode))
    : ['confirm', 'continue'];
  const compactedCells = await mapLimit(
    targetFixtures.flatMap((item) => targetModes.map((mode) => ({ item, mode }))),
    longLimit,
    ({ item, mode }) => runCell(item, mode),
  );
  cells.push(...compactedCells);
  compactedGate = fixtureGate(fixtures, cells, 'compacted');
  console.log(`COMPACTED_GATE pass=${compactedGate.pass} facts=${compactedGate.workFacts} nominal=${measuredUsage().nominal} processed=${measuredUsage().processed}`);
  if (!compactedGate.pass) throw new Error(`compacted-gate-failed:${compactedGate.hardFailures.join(',')}`);

  if (WAIT_FOR_RESTART) restart = await restartAudit(cells);
} catch (error) {
  fatalError = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  console.error(`EVAL_ERROR ${fatalError.message}`);
} finally {
  cleanupResult = await cleanup();
}

const report = {
  schemaVersion: 1,
  suite: 'v0.2.3-current-path',
  startedAt,
  finishedAt: new Date().toISOString(),
  api: API,
  commit: process.env.BRIDGE_COMMIT ?? null,
  budget: {
    hardNominal: HARD_TOKEN_BUDGET,
    stopSchedulingAt: STOP_SCHEDULING_AT,
    processedCeiling: PROCESSED_CEILING,
    setupUsage: SETUP_USAGE,
    measured: measuredUsage(),
    exceeded: measuredUsage().nominal > HARD_TOKEN_BUDGET || measuredUsage().processed > PROCESSED_CEILING,
    stopped: budgetStopped,
  },
  concurrency: { short: SHORT_CONCURRENCY, compacted: LONG_CONCURRENCY },
  gates: { short: shortGate, compacted: compactedGate },
  restart,
  fixtures,
  cells,
  archive: cleanupResult,
  archiveAttempts,
  fatalError,
  pass: fatalError === null
    && shortGate?.pass === true
    && compactedGate?.pass === true
    && (!WAIT_FOR_RESTART || restart.stable === true)
    && cleanupResult?.pass === true
    && measuredUsage().nominal <= HARD_TOKEN_BUDGET
    && measuredUsage().processed <= PROCESSED_CEILING,
};

await writeFile(OUT, JSON.stringify(report, null, 2));
await persistManifest({ state: 'finished', report: OUT, pass: report.pass, archive: cleanupResult });
console.log(`REPORT ${OUT}`);
console.log(`PASS ${report.pass}`);
process.exitCode = report.pass ? 0 : 1;
