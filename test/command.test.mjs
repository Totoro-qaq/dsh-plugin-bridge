/**
 * `/bridge` 命令的端到端测试。
 *
 * 走的就是用户在官方 WebUI 输入框里打 `/bridge code` 之后发生的事：
 * 命令处理器 → 进程内 apiProxy 适配器 → 迁移编排 → 假 host。
 * 不需要真的 host，也不烧 token。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { claimSummaryFile, summaryPathKey } from '../src/summary-file.ts';
import { createFakeHost } from './fake-host.mjs';
import { createApiProxyRpc, probeApiProxy, SUPPORTED_METHODS } from '../src/api-rpc.ts';
import { createBridgeCommand, parseBridgeInput } from '../src/command.ts';
import { estimateSummaryTokens } from '../src/compression.ts';
import { parseBridgeCard } from '../src/client-contract.ts';

const CONFIG = {
  modelTier: 'pro',
  sourceCharBudget: 60_000,
  summaryCharBudget: 2_400,
  goalRounds: 1,
  inject: 'both',
  lang: 'auto',
  previewTimeoutMs: 5_000,
};

function setup(hostOptions = {}, overrides = {}, extraDeps = {}) {
  const host = createFakeHost(hostOptions);
  const files = new Map();
  const command = createBridgeCommand({
    rpcFor: (signal) => createApiProxyRpc(host.apiProxy, signal),
    probe: () => probeApiProxy(host.apiProxy),
    config: { ...CONFIG, ...overrides },
    writeSummary: (sessionId, summary) => {
      const path = `/tmp/fake-${sessionId}-${randomBytes(8).toString('hex')}.md`;
      files.set(path, summary);
      return path;
    },
    readSummary: (path) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    },
    ...extraDeps,
  });
  // attachments 是 rc.8 起注册表必传的字段，这里跟着传，免得测试比真实调用更宽松。
  const invoke = (rawInput, sessionId = host.sourceSessionId) =>
    command.handler({ agent: { session: { id: sessionId } }, rawInput, attachments: [], signal: undefined });
  return { host, command, invoke, files };
}

function previewIdFrom(text) {
  const id = /(?:Preview ID:|预览 ID：)\s*(\S+)/u.exec(text)?.[1];
  assert.ok(id, `missing preview ID in:\n${text}`);
  return id;
}

test('命令定义形状符合上游 CommandDefinition', () => {
  const { command } = setup();
  assert.equal(command.name, 'bridge');
  assert.equal(command.recordInput, false, '编辑后的摘要不能以命令参数写进持久会话日志');
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

test('WebUI 卡片能从真实的用法输出里认出可迁入的模式', async () => {
  const { invoke } = setup();
  const zh = parseBridgeCard(await invoke(''));
  assert.deepEqual(zh.picker, { lang: 'zh', targets: ['standard', 'code', 'cordis'], current: 'minimal' });
  const en = parseBridgeCard(await invoke('--lang en'));
  assert.deepEqual(en.picker, { lang: 'en', targets: ['standard', 'code', 'cordis'], current: 'minimal' });
  const unknown = parseBridgeCard(await invoke('codex'));
  assert.equal(unknown.phase, 'error');
  assert.deepEqual(unknown.picker?.targets, ['standard', 'code', 'cordis']);
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
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  clock += 31 * 60_000;
  const result = await invoke('code --go');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /过期/);
  const payload = Buffer.from('## 目标\n过期编辑稿', 'utf8').toString('base64url');
  const webUiResult = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(webUiResult.kind, 'error');
  assert.match(webUiResult.text, /有效预览|valid preview/i);
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

test('WebUI 编辑后的 base64url 摘要优先于暂存预览，且不会落盘', async () => {
  const { host, invoke, files } = setup();
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  const edited = '## 目标\nWebUI 人工改过：端口其实是 8118\n\n```json\n{"owner":"human"}\n```';
  const payload = Buffer.from(edited, 'utf8').toString('base64url');
  const result = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(result.kind, 'success', result.text);
  assert.ok(host.state.goals[0].objective.includes('8118'), '浏览器编辑稿必须成为迁移唯一事实源');
  assert.match(result.text, /WebUI 里编辑后的预览/);
  assert.equal(files.size, 1, '确认动作不得再写一个摘要文件');
});

test('WebUI summary64 必须绑定有效预览，重复确认返回同一个目标', async () => {
  const { host, invoke } = setup();
  const edited = '## 目标\n用户校对后的唯一摘要';
  const payload = Buffer.from(edited, 'utf8').toString('base64url');

  const withoutPreview = await invoke(`code --go --preview-id preview-missing --summary64 ${payload}`);
  assert.equal(withoutPreview.kind, 'error');
  assert.match(withoutPreview.text, /预览|preview/i);

  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  const first = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  const second = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(first.kind, 'success', first.text);
  assert.deepEqual(second, first, '同一编辑载荷重试必须返回第一次结果');
  assert.equal(host.state.goals.length, 1, '重复确认不得创建第二个目标 goal');
});

test('新预览不会让旧 WebUI 卡片重放成第二次迁移', async () => {
  const { host, invoke } = setup();
  const edited = '## 目标\n旧卡片只允许指向第一次迁移';
  const payload = Buffer.from(edited, 'utf8').toString('base64url');
  const firstPreview = await invoke('code');
  const firstPreviewId = previewIdFrom(firstPreview.text);
  const first = await invoke(`code --go --preview-id ${firstPreviewId} --summary64 ${payload}`);
  assert.equal(first.kind, 'success', first.text);

  const secondPreview = await invoke('code');
  const secondPreviewId = previewIdFrom(secondPreview.text);
  assert.notEqual(secondPreviewId, firstPreviewId);
  const replay = await invoke(`code --go --preview-id ${firstPreviewId} --summary64 ${payload}`);
  assert.deepEqual(replay, first, '旧卡片只能取回它自己的已完成结果');
  assert.equal(host.state.goals.length, 1, '生成新预览后重放旧卡片也不能新建第二个 goal');
});

const base64url = (text) => Buffer.from(text, 'utf8').toString('base64url');

test('同一会话的多张预览卡各自可确认，新预览不会作废旧卡', async () => {
  const { host, invoke } = setup({}, {}, { pollMs: 1 });
  const firstCode = previewIdFrom((await invoke('code')).text);
  const cordis = previewIdFrom((await invoke('cordis')).text);
  const secondCode = previewIdFrom((await invoke('code')).text);

  const first = await invoke(`code --go --preview-id ${firstCode} --summary64 ${base64url('## 目标\n第一张卡')}`);
  assert.equal(first.kind, 'success', first.text);
  const toCordis = await invoke(`cordis --go --preview-id ${cordis} --summary64 ${base64url('## 目标\n第二张卡')}`);
  assert.equal(toCordis.kind, 'success', toCordis.text);
  const wrongTarget = await invoke(`cordis --go --preview-id ${secondCode} --summary64 ${base64url('## 目标\n换目标')}`);
  assert.equal(wrongTarget.kind, 'error', '预览 ID 只能确认它自己的目标模式');
  const third = await invoke(`code --go --preview-id ${secondCode} --summary64 ${base64url('## 目标\n第三张卡')}`);
  assert.equal(third.kind, 'success', third.text);
  assert.deepEqual(
    host.state.goals.map((goal) => ['第一张卡', '第二张卡', '第三张卡'].find((mark) => goal.objective.includes(mark))),
    ['第一张卡', '第二张卡', '第三张卡'],
  );
});

test('手打 --go 用这个目标模式最新的一份预览，用过即失效', async () => {
  const { host, invoke } = setup({}, {}, { pollMs: 1 });
  await invoke('code');
  await invoke('cordis');
  const toCode = await invoke('code --go');
  assert.equal(toCode.kind, 'success', '后来的 cordis 预览不能挤掉 code 预览');
  assert.match(toCode.text, /已在 code 模式下建好新会话/);
  const again = await invoke('code --go');
  assert.equal(again.kind, 'error', '同一份预览不能迁移两次');
  const toCordis = await invoke('cordis --go');
  assert.equal(toCordis.kind, 'success', toCordis.text);
  assert.equal(host.state.goals.length, 2);
});

test('每个会话最多保留 8 份待确认预览，挤掉的是最旧的', async () => {
  const { invoke } = setup({}, {}, { pollMs: 1 });
  const ids = [];
  for (let index = 0; index < 9; index += 1) ids.push(previewIdFrom((await invoke('code')).text));
  const oldest = await invoke(`code --go --preview-id ${ids[0]} --summary64 ${base64url('## 目标\n最旧的卡')}`);
  assert.equal(oldest.kind, 'error');
  assert.match(oldest.text, /没有绑定有效预览/);
  const kept = await invoke(`code --go --preview-id ${ids[1]} --summary64 ${base64url('## 目标\n还在上限内')}`);
  assert.equal(kept.kind, 'success', kept.text);
});

test('预览 ID 绑定来源会话，别的会话拿来确认会被拒绝', async () => {
  const { host, invoke } = setup({}, {}, { pollMs: 1 });
  const previewId = previewIdFrom((await invoke('code')).text);
  const other = await host.handle('session.create', { agentPreset: 'standard' });
  const result = await invoke(`code --go --preview-id ${previewId} --summary64 ${base64url('## 目标\n串会话')}`, other.sessionId);
  assert.equal(result.kind, 'error');
  assert.equal(host.state.goals.length, 0);
});

test('预览失败时显示宿主给的原因和下一步', async () => {
  const noKey = {
    kind: 'error',
    error: { code: 'MISSING_CREDENTIAL', message: 'llm-deepseek: no API key for provider route "deepseek-official"' },
  };
  const { invoke } = setup({ workerReply: '', workerTurnEnd: noKey }, {}, { pollMs: 1 });
  const zh = await invoke('code');
  assert.equal(zh.kind, 'error');
  assert.equal(zh.text, [
    '预览失败：压缩工人请求模型出错（MISSING_CREDENTIAL）。',
    '宿主原因：llm-deepseek: no API key for provider route "deepseek-official"',
    '下一步：在 WebUI 设置的「模型」页填入 API 密钥，再重新运行 /bridge code。',
  ].join('\n'));
  const en = await invoke('code --lang en');
  assert.match(en.text, /^Preview failed: the summary worker's model request failed \(MISSING_CREDENTIAL\)\./u);
  assert.match(en.text, /Next: enter the API key on the Models page of the WebUI settings, then run \/bridge code again\.$/u);
});

test('预览失败：工人没开始运行、超时、空回复各有各的说法', async () => {
  const notStarted = await setup({ startAfterPolls: 10_000 }, {}, { pollMs: 1 }).invoke('code');
  assert.equal(notStarted.kind, 'error');
  assert.match(notStarted.text, /^预览失败：压缩工人 0 秒内没有开始运行/u);
  assert.match(notStarted.text, /稍等片刻，再重新运行 \/bridge code。$/u);

  const timedOut = await setup({ replyAfterPolls: 100_000 }, { previewTimeoutMs: 40 }, { pollMs: 1 }).invoke('code --lang en');
  assert.match(timedOut.text, /^Preview failed: the summary worker did not finish within 0 s and was cancelled\./u);
  assert.match(timedOut.text, /DSH_BRIDGE_PREVIEW_TIMEOUT/u);

  const empty = await setup({ workerReply: '' }, {}, { pollMs: 1 }).invoke('code');
  assert.match(empty.text, /^预览失败：压缩工人跑完了，但没有写出交接摘要（本轮结束原因：completed）。/u);
  assert.match(empty.text, /\/bridge code --tier pro。$/u);
});

test('目标 session.create 暂时失败后可重试同一份 WebUI 编辑稿', async () => {
  const { host, invoke } = setup({ failTargetCreateOnce: 'code' });
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  const edited = '## 目标\n失败后仍保留这份人工校对稿';
  const payload = Buffer.from(edited, 'utf8').toString('base64url');

  const failed = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(failed.kind, 'error');
  assert.match(failed.text, /session\.create|临时无法创建/u);

  const retried = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(retried.kind, 'success', retried.text);
  assert.equal(host.state.goals.length, 1);
});

test('目标 kickoff 失败时返回并缓存同一个部分目标，不允许重试建第二个会话', async () => {
  const { host, invoke } = setup({ failTargetPromptOnce: 'code' });
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  const edited = '## 目标\n目标建好后即使 kickoff 失败也不能重复创建';
  const payload = Buffer.from(edited, 'utf8').toString('base64url');

  const first = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(first.kind, 'success', first.text);
  assert.match(first.text, /目标会话：.+ · s-/u);
  assert.match(first.text, /没有自动启动/u);
  assert.match(first.text, /kickoff 是否送达无法确认/u);
  assert.equal(host.state.goals.length, 1);
  assert.equal(host.state.pausedGoals.length, 1);

  const second = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.deepEqual(second, first, '重复确认必须返回同一个可导航的部分目标');
  assert.equal(host.state.goals.length, 1, 'kickoff 失败后的重试不得创建第二个目标');
});

test('WebUI 摘要载荷损坏或过大时 fail closed', async () => {
  const { invoke } = setup();
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);

  const malformed = await invoke(`code --go --preview-id ${previewId} --summary64 !!!`);
  assert.equal(malformed.kind, 'error');
  assert.match(malformed.text, /摘要载荷/);

  const oversized = Buffer.from('x'.repeat(24_001), 'utf8').toString('base64url');
  const tooLarge = await invoke(`code --go --preview-id ${previewId} --summary64 ${oversized}`);
  assert.equal(tooLarge.kind, 'error');
  assert.match(tooLarge.text, /过长/);
});

test('迁到自己当前的模式会被拒绝', async () => {
  const { invoke } = setup();
  const result = await invoke('minimal');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /已经在 minimal 模式/);
});

test('alpha 的 ptc 与 rc.2 的 code 是双向兼容别名', async () => {
  const alpha = setup({ presets: [
    { id: 'standard', trust: 'system', isDefault: true },
    { id: 'ptc', trust: 'system' },
    { id: 'minimal', trust: 'system' },
  ] });
  const alphaPreview = await alpha.invoke('code');
  assert.equal(alphaPreview.kind, 'success', alphaPreview.text);
  assert.match(alphaPreview.text, /\/bridge ptc --go/);

  const rc2 = setup();
  const rc2Preview = await rc2.invoke('ptc');
  assert.equal(rc2Preview.kind, 'success', rc2Preview.text);
  assert.match(rc2Preview.text, /\/bridge code --go/);
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
  const webUi = parseBridgeInput('code --go --preview-id preview-12345678 --summary64 eyJvayI6dHJ1ZX0');
  assert.equal(webUi.previewId, 'preview-12345678');
  assert.equal(webUi.summary64, 'eyJvayI6dHJ1ZX0');
  assert.equal(parseBridgeInput('  code   --goal-rounds 3 ').goalRounds, 3);
  assert.equal(parseBridgeInput('code --nope').error.code, 'unknown-option');
  assert.equal(parseBridgeInput('code extra').error.code, 'extra-argument');
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

test('参数错误和缺少会话身份跟随命令语言', async () => {
  const { command } = setup({}, { lang: 'en' });
  const invoke = (rawInput, session) => command.handler({
    agent: session ? { session: { id: session } } : {},
    rawInput,
    attachments: [],
  });
  const unknown = await invoke('code --nope', 's-1');
  assert.equal(unknown.kind, 'error');
  assert.match(unknown.text, /Unknown option --nope/);
  assert.match(unknown.text, /Use \/bridge to see the available syntax/);
  assert.doesNotMatch(unknown.text, /[\u3400-\u9fff]/u);

  const lateLang = await setup().invoke('code --nope --lang en');
  assert.match(lateLang.text, /Unknown option --nope/);
  assert.doesNotMatch(lateLang.text, /不认识的参数/);

  const lastLang = await setup().invoke('code --lang zh --nope --lang en');
  assert.match(lastLang.text, /Unknown option --nope/);
  assert.doesNotMatch(lastLang.text, /不认识的参数/);
  const overridden = await setup().invoke('code --lang en --nope --lang zh');
  assert.match(overridden.text, /不认识的参数 --nope/);

  const missing = await invoke('--lang zh');
  assert.match(missing.text, /会话身份/);
  const missingEn = await invoke('--lang en');
  assert.match(missingEn.text, /session identity is unavailable/);
  assert.doesNotMatch(missingEn.text, /[\u3400-\u9fff]/u);
});

test('摘要文件写失败时预览仍成功，并给出下一步', async () => {
  const progress = [];
  const { invoke } = setup({}, {}, {
    pollMs: 1,
    writeSummary: () => { throw new Error('ENOSPC: no space left on device'); },
    onProgress: (message) => { progress.push(message); },
    progressHeartbeatMs: 0,
  });
  const zh = await invoke('code');
  assert.equal(zh.kind, 'success', zh.text);
  assert.match(zh.text, /摘要文件没有保存（ENOSPC: no space left on device）/);
  assert.match(zh.text, /下一步：核对上面的摘要后执行 \/bridge code --go/);
  assert.match(zh.text, /--file <路径>/);
  assert.doesNotMatch(zh.text, /要改：编辑/);
  const card = parseBridgeCard(zh);
  assert.equal(card.phase, 'preview');
  assert.equal(card.summaryFile, undefined);
  assert.match(card.warnings.join('\n'), /摘要文件没有保存/);

  const en = await invoke('code --lang en');
  assert.match(en.text, /The summary file was not saved \(ENOSPC: no space left on device\)/);
  assert.match(en.text, /Next: review the summary above and run \/bridge code --go/);
  assert.doesNotMatch(en.text, /摘要文件没有保存|下一步：|要改：编辑/);

  assert.ok(progress.some((message) => message === '拉取并折叠会话历史…'));
  assert.ok(progress.some((message) => message === '等待摘要…'));
  assert.ok(progress.some((message) => message === 'Reading and folding session history…'));
  assert.ok(progress.some((message) => message === 'Waiting for the summary…'));
  assert.ok(progress.some((message) => message.startsWith('Starting the summary worker')));

  const slow = [];
  const waiting = setup({ replyAfterPolls: 8 }, { previewTimeoutMs: 5_000 }, {
    pollMs: 30,
    progressHeartbeatMs: 20,
    onProgress: (message) => { slow.push(message); },
  });
  const slowResult = await waiting.invoke('code');
  assert.equal(slowResult.kind, 'success', slowResult.text);
  assert.ok(slow.some((message) => message.startsWith('仍在进行：')), slow.join('\n'));
});

test('预览卡片展示可核对的摘要预算，不展示粗估输入费用', async () => {
  const { invoke } = setup({}, {}, { pollMs: 1, progressHeartbeatMs: 0 });
  const result = await invoke('code');
  const chars = Number(/取材 (\d+) 字符/.exec(result.text)?.[1]);
  const budget = estimateSummaryTokens(chars, { summaryCharBudget: CONFIG.summaryCharBudget }).output;
  assert.match(result.text, new RegExp(`摘要预算 ≤${budget} tokens`));
  assert.doesNotMatch(result.text, /输入 tokens|input tokens|estimatedTokens/);
  const card = parseBridgeCard(result);
  assert.match(card.stats, new RegExp(`摘要预算 ≤${budget} tokens`));
});

test('迁移成功后清掉临时摘要；创建失败时保留，过期且未被读取时清掉', async () => {
  const removed = [];
  const kept = setup({ failTargetCreateOnce: 'code' }, {}, {
    pollMs: 1,
    progressHeartbeatMs: 0,
    removeSummary: (file) => { removed.push(file); },
  });
  const preview = await kept.invoke('code');
  const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
  assert.ok(file);
  const failed = await kept.invoke('code --go');
  assert.equal(failed.kind, 'error');
  assert.deepEqual(removed, []);
  const retried = await kept.invoke('code --go');
  assert.equal(retried.kind, 'success', retried.text);
  assert.deepEqual(removed, [file]);

  let clock = 1_000;
  const expiredRemoved = [];
  const host = createFakeHost();
  const files = new Map();
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    now: () => clock,
    pollMs: 1,
    progressHeartbeatMs: 0,
    writeSummary: (sessionId, summary) => {
      const path = `/tmp/dsh-bridge-expired-${randomBytes(4).toString('hex')}/summary-${sessionId}.md`;
      files.set(path, summary);
      return path;
    },
    readSummary: (path) => {
      const summary = files.get(path);
      if (summary === undefined) throw new Error('ENOENT');
      return summary;
    },
    removeSummary: (path) => {
      expiredRemoved.push(path);
      files.delete(path);
    },
  });
  const invoke = (rawInput) => command.handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput,
    attachments: [],
  });
  const first = await invoke('code');
  const expiredFile = /编辑 (\S+) 之后/.exec(first.text)?.[1];
  clock += 31 * 60_000;
  const doctor = await invoke('--doctor');
  assert.equal(doctor.kind, 'success');
  assert.deepEqual(expiredRemoved, [expiredFile]);

  const second = await invoke('code');
  const keptFile = /编辑 (\S+) 之后/.exec(second.text)?.[1];
  clock += 31 * 60_000;
  const migrated = await invoke(`code --go --file ${keptFile}`);
  assert.equal(migrated.kind, 'success', migrated.text);
  assert.ok(expiredRemoved.includes(keptFile), '读过并迁移成功后才删除这份过期摘要');
});

test('--file 对不上活预览时，不删除另一份仍有效的摘要', async () => {
  const removed = [];
  let n = 0;
  const files = new Map();
  const host = createFakeHost();
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    pollMs: 1,
    progressHeartbeatMs: 0,
    writeSummary: (sessionId, summary) => {
      n += 1;
      const path = `/tmp/fake-${sessionId}-${randomBytes(4).toString('hex')}-${n}.md`;
      files.set(path, summary);
      return path;
    },
    readSummary: (path) => {
      const summary = files.get(path);
      if (summary === undefined) throw new Error('ENOENT');
      return summary;
    },
    removeSummary: (path) => {
      removed.push(path);
      files.delete(path);
    },
  });
  const invoke = (rawInput) => command.handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput,
    attachments: [],
  });
  const codePreview = await invoke('code');
  const codeFile = /编辑 (\S+) 之后/.exec(codePreview.text)?.[1];
  const cordisPreview = await invoke('cordis');
  const cordisFile = /编辑 (\S+) 之后/.exec(cordisPreview.text)?.[1];
  const userFile = `/tmp/user-edited-${randomBytes(4).toString('hex')}.md`;
  files.set(userFile, '## 目标\n用户自己的文件');
  const migrated = await invoke(`code --go --file ${userFile}`);
  assert.equal(migrated.kind, 'success', migrated.text);
  assert.ok(host.state.goals.at(-1).objective.includes('用户自己的文件'));
  assert.deepEqual(removed, []);
  const other = await invoke('cordis --go');
  assert.equal(other.kind, 'success', other.text);
  assert.deepEqual(removed, [cordisFile]);
  const original = await invoke('code --go');
  assert.equal(original.kind, 'success', original.text);
  assert.deepEqual(removed, [cordisFile, codeFile]);
});

test('目录符号链接上的 --file 按真实路径认同一份摘要', async () => {
  const removed = [];
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
  const alias = join(tmpdir(), `dsh-bridge-alias-${Date.now()}`);
  symlinkSync(dir, alias);
  const host = createFakeHost({ failTargetCreateOnce: 'code' });
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    pollMs: 1,
    progressHeartbeatMs: 0,
    writeSummary: (_sessionId, summary) => {
      const path = join(dir, 'summary-owned.md');
      writeFileSync(path, summary);
      return path;
    },
    readSummary: (path) => readFileSync(path, 'utf8'),
    removeSummary: (path) => { removed.push(path); },
  });
  const invoke = (rawInput) => command.handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput,
    attachments: [],
  });
  try {
    const preview = await invoke('code');
    assert.equal(preview.kind, 'success', preview.text);
    const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
    assert.ok(file, preview.text);
    const viaAlias = join(alias, basename(file));
    assert.notEqual(viaAlias, file);
    assert.equal(summaryPathKey(viaAlias), summaryPathKey(file));
    const failed = await invoke(`code --go --file ${viaAlias}`);
    assert.equal(failed.kind, 'error', failed.text);
    assert.match(failed.text, /临时无法创建/);
    assert.deepEqual(removed, [], '创建失败时不能按别名或真实路径删掉摘要');
    const retried = await invoke(`code --go --file ${viaAlias}`);
    assert.equal(retried.kind, 'success', retried.text);
    assert.ok(host.state.goals[0].objective.includes('7101'));
    assert.deepEqual(removed, [file], '送达后删除的是登记过的真实路径');
  } finally {
    try { unlinkSync(alias); } catch { /* 链接已不在 */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('交接没有送达时不删除摘要，也不会自动再建一个会话', async () => {
  const removed = [];
  const { host, invoke } = setup({ failPause: true }, {}, {
    pollMs: 1,
    progressHeartbeatMs: 0,
    removeSummary: (file) => { removed.push(file); },
  });
  await invoke('code');
  const paused = await invoke('code --go');
  assert.equal(paused.kind, 'success', paused.text);
  assert.match(paused.text, /没有自动启动/);
  assert.match(paused.text, /暂停交接目标失败/);
  assert.deepEqual(removed, []);
  assert.equal(host.state.goals.length, 1);
  const again = await invoke('code --go');
  assert.equal(again.kind, 'error');
  assert.match(again.text, /没有可用的摘要/);
  assert.equal(host.state.goals.length, 1);
});

