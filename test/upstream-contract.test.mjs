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
import { readFile } from 'node:fs/promises';
import semver from 'semver';

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

test('DSH alpha.5 admission uses the bounded patch range and preserves the verified alpha.4 SDK baseline', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(semver.satisfies('0.2.1-alpha.5', pkg.engines.dsh, { includePrerelease: true }), true);
  assert.equal(semver.satisfies('0.2.1-alpha.6', pkg.engines.dsh, { includePrerelease: true }), true);
  assert.equal(semver.satisfies('0.2.2-alpha.1', pkg.engines.dsh, { includePrerelease: true }), false);
  assert.equal(lock.packages[''].engines.dsh, pkg.engines.dsh);
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh-api-session-controller'], '0.2.1-alpha.4');
});

test('both READMEs document the alpha.3/alpha.4 HMR upgrade boundary before removal', async () => {
  for (const file of ['README.md', 'README.zh.md']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes('already-installed'), `${file} must explain repeated-install refusal`);
    const guard = text.split('\n\n').find(paragraph => paragraph.includes('already-installed'));
    assert.ok(/running[^\n]*pluginManager[^\n]*Remote|运行中[^\n]*pluginManager[^\n]*Remote/u.test(guard),
      `${file} must scope the refusal to the running plugin manager / Remote API`);
    assert.ok(guard.includes('installBundle()'), `${file} must identify the guarded API`);
    assert.ok(guard.includes('0.2.1-alpha.4'), `${file} must explicitly scope the current alpha.4 behavior`);
    const cli = text.split('\n\n').find(paragraph => paragraph.startsWith('For CLI replacement') || paragraph.startsWith('CLI 替换时'));
    assert.ok(/stop[^\n]*Host[^\n]*remove[^\n]*add[^\n]*start|停止[^\n]*宿主[^\n]*remove[^\n]*add[^\n]*启动/u.test(cli),
      `${file} must distinguish the CLI stop, remove/add, start sequence`);
    const remove = text.indexOf('removeBundle(name)');
    const install = text.indexOf('installBundle(spec)');
    assert.ok(remove >= 0 && install > remove, `${file} must describe remove before install`);
    assert.ok(/plugin-install-over-installed\/guide(?:\.zh)?\.md/u.test(text));
    assert.ok(/in memory|内存/u.test(text), `${file} must warn about pending previews`);
    assert.ok(/finish or save|先完成或保存/u.test(text), `${file} must put pending work before removal`);
    assert.ok(/Desktop[^\n]*0\.2\.0-rc\.2|桌面端[^\n]*0\.2\.0-rc\.2/u.test(text));
  }
});

test('both READMEs separate current admission from acceptance and retain the diagnosed host limitation', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const file of ['README.md', 'README.zh.md']) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes('docs/compatibility/dsh-0.2.1-alpha.4-2026-10-16.md'));
    assert.ok(text.includes('docs/compatibility/dsh-0.2.1-alpha.3-2026-10-15.md'));
    assert.ok(text.includes('docs/compatibility/dsh-0.2.1-alpha.5-2026-10-17.md'));
    assert.ok(text.includes('0.4.7'));
    assert.ok(text.includes('0.4.6'));
    assert.ok(text.includes('>=0.2.1-alpha.1 <0.2.2-0'), `${file} must explain the bounded admission range`);
    assert.match(text, /Support policy|兼容策略/u);
    assert.ok(/mixed-format|混合格式/u.test(text), `${file} must preserve the observed Text fallback boundary`);
    assert.ok(/different-business-byte|不同业务字节/u.test(text), `${file} must preserve the hot replacement boundary`);
    assert.ok(text.includes('pnpm 11.22.0'), `${file} must identify the affected host package-manager version`);
    assert.ok(text.includes('11.26.0'), `${file} must recommend a version with the upstream fixes`);
    assert.ok(/actual pnpm|宿主实际.*pnpm/u.test(text), `${file} must distinguish the Host executable from a shell version`);
    assert.ok(/overlapping package operations|重叠包操作/u.test(text), `${file} must avoid retrying over a pending package operation`);
    assert.ok(/historical[^\n]*not a PASS|历史[^\n]*不算 PASS/u.test(text), `${file} must preserve the original failed operation`);
    assert.ok(text.includes(`github:Totoro-qaq/dsh-plugin-bridge#v${pkg.version}`));
    assert.doesNotMatch(text, /publication is paused|发布暂停|0\.4\.6 is an unpublished candidate|0\.4\.6 是未发布候选版/u);
  }
});

test('alpha.4 acceptance retains the failed incident, natural pnpm attribution and precise restart boundaries', async () => {
  const text = await readFile(new URL('../docs/compatibility/dsh-0.2.1-alpha.4-2026-10-16.md', import.meta.url), 'utf8');
  assert.ok(text.includes('60-second'));
  assert.ok(text.includes('not a PASS'));
  assert.ok(text.includes('18-event'));
  assert.ok(text.includes('delegationDepth: 0'));
  assert.ok(text.includes('source log was not byte-identical'));
  assert.ok(text.includes('90-second'));
  assert.ok(text.includes('3,453 ms'));
  assert.ok(text.includes('not-removable'));
  assert.ok(text.includes('natural DSH'));
  assert.ok(text.includes('13226-only'));
  assert.ok(text.includes('same initial lockfile'));
  assert.ok(text.includes('original PID'));
  assert.ok(text.includes('11.26.0'));
  assert.doesNotMatch(text, /publication remains paused/u);
});

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
