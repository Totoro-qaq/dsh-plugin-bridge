#!/usr/bin/env node
/**
 * Live visual migration acceptance for DSH 0.1.1-rc.2.
 *
 * This is deliberately small: one resolved-image migration and one unresolved
 * raw-image migration, both pinned to deepseek-v4-flash-vision-exp. It creates
 * real model requests and archives every session it creates.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendVisualEvidence, buildBridgeSource } from '../src/compression.ts';
import {
  executeMigration,
  foldedHistory,
  lastAssistantText,
  listSessions,
  waitIdle,
} from '../src/migrate.ts';
import { createRpc, resolveApiBase, sleep } from '../src/rpc.ts';

if (process.env.BRIDGE_E2E_ACK !== '1' || !process.env.DSH_API?.trim()) {
  throw new Error('Set BRIDGE_E2E_ACK=1 and an explicit isolated DSH_API. This test spends model tokens.');
}

const API = resolveApiBase(process.env.DSH_API);
const PROVIDER = process.env.BRIDGE_VISION_PROVIDER ?? 'deepseek-official';
const MODEL = process.env.BRIDGE_VISION_MODEL ?? 'deepseek-v4-flash-vision-exp';
const DSH_VERSION = process.env.BRIDGE_DSH_VERSION ?? '0.1.1-rc.2';
const TIMEOUT = Number(process.env.BRIDGE_VISION_TIMEOUT ?? 240_000);
const REUSE_RESOLVED_REPORT = process.env.BRIDGE_REUSE_RESOLVED_REPORT?.trim() || null;
const BRIDGE_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_DIR = new URL('../reports/', import.meta.url).pathname;
const RAW_REPORT = `${REPORT_DIR}v${BRIDGE_VERSION}-rc11-vision-${STAMP}.raw.json`;
const FIXTURE_PATH = new URL('./fixtures/rc11-vision.png', import.meta.url);
const FIXTURE_SHA256 = 'fcde25225381226631b56f693eeb9845133812e488208824db8d4f9cdb15d0e0';
const rpc = createRpc({ api: API, prefix: `bridge-rc11-vision-${STAMP}`, timeoutMs: 60_000 });

const FACTS = {
  contractId: 'VIS-RC11-8472',
  shape: 'CYAN TRIANGLE',
  port: '57431',
  path: 'vision/rc11/evidence.png',
  forbidden: 'MAGENTA CIRCLE',
};
const CONTRACT = [
  `CONTRACT_ID=${FACTS.contractId}`,
  `SHAPE=${FACTS.shape}`,
  `PORT=${FACTS.port}`,
  `PATH=${FACTS.path}`,
  `FORBIDDEN=${FACTS.forbidden}`,
].join('\n');

const trackedSessions = new Set();
const archiveAttempts = [];
let workspace;
let fatalError = null;
const result = {
  stamp: STAMP,
  api: API,
  dshVersion: DSH_VERSION,
  bridgeVersion: BRIDGE_VERSION,
  provider: PROVIDER,
  model: MODEL,
  fixture: { path: FIXTURE_PATH.pathname, sha256: FIXTURE_SHA256, facts: FACTS },
  environment: {},
  resolved: null,
  unresolved: null,
  archive: null,
  pass: false,
  fatalError: null,
};

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function score(text) {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pairs = [
    ['CONTRACT_ID', FACTS.contractId],
    ['SHAPE', FACTS.shape],
    ['PORT', FACTS.port],
    ['PATH', FACTS.path],
    ['FORBIDDEN', FACTS.forbidden],
  ];
  // The fact gate is exact while allowing the two ordinary key/value
  // separators. The first live run used `:` despite reading all five facts
  // correctly; treating formatting as five visual misses was an evaluator bug.
  const lines = Object.fromEntries(pairs.map(([key, value]) => [
    `${key}=${value}`,
    new RegExp(`(?:^|\\n)\\s*${key}\\s*[:=]\\s*${escape(value)}\\s*(?:\\n|$)`).test(text),
  ]));
  return {
    lines,
    hitCount: Object.values(lines).filter(Boolean).length,
    exactContract: Object.values(lines).every(Boolean),
    canonicalEquals: CONTRACT.split('\n').every((line) => text.includes(line)),
  };
}

function normalizeUsage(value) {
  const uncachedInput = value?.uncachedInputTokens ?? 0;
  const cacheRead = value?.cacheReadTokens ?? 0;
  const cacheWrite = value?.cacheWriteTokens ?? 0;
  const output = value?.outputTokens ?? 0;
  return {
    uncachedInput,
    cacheRead,
    cacheWrite,
    output,
    nominal: uncachedInput + output,
    processed: uncachedInput + cacheRead + cacheWrite + output,
  };
}

async function usage(sessionId) {
  const row = (await listSessions(rpc)).find((item) => item.sessionId === sessionId);
  return normalizeUsage(row?.projections?.values?.tokenUsage);
}

async function models(sessionId) {
  return rpc('session.models', { sessionId });
}

async function selectVision(sessionId) {
  const selected = await rpc('session.selectModel', {
    sessionId,
    provider: PROVIDER,
    model: MODEL,
  });
  const catalog = await models(sessionId);
  invariant(catalog.routable === true, `vision route is not routable: ${JSON.stringify(catalog.current)}`);
  invariant(catalog.current?.provider === PROVIDER, `wrong current provider: ${JSON.stringify(catalog.current)}`);
  invariant(catalog.current?.model === MODEL, `wrong current model: ${JSON.stringify(catalog.current)}`);
  return { selected, current: catalog.current, routable: catalog.routable };
}

async function waitForTurn(sessionId) {
  const settled = await waitIdle(rpc, sessionId, {
    timeoutMs: TIMEOUT,
    pollMs: 1000,
    startGraceMs: 30_000,
  });
  if (!settled.idle) {
    await rpc('session.cancel', { sessionId }).catch(() => undefined);
    throw new Error(`model turn timed out for ${sessionId}`);
  }
  return settled;
}

async function promptWithFixture(sessionId, text, { cancelImmediately = false } = {}) {
  const data = (await readFile(FIXTURE_PATH)).toString('base64');
  const accepted = await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [
      { type: 'image', mediaType: 'image/png', data, name: 'rc11-vision.png' },
      { type: 'text', text },
    ],
    clientTimeZone: 'Asia/Shanghai',
  }, TIMEOUT);
  if (cancelImmediately) {
    // `session.prompt` returns after durable admission but before the agent has
    // necessarily emitted `user/message`. Wait for that source-of-truth event,
    // then cancel before the first model delta (normally several seconds later).
    const deadline = Date.now() + 5000;
    let persisted = false;
    while (Date.now() < deadline) {
      const history = await rpc('session.history', { sessionId, maxMessages: 20 });
      persisted = (history.events ?? []).some(({ event }) => event?.type === 'user/message'
        && event.data?.content?.some?.((part) => part?.type === 'image'));
      if (persisted) break;
      await sleep(25);
    }
    await rpc('session.cancel', { sessionId });
    await sleep(1500);
    invariant(persisted, 'cancelled image never reached durable user/message history');
  } else {
    await waitForTurn(sessionId);
  }
  return accepted;
}

async function createSession(agentPreset) {
  const created = await rpc('session.create', {
    workspaceId: workspace.workspaceId,
    agentPreset,
  });
  trackedSessions.add(created.sessionId);
  return created.sessionId;
}

async function assertTargetModel(sessionId) {
  const catalog = await models(sessionId);
  invariant(catalog.current?.provider === PROVIDER, `target provider changed: ${JSON.stringify(catalog.current)}`);
  invariant(catalog.current?.model === MODEL, `target model changed: ${JSON.stringify(catalog.current)}`);
  return catalog.current;
}

async function runResolved() {
  const sourceSessionId = await createSession('standard');
  const selected = await selectVision(sourceSessionId);
  await promptWithFixture(
    sourceSessionId,
    `Inspect the attached image directly. Do not use tools. Output exactly these five keys with the visible values, one per line: CONTRACT_ID, SHAPE, PORT, PATH, FORBIDDEN. Use = between each key and value. Do not add guesses.`,
  );
  const sourceText = await lastAssistantText(rpc, sourceSessionId);
  const sourceScore = score(sourceText);
  invariant(sourceScore.exactContract, `vision source missed visible facts: ${JSON.stringify(sourceScore)}`);

  const messages = await foldedHistory(rpc, sourceSessionId);
  const built = buildBridgeSource(messages);
  invariant(built.visualEvidence.images === 1, `resolved source image count is ${built.visualEvidence.images}`);
  invariant(built.visualEvidence.represented === 1, `resolved visual evidence count is ${built.visualEvidence.represented}`);
  invariant(built.visualEvidence.unresolved === 0, `resolved source unexpectedly has unresolved image`);
  const summary = appendVisualEvidence(
    `The visual contract is authoritative. Next step: output the exact five-line contract from the preserved visual evidence, with no tools and no guesses.`,
    built.visualEvidence,
    'en',
  );
  invariant(summary.includes(sourceText), 'resolved visual response was not preserved verbatim in the handoff');

  const migration = await executeMigration(rpc, {
    sessionId: sourceSessionId,
    to: 'code',
    summary,
    lang: 'en',
    goalRounds: 1,
    inject: 'both',
    kickoff: true,
    autoContinue: true,
    title: 'rc.2 vision resolved migration',
  });
  trackedSessions.add(migration.sessionId);
  invariant(migration.imagesSent === 0, `resolved path resent ${migration.imagesSent} raw image(s)`);
  invariant(migration.goalCreated && migration.goalPaused && migration.kickoffSent, 'resolved migration safety gate failed');
  const targetModel = await assertTargetModel(migration.sessionId);
  await waitForTurn(migration.sessionId);
  const targetText = await lastAssistantText(rpc, migration.sessionId);
  const targetScore = score(targetText);
  invariant(targetScore.exactContract, `resolved target missed contract: ${JSON.stringify(targetScore)}`);

  return {
    sourceSessionId,
    targetSessionId: migration.sessionId,
    selected,
    targetModel,
    sourceText,
    sourceScore,
    targetText,
    targetScore,
    visualEvidence: built.visualEvidence,
    migration,
    usage: {
      source: await usage(sourceSessionId),
      target: await usage(migration.sessionId),
    },
    pass: true,
  };
}

async function runUnresolved() {
  const sourceSessionId = await createSession('standard');
  const selected = await selectVision(sourceSessionId);
  await promptWithFixture(
    sourceSessionId,
    'Inspect the attached image directly. Do not use tools. Output exactly five key=value lines named CONTRACT_ID, SHAPE, PORT, PATH, and FORBIDDEN, preserving every visible value. Do not guess.',
    { cancelImmediately: true },
  );
  const messages = await foldedHistory(rpc, sourceSessionId);
  const built = buildBridgeSource(messages);
  invariant(built.visualEvidence.images === 1, `unresolved source image count is ${built.visualEvidence.images}`);
  invariant(built.visualEvidence.represented === 0, 'cancelled source unexpectedly produced reusable visual text');
  invariant(built.visualEvidence.unresolved === 1, `unresolved visual evidence count is ${built.visualEvidence.unresolved}`);
  invariant(built.visualEvidence.included[0]?.attachments?.length === 1, 'durable source attachment reference is missing');
  const summary = appendVisualEvidence(
    `The source image has not been analyzed. Next step: inspect the attached source image and output exactly five lines named CONTRACT_ID, SHAPE, PORT, PATH, and FORBIDDEN. Do not use tools or guess.`,
    built.visualEvidence,
    'en',
  );

  const migration = await executeMigration(rpc, {
    sessionId: sourceSessionId,
    to: 'minimal',
    summary,
    lang: 'en',
    goalRounds: 1,
    inject: 'both',
    kickoff: true,
    autoContinue: true,
    title: 'rc.2 vision raw-image migration',
  });
  trackedSessions.add(migration.sessionId);
  invariant(migration.imagesSent === 1, `raw-image path sent ${migration.imagesSent} image(s)`);
  invariant(migration.goalCreated && migration.goalPaused && migration.kickoffSent, 'raw-image migration safety gate failed');
  const targetModel = await assertTargetModel(migration.sessionId);
  await waitForTurn(migration.sessionId);
  const targetText = await lastAssistantText(rpc, migration.sessionId);
  const targetScore = score(targetText);
  invariant(targetScore.exactContract, `raw-image target missed contract: ${JSON.stringify(targetScore)}`);

  return {
    sourceSessionId,
    targetSessionId: migration.sessionId,
    selected,
    targetModel,
    targetText,
    targetScore,
    visualEvidence: built.visualEvidence,
    migration,
    usage: {
      source: await usage(sourceSessionId),
      target: await usage(migration.sessionId),
    },
    pass: true,
  };
}

async function archiveAll() {
  for (const sessionId of trackedSessions) {
    try {
      await rpc('session.cancel', { sessionId }).catch(() => undefined);
      await rpc('workspace.archiveSession', { sessionId });
      archiveAttempts.push({ sessionId, ok: true });
    } catch (error) {
      archiveAttempts.push({ sessionId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const listed = await rpc('workspace.list', {}).catch(() => null);
  const archived = new Set(listed?.archivedSessionIds ?? []);
  return {
    attempts: archiveAttempts,
    tracked: trackedSessions.size,
    archived: [...trackedSessions].filter((sessionId) => archived.has(sessionId)).length,
    missing: [...trackedSessions].filter((sessionId) => !archived.has(sessionId)),
    pass: archiveAttempts.every((item) => item.ok) && [...trackedSessions].every((sessionId) => archived.has(sessionId)),
  };
}

try {
  result.environment.host = await rpc('host.describe', {});
  const fixtureWorkspacePath = await mkdtemp(join(tmpdir(), 'dsh-bridge-rc11-vision-'));
  const created = await rpc('workspace.create', { path: fixtureWorkspacePath });
  workspace = { workspaceId: created.workspace.workspaceId, path: fixtureWorkspacePath };
  result.environment.workspace = workspace;
  if (REUSE_RESOLVED_REPORT) {
    const previous = JSON.parse(await readFile(REUSE_RESOLVED_REPORT, 'utf8'));
    invariant(previous.resolved?.pass === true, 'reused report has no passing resolved result');
    invariant(previous.archive?.pass === true, 'reused resolved report did not archive its sessions');
    result.resolved = previous.resolved;
    result.environment.resolvedEvidenceReport = REUSE_RESOLVED_REPORT;
  } else {
    result.resolved = await runResolved();
  }
  result.unresolved = await runUnresolved();
} catch (error) {
  fatalError = error;
  result.fatalError = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
} finally {
  result.archive = await archiveAll().catch((error) => ({
    attempts: archiveAttempts,
    tracked: trackedSessions.size,
    archived: 0,
    missing: [...trackedSessions],
    pass: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  result.pass = fatalError === null
    && result.resolved?.pass === true
    && result.unresolved?.pass === true
    && result.archive.pass === true;
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(RAW_REPORT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ pass: result.pass, report: RAW_REPORT, fatalError: result.fatalError }, null, 2));
}

if (!result.pass) process.exitCode = 1;