test('同一份过期摘要被两路占用时，先结束的那路不会把它清掉', async () => {
  let clock = 1_000;
  const removed = [];
  const files = new Map();
  let n = 0;
  const host = createFakeHost({ failTargetCreateOnce: 'code', replyAfterPolls: 1 });
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    now: () => clock,
    pollMs: 1,
    progressHeartbeatMs: 0,
    writeSummary: (sessionId, summary) => {
      n += 1;
      const path = n === 1
        ? `/tmp/dsh-bridge-held/summary-${sessionId}.md`
        : `/tmp/dsh-bridge-held/summary-${sessionId}-${n}.md`;
      files.set(path, summary);
      return path;
    },
    readSummary: (path) => {
      const summary = files.get(path);
      if (summary === undefined) throw new Error('ENOENT');
      return summary;
    },
    removeSummary: (path) => {
      removed.push(path);
      files.delete(path);
    },
  });
  const invoke = (rawInput) => command.handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput,
    attachments: [],
  });
  const preview = await invoke('code');
  const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
  clock += 31 * 60_000;
  const originalList = host.apiProxy.agentPresets.list;
  const gates = [];
  let blocking = true;
  host.apiProxy.agentPresets.list = async (request, signal) => {
    if (blocking) await new Promise((resolve) => gates.push(resolve));
    return originalList(request, signal);
  };
  const migrating = invoke(`code --go --file ${file}`);
  const holding = invoke(`code --file ${file}`);
  assert.equal(gates.length, 2, '两路都要在第一次 await 之前占住这份摘要');
  gates[0]();
  const failed = await migrating;
  assert.equal(failed.kind, 'error', failed.text);
  assert.match(failed.text, /临时无法创建/);
  assert.deepEqual(removed, []);
  const doctorPromise = invoke('--doctor');
  assert.equal(gates.length, 3);
  gates[2]();
  const doctor = await doctorPromise;
  assert.equal(doctor.kind, 'success', doctor.text);
  assert.deepEqual(removed, [], '另一路还停在拉 preset 时，不能把过期摘要清掉');
  blocking = false;
  gates[1]();
  const held = await holding;
  assert.equal(held.kind, 'success', held.text);
  const later = await invoke('--doctor');
  assert.equal(later.kind, 'success');
  assert.deepEqual(removed, [file]);
});

