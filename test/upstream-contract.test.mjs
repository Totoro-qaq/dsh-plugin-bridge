/**
 * 上游契约护栏。
 *
 * dsh 还是 developer preview，README 明说会有破坏性变更。这个插件依赖的上游面
 * 其实很窄——一个命令注册契约、一个 `ctx.apiProxy` 服务、13 个 RPC 方法名。
 * 把它们钉在这里，下一次 rc 变形时是 CI 先说话，而不是用户先说话。
 *
 * 核对基线：dsh 0.1.0-rc.6 / rc.7 / rc.8 与 0.1.1-rc.1 / rc.2。
 * 上游出处见每条断言的注释。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeHost } from './fake-host.mjs';
import { createApiProxyRpc, probeApiProxy, SUPPORTED_METHODS } from '../src/api-rpc.ts';
import { createBridgeCommand } from '../src/command.ts';

/**
 * 我们用到的 RPC 方法名，必须是上游 `RpcMethodMap` 的键
 * （packages/host/apiproxy/src/api/rpc-map.ts）。
 */
const REQUIRED_METHODS = [
  'session.list',
  'session.create',
  'session.history',
  'session.models',
  'session.selectModel',
  'session.prompt',
  'session.cancel',
  'session.rename',
  'workspace.list',
  'workspace.archiveSession',
  'agentPreset.list',
  'goal.create',
  'goal.pause',
];

const CONFIG = {
  modelTier: 'pro',
  sourceCharBudget: 60_000,
  summaryCharBudget: 2_400,
  goalRounds: 1,
  inject: 'both',
  lang: 'auto',
  previewTimeoutMs: 5_000,
};

function commandOn(host, overrides = {}) {
  return createBridgeCommand({
    rpcFor: (signal) => createApiProxyRpc(host.apiProxy, signal),
    probe: () => probeApiProxy(host.apiProxy),
    config: CONFIG,
    ...overrides,
  });
}

test('依赖的 RPC 方法集是冻结的：多一个少一个都要显式改这里', () => {
  assert.deepEqual([...SUPPORTED_METHODS].sort(), [...REQUIRED_METHODS].sort());
});

test('rc.8 图片读取是可选 RPC，不降低 rc.6/rc.7 主链路兼容性', async () => {
  const host = createFakeHost();
  delete host.apiProxy.sessions.attachment;
  assert.equal(probeApiProxy(host.apiProxy).some((row) => row.method === 'session.attachment'), false);
});

test('goal.clear 是 pause 失败时的可选 fail-closed RPC，不改变 doctor 13/13', () => {
  const host = createFakeHost();
  delete host.apiProxy.goals.clear;
  assert.equal(SUPPORTED_METHODS.includes('goal.clear'), false);
  assert.equal(probeApiProxy(host.apiProxy).length, REQUIRED_METHODS.length);
  assert.equal(probeApiProxy(host.apiProxy).every((row) => row.available), true);
});

test('命令定义形状符合上游 CommandDefinition（name/description/input.hint/handler）', () => {
  // packages/interaction/commands/src/index.ts · normalizeDefinition()
  const command = commandOn(createFakeHost());
  assert.equal(typeof command.name, 'string');
  assert.match(command.name, /^[a-z][a-z0-9_-]*$/u, '上游 COMMAND_NAME 的语法');
  assert.ok(command.description.trim().length > 0, '上游要求 description 非空');
  assert.ok(command.input.hint.trim().length > 0, '上游要求 hint 非空');
  assert.equal(typeof command.handler, 'function');
  // 我们没有声明 input.images：rc.8 起注册表会替我们挡下带图片的调用。
  assert.equal(command.input.images, undefined);
});

test('处理器容忍上游后加的字段（rc.8 的 attachments，以及任何未知字段）', async () => {
  const host = createFakeHost();
  const command = commandOn(host);
  const result = await command.handler({
    commandId: 'cmd-1',
    agent: { session: { id: host.sourceSessionId, header: { id: host.sourceSessionId } } },
    rawInput: '',
    attachments: [],            // rc.8 新增
    somethingAddedInRc9: true,  // 未来
    signal: undefined,
  });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /可迁入/);
});

test('会话身份两种取法都认（agent.session.id 与 agent.session.header.id）', async () => {
  const host = createFakeHost();
  const command = commandOn(host);
  const viaHeader = await command.handler({
    agent: { session: { header: { id: host.sourceSessionId } } },
    rawInput: '--doctor',
  });
  assert.equal(viaHeader.kind, 'success', viaHeader.text);
});

test('--doctor：网关面完好时报全绿', async () => {
  const host = createFakeHost();
  const result = await commandOn(host).handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput: '--doctor',
  });
  assert.equal(result.kind, 'success', result.text);
  assert.match(result.text, new RegExp(`${REQUIRED_METHODS.length}/${REQUIRED_METHODS.length} 个方法可用`));
  assert.match(result.text, /当前模式：minimal/);
  assert.match(result.text, /档位 pro/);
});

test('--doctor：上游少了方法时点名说出来，而不是等用户报「用不了」', async () => {
  const host = createFakeHost();
  delete host.apiProxy.sessions.rename;
  delete host.apiProxy.goals.create;
  delete host.apiProxy.goals.pause;
  const result = await commandOn(host).handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput: '--doctor',
  });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /10\/13 个方法可用/);
  assert.match(result.text, /session\.rename/);
  assert.match(result.text, /goal\.create/);
  assert.match(result.text, /goal\.pause/);
  assert.match(result.text, /issues/, '要告诉用户去哪儿报');
});

test('probeApiProxy：整个服务缺失时不炸，全部标记为不可用', () => {
  assert.deepEqual(probeApiProxy(undefined).filter((p) => p.available), []);
  assert.equal(probeApiProxy(undefined).length, REQUIRED_METHODS.length);
});

test('适配器对上游移除的方法是响的，不是哑的', async () => {
  const host = createFakeHost();
  delete host.apiProxy.goals.create;
  const rpc = createApiProxyRpc(host.apiProxy);
  await assert.rejects(() => rpc('goal.create', {}), /apiProxy 上没有 goals\.create/);
});

test('信封解析对齐上游 unary 方法的返回形状', async () => {
  // { rpcId, result: { ok, value } | { ok: false, error: { code, message } } }
  const host = createFakeHost();
  const rpc = createApiProxyRpc(host.apiProxy);
  const value = await rpc('workspace.list', {});
  assert.ok(Array.isArray(value.items), 'ok 时应当拿到 result.value 本身');
  await assert.rejects(() => rpc('session.history', { sessionId: 'nope' }), /session-not-found|没有这个会话/);
});
