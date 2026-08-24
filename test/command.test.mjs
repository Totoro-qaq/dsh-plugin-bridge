/**
 * `/bridge` 命令的端到端测试。
 *
 * 走的就是用户在官方 WebUI 输入框里打 `/bridge code` 之后发生的事：
 * 命令处理器 → 进程内 apiProxy 适配器 → 迁移编排 → 假 host。
 * 不需要真的 host，也不烧 token。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeHost } from './fake-host.mjs';
import { createApiProxyRpc, probeApiProxy, SUPPORTED_METHODS } from '../src/api-rpc.ts';
import { createBridgeCommand, parseBridgeInput } from '../src/command.ts';

const CONFIG = {
  modelTier: 'pro',
  sourceCharBudget: 60_000,
  summaryCharBudget: 2_400,
  goalRounds: 1,
  inject: 'both',
  lang: 'auto',
  previewTimeoutMs: 5_000,
};

function setup(hostOptions = {}, overrides = {}) {
  const host = createFakeHost(hostOptions);
  const files = new Map();
  const command = createBridgeCommand({
    rpcFor: (signal) => createApiProxyRpc(host.apiProxy, signal),
    probe: () => probeApiProxy(host.apiProxy),
    config: { ...CONFIG, ...overrides },
    writeSummary: (sessionId, summary) => {
      const path = `/tmp/fake-${sessionId}.md`;
      files.set(path, summary);
      return path;
    },
    readSummary: (path) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    },
  });
  // attachments 是 rc.8 起注册表必传的字段，这里跟着传，免得测试比真实调用更宽松。
  const invoke = (rawInput, sessionId = host.sourceSessionId) =>
    command.handler({ agent: { session: { id: sessionId } }, rawInput, attachments: [], signal: undefined });
  return { host, command, invoke, files };
}

test('命令定义形状符合上游 CommandDefinition', () => {
  const { command } = setup();
  assert.equal(command.name, 'bridge');
  assert.ok(command.description.length > 10);
  assert.equal(typeof command.handler, 'function');
  assert.ok(command.input.hint.includes('preset'));
  assert.ok(command.input.hint.includes('--doctor'), '自检入口要出现在提示里');
});

test('命令列表文案跟随 lang，auto 默认用单行双语', () => {
  const auto = setup({}, { lang: 'auto' }).command;
  assert.match(auto.description, /Migrate across tool presets/);
  assert.match(auto.description, /跨 preset 迁移会话/);
  assert.equal(auto.description.includes('\n'), false);
  assert.match(auto.input.hint, /preset\/模式/);

  const en = setup({}, { lang: 'en' }).command;
  assert.match(en.description, /^Migrate this session/);
  assert.doesNotMatch(en.description, /[\u3400-\u9fff]/u);
  assert.match(en.input.hint, /^<preset>/);

  const zh = setup({}, { lang: 'zh' }).command;
  assert.match(zh.description, /^把这个会话迁移/);
  assert.doesNotMatch(zh.description, /Migrate/);
  assert.match(zh.input.hint, /^<模式>/);
});

test('/bridge 不带参数：列出可迁入的模式与当前模式', async () => {
  const { invoke } = setup();
  const result = await invoke('');
  assert.equal(result.kind, 'success');
  assert.match(result.text, /可迁入/);
  assert.match(result.text, /code/);
  assert.match(result.text, /当前：minimal/);
  assert.ok(!result.text.includes('minimal ·'), '当前模式不该出现在可迁入列表里');
});

test('/bridge code：出摘要、落盘、给出确认命令，且不动任何会话', async () => {
  const { host, invoke } = setup();
  const before = host.state.sessions.size;
  const result = await invoke('code');
  assert.equal(result.kind, 'success', result.text);
  assert.match(result.text, /## 目标/);
  assert.match(result.text, /取材 \d+ 字符 · 用户消息 2\/2 条/);
  assert.match(result.text, /\/bridge code --go/);
  assert.equal(host.state.goals.length, 0, '预览阶段不该挂任何目标');
  assert.equal(host.state.sessions.size, before + 1, '只多出一个压缩工人');
  assert.equal(host.state.archived.length, 1, '工人用完即归档');
});

test('/bridge --lang en：预览与确认正文全程英文，并由暂存预览继承语言', async () => {
  const { invoke } = setup();
  const preview = await invoke('code --lang en');
  assert.equal(preview.kind, 'success', preview.text);
  assert.match(preview.text, /Handoff · minimal → code/);
  assert.match(preview.text, /Review and run: \/bridge code --go/);
  assert.doesNotMatch(preview.text, /交接摘要|没问题就执行/);

  const migrated = await invoke('code --go');
  assert.equal(migrated.kind, 'success', migrated.text);
  assert.match(migrated.text, /Created a new session in the code preset/);
  assert.match(migrated.text, /wait for your confirmation/);
  assert.doesNotMatch(migrated.text, /[\u3400-\u9fff]/u);
});

test('/bridge code --go：用预览的摘要建目标会话，goal 只给一轮', async () => {
  const { host, invoke } = setup();
  await invoke('code');
  const result = await invoke('code --go');
  assert.equal(result.kind, 'success', result.text);
  assert.match(result.text, /已在 code 模式下建好新会话/);
  assert.match(result.text, /目标会话：.+ · s-/);
  assert.match(result.text, /暂停等待你确认/);
  assert.match(result.text, /原会话原封不动/);
  assert.equal(host.state.goals.length, 1);
  assert.equal(host.state.goals[0].maxGoalRounds, 1);
  assert.equal(host.state.pausedGoals.length, 1);
  assert.ok(host.state.goals[0].objective.includes('7101'));
  assert.equal(
    host.state.calls.filter((call) => call.method === 'session.list').length,
    2,
    '预览和确认是两次命令调用，每次只应读取一次源会话列表',
  );
});

test('/bridge code --go --continue：同一轮继续，goal 仍暂停', async () => {
  const { host, invoke } = setup();
  await invoke('code');
  const result = await invoke('code --go --continue');
  assert.equal(result.kind, 'success', result.text);
  assert.match(result.text, /同一轮复述理解并继续下一步/);
  assert.match(result.text, /不触发额外 goal 轮次/);
  assert.equal(host.state.pausedGoals.length, 1);
  const targetPrompt = host.state.calls.filter((c) => c.method === 'session.prompt').at(-1);
  assert.ok(targetPrompt.payload.content[0].text.includes('继续执行下一步'));
});

test('没预览就 --go 会被拦住', async () => {
  const { invoke } = setup();
  const result = await invoke('code --go');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /先跑 \/bridge code/);
});

test('预览过期后 --go 会被拦住', async () => {
  const host = createFakeHost();
  let clock = 1_000;
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    now: () => clock,
  });
  const invoke = (raw) => command.handler({ agent: { session: { id: host.sourceSessionId } }, rawInput: raw });
  await invoke('code');
  clock += 31 * 60_000;
  const result = await invoke('code --go');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /过期/);
});

test('改过的摘要文件优先于暂存的预览', async () => {
  const { host, invoke, files } = setup();
  const preview = await invoke('code');
  const path = /编辑 (\S+) 之后/.exec(preview.text)[1];
  files.set(path, '## 目标\n人工改过：端口其实是 7999');
  const result = await invoke(`code --go --file ${path}`);
  assert.equal(result.kind, 'success', result.text);
  assert.ok(host.state.goals[0].objective.includes('7999'), '摘要文件是唯一事实源');
});

test('迁到自己当前的模式会被拒绝', async () => {
  const { invoke } = setup();
  const result = await invoke('minimal');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /已经在 minimal 模式/);
});

test('未知或坏掉的 preset 给出可用列表', async () => {
  const { invoke } = setup();
  for (const target of ['nope', 'broken-one']) {
    const result = await invoke(target);
    assert.equal(result.kind, 'error');
    assert.match(result.text, /可迁入/);
  }
});

test('参数写错时给的是可执行的提示，不是堆栈', async () => {
  const { invoke } = setup();
  const result = await invoke('code --tier ultra');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /flash \/ current \/ pro/);
});

test('拿不到会话身份时不炸', async () => {
  const { command } = setup();
  const result = await command.handler({ agent: {}, rawInput: 'code' });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /会话身份/);
});

test('空会话给出可读理由而不是崩溃', async () => {
  const { host, command } = setup();
  const empty = await host.handle('session.create', { agentPreset: 'standard' });
  const result = await command.handler({ agent: { session: { id: empty.sessionId } }, rawInput: 'code' });
  assert.equal(result.kind, 'error');
  assert.match(result.text, /还没有可迁移的内容/);
});

test('取材被裁剪时预览会明说', async () => {
  const { invoke } = setup({}, { sourceCharBudget: 120 });
  const result = await invoke('code');
  assert.equal(result.kind, 'success', result.text);
  assert.match(result.text, /取材因预算被裁剪/);
});

test('--tier 覆盖部署默认档位', async () => {
  const { host, invoke } = setup();
  await invoke('code --tier flash');
  assert.equal(host.state.selected.at(-1).model, 'deepseek-v4-flash');
});

test('参数解析', () => {
  assert.deepEqual(parseBridgeInput('code'), { preset: 'code', go: false, help: false, doctor: false, autoContinue: false });
  assert.equal(parseBridgeInput('--doctor').doctor, true);
  assert.equal(parseBridgeInput('code --go').go, true);
  assert.equal(parseBridgeInput('code --go --continue').autoContinue, true);
  assert.equal(parseBridgeInput('code --tier=flash').tier, 'flash');
  assert.equal(parseBridgeInput('  code   --goal-rounds 3 ').goalRounds, 3);
  assert.match(parseBridgeInput('code --nope').error, /不认识的参数/);
  assert.match(parseBridgeInput('code extra').error, /多余的参数/);
  assert.equal(parseBridgeInput('').preset, undefined);
});

test('apiProxy 适配器：映射齐全，未映射的方法报清楚', async () => {
  const { host } = setup();
  const rpc = createApiProxyRpc(host.apiProxy);
  assert.ok(SUPPORTED_METHODS.includes('goal.create'));
  assert.ok(SUPPORTED_METHODS.includes('goal.pause'));
  const listed = await rpc('agentPreset.list', {});
  assert.ok(listed.presets.length > 0);
  await assert.rejects(() => rpc('session.export', {}), /没有映射/);
});

test('apiProxy 适配器：网关业务错误原样透出', async () => {
  const { host } = setup();
  const rpc = createApiProxyRpc(host.apiProxy);
  await assert.rejects(() => rpc('session.create', { agentPreset: 'nope' }), /agent-preset-not-found|未知 preset/);
});