test('同时两次手打 --go 只会建成一个目标，不管有一份还是两份预览', async () => {
  for (const previews of [1, 2]) {
    const { host, invoke } = setup({ replyAfterPolls: 1 }, {}, { pollMs: 1, progressHeartbeatMs: 0 });
    for (let index = 0; index < previews; index += 1) await invoke('code');
    const results = await Promise.all([invoke('code --go'), invoke('code --go')]);
    assert.equal(results.filter((result) => result.kind === 'success').length, 1, results.map((result) => result.text).join('\n'));
    assert.match(results.find((result) => result.kind === 'error').text, /没有可用的摘要/);
    assert.equal(host.state.goals.length, 1);
  }
});
test('放置失败时保留 WebUI 摘要，修好工作目录后同一份编辑稿可以重试', async () => {
  const removed = [];
  const { host, invoke, files } = setup({}, {}, {
    pollMs: 1,
    progressHeartbeatMs: 0,
    removeSummary: (file) => {
      removed.push(file);
      files.delete(file);
    },
  });
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
  const edited = '## 目标\n工作目录暂时读不到，文件必须留下';
  const payload = Buffer.from(edited, 'utf8').toString('base64url');
  host.state.sessions.get(host.sourceSessionId).currentCwd = '/work/shop/.worktrees/moved';
  const originalList = host.apiProxy.sessions.list;
  let lists = 0;
  host.apiProxy.sessions.list = async (request, signal) => {
    lists += 1;
    if (lists === 2) throw new Error('list exploded');
    return originalList(request, signal);
  };
  const failed = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(failed.kind, 'error', failed.text);
  assert.match(failed.text, /工作目录/);
  assert.equal(host.state.goals.length, 0);
  assert.deepEqual(removed, []);
  assert.equal(files.has(file), true);
  host.apiProxy.sessions.list = originalList;
  const retried = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(retried.kind, 'success', retried.text);
  assert.equal(host.state.goals.length, 1);
  assert.ok(host.state.goals[0].objective.includes('工作目录暂时读不到'));
  assert.deepEqual(removed, [file]);
});

