import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createFakeHost } from './fake-host.mjs';
import { createBridgeCommand } from '../src/command.ts';
import {
  createBridgeHostFromRpc,
  probeBridgeHost,
  REQUIRED_BRIDGE_CAPABILITIES,
} from '../src/host.ts';
import { previewMigration } from '../src/migrate.ts';

const CONFIG = {
  modelTier: 'pro',
  sourceCharBudget: 60_000,
  summaryCharBudget: 2_400,
  goalRounds: 1,
  inject: 'both',
  lang: 'auto',
  previewTimeoutMs: 5_000,
};

test('BridgeHost：迁移核心接受类型化宿主端口，不要求字符串 Rpc 函数', async () => {
  const fake = createFakeHost();
  const host = createBridgeHostFromRpc(fake.rpc, { id: 'fixture-rpc' });

  const result = await previewMigration(host, {
    sessionId: fake.sourceSessionId,
    pollMs: 1,
    workerTimeoutMs: 3_000,
  });

  assert.match(result.summary, /## 目标/);
  assert.equal(host.descriptor.id, 'fixture-rpc');
  assert.equal(fake.state.archived.includes(result.worker.sessionId), true);
});

test('BridgeHost：doctor 探测的是语义能力，不依赖 apiProxy 对象形状', () => {
  const fake = createFakeHost();
  const host = createBridgeHostFromRpc(fake.rpc);
  const report = probeBridgeHost(host);

  assert.equal(report.length, REQUIRED_BRIDGE_CAPABILITIES.length);
  assert.equal(report.every((row) => row.available), true);
});

test('BridgeCommand：可以只注入 hostFor，现有命令体验保持不变', async () => {
  const fake = createFakeHost();
  const host = createBridgeHostFromRpc(fake.rpc);
  const command = createBridgeCommand({
    hostFor: () => host,
    probe: () => probeBridgeHost(host),
    config: CONFIG,
  });

  const result = await command.handler({
    agent: { session: { id: fake.sourceSessionId } },
    rawInput: '',
  });

  assert.equal(result.kind, 'success');
  assert.match(result.text, /可迁入/);
});

test('迁移核心不再包含 DSH 网关路由字符串', async () => {
  const source = await readFile(new URL('../src/migrate.ts', import.meta.url), 'utf8');
  for (const route of [
    'session.list',
    'session.create',
    'session.history',
    'session.models',
    'session.selectModel',
    'session.prompt',
    'session.cancel',
    'session.rename',
    'session.attachment',
    'workspace.list',
    'workspace.archiveSession',
    'agentPreset.list',
    'goal.create',
    'goal.pause',
    'goal.clear',
  ]) {
    assert.equal(source.includes(`'${route}'`), false, `${route} 应只存在于 adapter，不应留在迁移核心`);
  }
});
