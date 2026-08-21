#!/usr/bin/env node
/** Installed-plugin command smoke for the rc.2 visual acceptance. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { lastAssistantText, listSessions, waitIdle } from '../src/migrate.ts';
import { createRpc, resolveApiBase } from '../src/rpc.ts';

if (process.env.BRIDGE_E2E_ACK !== '1' || !process.env.DSH_API?.trim() || !process.env.BRIDGE_SOURCE_SESSION?.trim()) {
  throw new Error('Set BRIDGE_E2E_ACK=1, isolated DSH_API, and BRIDGE_SOURCE_SESSION.');
}

const API = resolveApiBase(process.env.DSH_API);
const SOURCE = process.env.BRIDGE_SOURCE_SESSION.trim();
const MODEL = process.env.BRIDGE_VISION_MODEL ?? 'deepseek-v4-flash-vision-exp';
const BRIDGE_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_DIR = new URL('../reports/', import.meta.url).pathname;
const REPORT = `${REPORT_DIR}v${BRIDGE_VERSION}-rc11-command-${STAMP}.raw.json`;
const rpc = createRpc({ api: API, prefix: `bridge-rc11-command-${STAMP}`, timeoutMs: 60_000 });
const expected = [
  'VIS-RC11-8472',
  'CYAN TRIANGLE',
  '57431',
  'vision/rc11/evidence.png',
  'MAGENTA CIRCLE',
];

function usageOf(row) {
  const value = row?.projections?.values?.tokenUsage;
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

const before = new Set((await listSessions(rpc)).map((item) => item.sessionId));
let fatalError = null;
const out = {
  stamp: STAMP,
  api: API,
  bridgeVersion: BRIDGE_VERSION,
  sourceSessionId: SOURCE,
  command: null,
  target: null,
  createdSessions: [],
  createdSessionDetails: [],
  archive: null,
  pass: false,
};

try {
  const preview = await rpc('commands/execute', {
    args: { agentId: SOURCE, line: '/bridge minimal', images: [] },
  }, 360_000);
  if (preview?.result?.kind !== 'success') throw new Error(`preview command failed: ${JSON.stringify(preview)}`);
  const migrate = await rpc('commands/execute', {
    args: { agentId: SOURCE, line: '/bridge minimal --go --continue', images: [] },
  }, 360_000);
  out.command = { preview, migrate };
  if (migrate?.result?.kind !== 'success') throw new Error(`migration command failed: ${JSON.stringify(migrate)}`);
  const targetSessionId = migrate.result.text?.match(/session-[0-9a-f-]{36}/i)?.[0];
  if (!targetSessionId) throw new Error(`target session id not found: ${migrate.result.text}`);
  const settled = await waitIdle(rpc, targetSessionId, { timeoutMs: 240_000, pollMs: 1000, startGraceMs: 30_000 });
  if (!settled.idle) throw new Error(`target did not become idle: ${targetSessionId}`);
  const text = await lastAssistantText(rpc, targetSessionId);
  const hits = Object.fromEntries(expected.map((fact) => [fact, text.includes(fact)]));
  const catalog = await rpc('session.models', { sessionId: targetSessionId });
  const rows = await listSessions(rpc);
  const row = rows.find((item) => item.sessionId === targetSessionId);
  out.target = {
    sessionId: targetSessionId,
    text,
    hits,
    hitCount: Object.values(hits).filter(Boolean).length,
    model: catalog.current,
    usage: usageOf(row),
  };
  if (!Object.values(hits).every(Boolean)) throw new Error(`installed command target missed facts: ${JSON.stringify(hits)}`);
  if (catalog.current?.model !== MODEL) throw new Error(`installed command target used ${catalog.current?.model}, expected ${MODEL}`);
} catch (error) {
  fatalError = error;
  out.fatalError = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error);
} finally {
  const rows = await listSessions(rpc).catch(() => []);
  out.createdSessionDetails = rows.filter((item) => !before.has(item.sessionId)).map((item) => ({
    sessionId: item.sessionId,
    preset: item.agentPreset,
    usage: usageOf(item),
  }));
  out.createdSessions = out.createdSessionDetails.map((item) => item.sessionId);
  const attempts = [];
  for (const sessionId of out.createdSessions) {
    try {
      await rpc('session.cancel', { sessionId }).catch(() => undefined);
      await rpc('workspace.archiveSession', { sessionId });
      attempts.push({ sessionId, ok: true });
    } catch (error) {
      attempts.push({ sessionId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const workspaces = await rpc('workspace.list', {}).catch(() => null);
  const archived = new Set(workspaces?.archivedSessionIds ?? []);
  out.archive = {
    attempts,
    missing: out.createdSessions.filter((sessionId) => !archived.has(sessionId)),
    pass: attempts.every((item) => item.ok) && out.createdSessions.every((sessionId) => archived.has(sessionId)),
  };
  out.pass = fatalError === null && out.target?.hitCount === 5 && out.archive.pass;
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ pass: out.pass, report: REPORT, fatalError: out.fatalError ?? null }, null, 2));
}

if (!out.pass) process.exitCode = 1;