test('没有完整送达的预览不能换编辑稿或同一文件再交接', async () => {
  const removed = [];
  const { host, invoke } = setup({ failTargetPromptOnce: 'code' }, {}, {
    pollMs: 1,
    progressHeartbeatMs: 0,
    removeSummary: (file) => { removed.push(file); },
  });
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
  const edited = '## 目标\n第一份校对稿';
  const payload = Buffer.from(edited, 'utf8').toString('base64url');
  const first = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.equal(first.kind, 'success', first.text);
  assert.match(first.text, /没有自动启动/);
  assert.equal(host.state.goals.length, 1);
  assert.deepEqual(removed, []);

  const other = Buffer.from('## 目标\n另一份编辑稿', 'utf8').toString('base64url');
  const changed = await invoke(`code --go --preview-id ${previewId} --summary64 ${other}`);
  assert.equal(changed.kind, 'error', changed.text);
  assert.match(changed.text, /没有完整送达/);
  assert.equal(host.state.goals.length, 1);

  const same = await invoke(`code --go --preview-id ${previewId} --summary64 ${payload}`);
  assert.deepEqual(same, first);
  assert.equal(host.state.goals.length, 1);

  const againFile = await invoke(`code --go --file ${file}`);
  assert.equal(againFile.kind, 'error', againFile.text);
  assert.match(againFile.text, /不要用同一份文件再迁一次/);
  assert.equal(host.state.goals.length, 1);
  assert.deepEqual(removed, []);
});

function parkNextPresetList(host) {
  const original = host.apiProxy.agentPresets.list;
  let release;
  let park = true;
  host.apiProxy.agentPresets.list = async (request, signal) => {
    if (park) {
      park = false;
      await new Promise((resolve) => { release = resolve; });
    }
    return original(request, signal);
  };
  return {
    release: () => release(),
    parked: () => typeof release === 'function',
  };
}

test('手打 --go 或 WebUI 确认与 --file 同时进行，只会建成一个目标', async () => {
  for (const viaCard of [false, true]) {
    const { host, invoke } = setup({}, {}, { pollMs: 1, progressHeartbeatMs: 0 });
    const preview = await invoke('code');
    const previewId = previewIdFrom(preview.text);
    const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
    const original = host.apiProxy.agentPresets.list;
    const gates = [];
    host.apiProxy.agentPresets.list = async (request, signal) => {
      await new Promise((resolve) => gates.push(resolve));
      return original(request, signal);
    };
    const first = invoke(viaCard ? `code --go --preview-id ${previewId} --summary64 ${base64url('## 目标\n卡片上的这一份')}` : 'code --go');
    const viaFile = invoke(`code --go --file ${file}`);
    assert.equal(gates.length, 2);
    gates[0]();
    gates[1]();
    const results = await Promise.all([first, viaFile]);
    assert.equal(results.filter((result) => result.kind === 'success').length, 1, results.map((result) => result.text).join('\n'));
    assert.match(results.find((result) => result.kind === 'error').text, /正在交接|已经交接|没有绑定有效预览/);
    assert.equal(host.state.goals.length, 1);
  }
});
test('送达时另一路还拿着摘要文件，就不会把它删掉', async () => {
  const removed = [];
  const { host, invoke } = setup({}, {}, {
    pollMs: 1,
    progressHeartbeatMs: 0,
    removeSummary: (file) => { removed.push(file); },
  });
  const preview = await invoke('code');
  const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
  const gate = parkNextPresetList(host);
  const holder = invoke(`code --file ${file}`);
  assert.equal(gate.parked(), true);
  const migrated = await invoke('code --go');
  assert.equal(migrated.kind, 'success', migrated.text);
  assert.deepEqual(removed, []);
  assert.equal(host.state.goals.length, 1);
  gate.release();
  const held = await holder;
  assert.equal(held.kind, 'success', held.text);
  assert.deepEqual(removed, [file]);
  assert.equal(host.state.goals.length, 1);
});

test('超过 8 份时不挤掉正在使用或标记保留的摘要', async () => {
  const removed = [];
  const files = new Map();
  let n = 0;
  const capDir = `/tmp/dsh-bridge-cap-${randomBytes(4).toString('hex')}`;
  const host = createFakeHost({ failTargetPromptOnce: 'code', replyAfterPolls: 1 });
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    pollMs: 1,
    progressHeartbeatMs: 0,
    writeSummary: (_sessionId, summary) => {
      n += 1;
      const path = `${capDir}/summary-${n}.md`;
      files.set(path, summary);
      return path;
    },
    readSummary: (path) => {
      const summary = files.get(path);
      if (summary === undefined) throw new Error('ENOENT');
      return summary;
    },
    removeSummary: (path) => {
      removed.push(path);
      files.delete(path);
    },
  });
  const invoke = (rawInput) => command.handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput,
    attachments: [],
  });
  const first = await invoke('code');
  const firstId = previewIdFrom(first.text);
  const firstFile = /编辑 (\S+) 之后/.exec(first.text)?.[1];
  const payload = Buffer.from('## 目标\n先到但没送达', 'utf8').toString('base64url');
  const partial = await invoke(`code --go --preview-id ${firstId} --summary64 ${payload}`);
  assert.equal(partial.kind, 'success', partial.text);
  assert.deepEqual(removed, []);
  const gate = parkNextPresetList(host);
  const holder = invoke(`code --file ${firstFile}`);
  assert.equal(gate.parked(), true);
  const ids = [];
  for (let index = 0; index < 8; index += 1) ids.push(previewIdFrom((await invoke('code')).text));
  assert.equal(removed.includes(firstFile), false, '保留标记和占用中的文件不能被挤掉');
  assert.equal(removed.includes(`${capDir}/summary-2.md`), true);
  const kept = await invoke(`code --go --preview-id ${firstId} --summary64 ${Buffer.from('## 目标\n换一份', 'utf8').toString('base64url')}`);
  assert.equal(kept.kind, 'error', kept.text);
  assert.match(kept.text, /没有完整送达/);
  assert.equal(host.state.goals.length, 1);
  gate.release();
  await holder;
});

test('同一目标的两份预览，手打 --go 只迁最新的一份', async () => {
  const { host, invoke } = setup({ replyAfterPolls: 1 }, {}, { pollMs: 1, progressHeartbeatMs: 0 });
  const older = previewIdFrom((await invoke('code')).text);
  await invoke('code');
  const first = await invoke('code --go');
  assert.equal(first.kind, 'success', first.text);
  const second = await invoke('code --go');
  assert.equal(second.kind, 'error', second.text);
  assert.match(second.text, /没有可用的摘要/);
  assert.equal(host.state.goals.length, 1);
  const explicit = await invoke(`code --go --preview-id ${older} --summary64 ${base64url('## 目标\n旧卡仍可确认')}`);
  assert.equal(explicit.kind, 'success', explicit.text);
  assert.equal(host.state.goals.length, 2);
});

test('换一个目标模式去迁同一份文件，也会把原来的预览领走', async () => {
  const { host, invoke } = setup({ replyAfterPolls: 1 }, {}, { pollMs: 1, progressHeartbeatMs: 0 });
  const preview = await invoke('code');
  const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
  const viaCordis = await invoke(`cordis --go --file ${file}`);
  assert.equal(viaCordis.kind, 'success', viaCordis.text);
  assert.match(viaCordis.text, /cordis/);
  const again = await invoke('code --go');
  assert.equal(again.kind, 'error', again.text);
  assert.match(again.text, /没有可用的摘要|已经交接/);
  assert.equal(host.state.goals.length, 1);
});

test('别的进程已经送达的文件，手打、WebUI 和另一条命令都不会再迁', async () => {
  const { host, invoke, files } = setup({ replyAfterPolls: 1 }, {}, { pollMs: 1, progressHeartbeatMs: 0 });
  const preview = await invoke('code');
  const previewId = previewIdFrom(preview.text);
  const file = /编辑 (\S+) 之后/.exec(preview.text)?.[1];
  assert.equal(claimSummaryFile(file).complete(), true);
  const typed = await invoke('code --go');
  assert.equal(typed.kind, 'error', typed.text);
  assert.match(typed.text, /已经交接/);
  const web = await invoke(`code --go --preview-id ${previewId} --summary64 ${base64url('## 目标\n卡片再确认')}`);
  assert.equal(web.kind, 'error', web.text);
  assert.match(web.text, /已经交接/);
  const host2 = createFakeHost({ replyAfterPolls: 1 });
  const command2 = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host2.apiProxy),
    config: CONFIG,
    pollMs: 1,
    progressHeartbeatMs: 0,
    readSummary: (path) => files.get(path) ?? '## 目标\n不该再用',
  });
  const again = await command2.handler({
    agent: { session: { id: host2.sourceSessionId } },
    rawInput: `code --go --file ${file}`,
    attachments: [],
  });
  assert.equal(again.kind, 'error', again.text);
  assert.match(again.text, /已经交接/);
  assert.equal(host.state.goals.length, 0);
  assert.equal(host2.state.goals.length, 0);
});

test('已交付记录有上限，超出后最旧的一条不再挡住再迁', async () => {
  const files = new Map();
  const host = createFakeHost({ replyAfterPolls: 1 });
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    pollMs: 1,
    progressHeartbeatMs: 0,
    readSummary: (path) => {
      const summary = files.get(path);
      if (summary === undefined) throw new Error('ENOENT');
      return summary;
    },
    claimSummary: () => ({ release() {}, complete: () => true, seal: () => true }),
  });
  const invoke = (rawInput) => command.handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput,
    attachments: [],
  });
  const paths = [];
  for (let index = 0; index < 65; index += 1) {
    const path = `/tmp/delivered-cap-${index}-${randomBytes(4).toString('hex')}.md`;
    files.set(path, `## 目标\n第 ${index} 份`);
    paths.push(path);
    const result = await invoke(`code --go --file ${path}`);
    assert.equal(result.kind, 'success', result.text);
  }
  const oldest = await invoke(`code --go --file ${paths[0]}`);
  assert.equal(oldest.kind, 'success', oldest.text);
  const newest = await invoke(`code --go --file ${paths[64]}`);
  assert.equal(newest.kind, 'error', newest.text);
  assert.match(newest.text, /已经交接/);
});

test('WebUI 完成缓存有上限，最旧的一条不再重放', async () => {
  const { host, invoke } = setup({ replyAfterPolls: 1 }, {}, { pollMs: 1, progressHeartbeatMs: 0 });
  const firstPayload = base64url('## 目标\n第一张完成缓存');
  const firstPreview = previewIdFrom((await invoke('code')).text);
  const first = await invoke(`code --go --preview-id ${firstPreview} --summary64 ${firstPayload}`);
  assert.equal(first.kind, 'success', first.text);
  for (let index = 0; index < 32; index += 1) {
    const id = previewIdFrom((await invoke('code')).text);
    const result = await invoke(`code --go --preview-id ${id} --summary64 ${base64url(`## 目标\n后续 ${index}`)}`);
    assert.equal(result.kind, 'success', result.text);
  }
  const replay = await invoke(`code --go --preview-id ${firstPreview} --summary64 ${firstPayload}`);
  assert.equal(replay.kind, 'error', replay.text);
  assert.match(replay.text, /没有绑定有效预览/);
  assert.equal(host.state.goals.length, 33);
});

test('用 --file 或 WebUI 卡片确认最新预览后，手打 --go 不会再迁旧的一份', async () => {
  for (const viaCard of [false, true]) {
    const { host, invoke } = setup({ replyAfterPolls: 1 }, {}, { pollMs: 1, progressHeartbeatMs: 0 });
    const older = previewIdFrom((await invoke('code')).text);
    const newer = await invoke('code');
    const file = /编辑 (\S+) 之后/.exec(newer.text)?.[1];
    const confirmed = await invoke(viaCard
      ? `code --go --preview-id ${previewIdFrom(newer.text)} --summary64 ${base64url('## 目标\n最新卡片')}`
      : `code --go --file ${file}`);
    assert.equal(confirmed.kind, 'success', confirmed.text);
    const typed = await invoke('code --go');
    assert.equal(typed.kind, 'error', typed.text);
    assert.match(typed.text, /没有可用的摘要/);
    assert.equal(host.state.goals.length, 1);
    const explicit = await invoke(`code --go --preview-id ${older} --summary64 ${base64url('## 目标\n旧卡仍可确认')}`);
    assert.equal(explicit.kind, 'success', explicit.text);
    assert.equal(host.state.goals.length, 2);
  }
});
test('文件锁不上时，不会把同目标的其他预览标成跳过', async () => {
  const { host, invoke } = setup({ replyAfterPolls: 1 }, {}, { pollMs: 1, progressHeartbeatMs: 0 });
  await invoke('code');
  const newer = await invoke('code');
  const file = /编辑 (\S+) 之后/.exec(newer.text)?.[1];
  const claim = claimSummaryFile(file);
  try {
    assert.equal(typeof claim, 'object');
    const viaFile = await invoke(`code --go --file ${file}`);
    assert.equal(viaFile.kind, 'error', viaFile.text);
    assert.match(viaFile.text, /正在交接/);
  } finally {
    if (typeof claim === 'object') claim.release();
  }
  const typed = await invoke('code --go');
  assert.equal(typed.kind, 'success', typed.text);
  assert.equal(host.state.goals.length, 1);
});

function commandForFile(host, files) {
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    pollMs: 1,
    progressHeartbeatMs: 0,
    readSummary: (path) => {
      const summary = files.get(path);
      if (summary === undefined) throw new Error('ENOENT');
      return summary;
    },
  });
  return (rawInput) => command.handler({
    agent: { session: { id: host.sourceSessionId } },
    rawInput,
    attachments: [],
  });
}

test('两个命令实例同时用 --file 确认，只会建成一个目标', async () => {
  const path = `/tmp/dsh-bridge-race-${randomBytes(4).toString('hex')}.md`;
  const files = new Map([[path, '## 目标\n同一份']]);
  const firstHost = createFakeHost({ replyAfterPolls: 1 });
  const secondHost = createFakeHost({ replyAfterPolls: 1 });
  const [first, second] = await Promise.all([
    commandForFile(firstHost, files)(`code --go --file ${path}`),
    commandForFile(secondHost, files)(`code --go --file ${path}`),
  ]);
  const results = [first, second];
  assert.equal(results.filter((result) => result.kind === 'success').length, 1, results.map((result) => result.text).join('\n'));
  const error = results.find((result) => result.kind === 'error');
  assert.match(error.text, /正在交接/);
  assert.equal(firstHost.state.goals.length + secondHost.state.goals.length, 1);
});

test('交接失败会放开磁盘认领，另一个实例可以再迁同一份文件', async () => {
  const path = `/tmp/dsh-bridge-retry-${randomBytes(4).toString('hex')}.md`;
  const files = new Map([[path, '## 目标\n失败后重试']]);
  const firstHost = createFakeHost({ failTargetCreateOnce: 'code', replyAfterPolls: 1 });
  const secondHost = createFakeHost({ replyAfterPolls: 1 });
  const failed = await commandForFile(firstHost, files)(`code --go --file ${path}`);
  assert.equal(failed.kind, 'error', failed.text);
  const retried = await commandForFile(secondHost, files)(`code --go --file ${path}`);
  assert.equal(retried.kind, 'success', retried.text);
  assert.equal(firstHost.state.goals.length, 0);
  assert.equal(secondHost.state.goals.length, 1);
});

test('建好会话但没送达时，另一个实例用同一份文件会被挡住', async () => {
  const path = `/tmp/dsh-bridge-held-${randomBytes(4).toString('hex')}.md`;
  const files = new Map([[path, '## 目标\n没送达']]);
  const firstHost = createFakeHost({ failTargetPromptOnce: 'code', replyAfterPolls: 1 });
  const secondHost = createFakeHost({ replyAfterPolls: 1 });
  const partial = await commandForFile(firstHost, files)(`code --go --file ${path}`);
  assert.equal(partial.kind, 'success', partial.text);
  assert.match(partial.text, /没有自动启动/);
  const again = await commandForFile(secondHost, files)(`code --go --file ${path}`);
  assert.equal(again.kind, 'error', again.text);
  assert.match(again.text, /没有完整送达/);
  assert.equal(firstHost.state.goals.length + secondHost.state.goals.length, 1);
});

test('本进程里同一份文件同时只迁一次，不依赖磁盘记录', async () => {
  const path = `/tmp/dsh-bridge-local-${randomBytes(4).toString('hex')}.md`;
  const files = new Map([[path, '## 目标\n同一进程']]);
  const host = createFakeHost({ replyAfterPolls: 1 });
  const command = createBridgeCommand({
    rpcFor: () => createApiProxyRpc(host.apiProxy),
    config: CONFIG,
    pollMs: 1,
    progressHeartbeatMs: 0,
    readSummary: (file) => files.get(file),
    claimSummary: () => ({ release() {}, complete: () => true, seal: () => true }),
  });
  const invoke = (rawInput) => command.handler({ agent: { session: { id: host.sourceSessionId } }, rawInput, attachments: [] });
  const results = await Promise.all([invoke(`code --go --file ${path}`), invoke(`code --go --file ${path}`)]);
  assert.equal(results.filter((result) => result.kind === 'success').length, 1, results.map((result) => result.text).join('\n'));
  assert.match(results.find((result) => result.kind === 'error').text, /正在交接/);
  assert.equal(host.state.goals.length, 1);
});

test('认领被换掉或接手的是中断过的交接时，结果里提醒检查多出来的目标', async () => {
  for (const [claim, expected] of [
    [{ interrupted: false, release() {}, complete: () => false, seal: () => false }, /另一个 Bridge 进程也接手了同一份摘要/],
    [{ interrupted: true, release() {}, complete: () => true, seal: () => true }, /之前用这份摘要的一次交接没有正常结束/],
  ]) {
    const path = `/tmp/dsh-bridge-lost-${randomBytes(4).toString('hex')}.md`;
    const host = createFakeHost({ replyAfterPolls: 1 });
    const command = createBridgeCommand({
      rpcFor: () => createApiProxyRpc(host.apiProxy),
      config: CONFIG,
      pollMs: 1,
      progressHeartbeatMs: 0,
      readSummary: () => '## 目标\n被接手',
      claimSummary: () => claim,
    });
    const result = await command.handler({ agent: { session: { id: host.sourceSessionId } }, rawInput: `code --go --file ${path}`, attachments: [] });
    assert.equal(result.kind, 'success', result.text);
    assert.match(result.text, expected);
  }
});
