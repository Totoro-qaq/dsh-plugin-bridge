/**
 * 迁移编排的端到端测试（对着假 host，不烧任何 token）。
 *
 * 0.1 的问题是：被验证的是纯函数与评测脚本，而用户拿到的是一份 SKILL.md，
 * 中间那段「谁去调这些 RPC、按什么顺序、出错怎么办」既没有代码也没有测试。
 * 这组测试锁住的正是那一段。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeHost } from './fake-host.mjs';
import { createApiProxyRpc } from '../src/api-rpc.ts';
import {
  executeMigration,
  findWorkspaceId,
  listPresets,
  migratedTitle,
  previewMigration,
  resolveWorkerModel,
  resolveWorkerPreset,
  waitIdle,
} from '../src/migrate.ts';

const fast = { pollMs: 1, workerTimeoutMs: 3_000 };

test('preview：取材 → 起工人 → 收摘要 → 归档工人', async () => {
  const host = createFakeHost();
  const result = await previewMigration(host.rpc, { sessionId: host.sourceSessionId, tier: 'pro', ...fast });

  assert.match(result.summary, /## 目标/);
  assert.equal(result.lang, 'zh', '取材是中文，摘要语言应自动跟随');
  assert.equal(result.source.userMessagesTotal, 2);
  assert.equal(result.source.truncated, false);
  assert.ok(result.source.text.includes('7101'));
  assert.ok(result.source.text.includes('str_replace_editor src/shop/orders.ts'), '工具痕迹应只留名字与路径');
  assert.ok(!result.source.text.includes('一大段 stdout'), 'stdout 不该进取材');

  const worker = host.state.sessions.get(result.worker.sessionId);
  assert.equal(worker.agentPreset, 'minimal', '工人应当用最省的 preset');
  assert.ok(host.state.archived.includes(result.worker.sessionId), '工人用完必须归档');
  assert.equal(host.state.selected[0].model, 'deepseek-v4-pro', 'pro 档位应选中 pro 模型');
});

test('preview：压缩指令与取材一起发给工人', async () => {
  const host = createFakeHost();
  const result = await previewMigration(host.rpc, { sessionId: host.sourceSessionId, ...fast });
  const workerPrompt = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.worker.sessionId,
  );
  const text = workerPrompt.payload.content[0].text;
  assert.ok(text.includes('## 关键决策与约定'), '固定五段 schema 必须在指令里');
  assert.ok(text.includes('7101'), '取材必须跟在指令后面');
});

test('preview：已有识图回答作为逐字视觉证据追加到摘要', async () => {
  const exact = 'OCR 原文：ERR_IMG_55837；右侧按钮为 Retry。';
  const host = createFakeHost({ sourceImage: { userText: '请看截图', assistantText: exact } });
  const result = await previewMigration(host.rpc, { sessionId: host.sourceSessionId, ...fast });
  assert.ok(result.summary.includes(exact));
  assert.match(result.summary, /视觉证据——原文搬运/);
  assert.equal(result.source.visualEvidence.represented, 1);
});

test('preview：工人出错也不留下垃圾会话', async () => {
  const host = createFakeHost({ workerReply: '' });
  await assert.rejects(
    () => previewMigration(host.rpc, { sessionId: host.sourceSessionId, ...fast }),
    /worker-empty|摘要/,
  );
  assert.equal(host.state.archived.length, 1, '失败路径也要归档工人');
});

test('preview：空会话给出可读的拒绝理由', async () => {
  const host = createFakeHost();
  const empty = await host.handle('session.create', { agentPreset: 'standard' });
  await assert.rejects(
    () => previewMigration(host.rpc, { sessionId: empty.sessionId, ...fast }),
    /还没有可迁移的内容/,
  );
});

test('migrate：goal 的自主轮次被限制成 1，并默认暂停等待确认', async () => {
  const host = createFakeHost();
  await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId,
    to: 'code',
    summary: '## 目标\n继续做电商后端',
    lang: 'zh',
  });
  assert.equal(host.state.goals.length, 1);
  assert.equal(host.state.goals[0].maxGoalRounds, 1, '不显式设值就是 256 轮自主循环');
  assert.equal(host.state.pausedGoals.length, 1, '默认不能让目标在用户看到新会话前自动续跑');
});

test('migrate：目标会话建在目标 preset 上，且落在同一工作区', async () => {
  const host = createFakeHost();
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId, to: 'code', summary: '## 目标\nX', lang: 'zh',
  });
  assert.equal(result.agentPreset, 'code');
  const create = host.state.calls.filter((c) => c.method === 'session.create').at(-1);
  assert.equal(create.payload.workspaceId, 'ws-1');
});

test('migrate：preview worker 改过 host 默认模型也不会污染目标模型', async () => {
  const vision = {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash-vision-exp',
    reasoningEffort: 'high',
  };
  const host = createFakeHost({
    models: {
      current: vision,
      routable: true,
      groups: [{ id: 'deepseek-official', models: [{ id: vision.model }, { id: 'deepseek-v4-pro' }] }],
      failures: [],
    },
  });
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId, to: 'minimal', summary: '## 目标\n继续识图', lang: 'zh',
  });
  assert.equal(result.modelTransferred, true);
  assert.deepEqual(result.sourceModel, vision);
  const targetSelection = host.state.selected.find((item) => item.sessionId === result.sessionId);
  assert.deepEqual(
    [targetSelection.provider, targetSelection.model, targetSelection.reasoningEffort],
    [vision.provider, vision.model, vision.reasoningEffort],
  );
});

test('migrate：默认注入方式让摘要一定进上下文', async () => {
  // 上游 goal.create 本身不注入模型上下文，摘要能被看见依赖 goal-round-driver。
  // 所以默认把摘要也放进首轮提示：任何组装下都成立。
  const host = createFakeHost();
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId, to: 'code', summary: '## 目标\n端口 7101', lang: 'zh',
  });
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId,
  );
  assert.ok(kickoff.payload.content[0].text.includes('7101'), '首轮提示必须带上摘要全文');
  assert.ok(kickoff.payload.content[0].text.includes('复述'), '并要求新会话复述理解');
  assert.ok(kickoff.payload.content[0].text.includes('等待用户确认'), '默认只做理解校验，不继续执行');
});

test('migrate：未解析原图在视觉目标上自动随 kickoff 搬运', async () => {
  const host = createFakeHost({ sourceImage: {}, targetSupportsImages: true });
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId,
    to: 'code',
    summary: '## 目标\n检查未解析截图\n\n## 未解析图片\n- 不得猜测',
    lang: 'zh',
  });
  assert.equal(result.imagesSent, 1);
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId,
  );
  assert.equal(kickoff.payload.content[0].type, 'image');
  assert.match(kickoff.payload.content.at(-1).text, /已附在本次 kickoff/);
});

test('migrate：文本目标拒绝图片时无 token 请求地降级到文本 kickoff', async () => {
  const host = createFakeHost({ sourceImage: {}, targetSupportsImages: false });
  const result = await executeMigration(createApiProxyRpc(host.apiProxy), {
    sessionId: host.sourceSessionId,
    to: 'code',
    summary: '## 目标\n检查未解析截图\n\n## 未解析图片\n- 不得猜测',
    lang: 'zh',
  });
  assert.equal(result.imagesSent, 0);
  assert.match(result.warnings.join('\n'), /不能接收原图/);
  const targetPrompts = host.state.calls.filter(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId,
  );
  assert.equal(targetPrompts.length, 2, '第一次图片准入失败，第二次才提交纯文本；两次都没有重复模型回答');
  assert.equal(targetPrompts.at(-1).payload.content[0].type, 'text');
});

test('migrate：autoContinue 在同一轮继续，但 goal 仍暂停以免追加轮次', async () => {
  const host = createFakeHost();
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId,
    to: 'code',
    summary: '## 目标\n端口 7101',
    lang: 'zh',
    autoContinue: true,
  });
  assert.equal(result.goalPaused, true);
  assert.equal(result.kickoffSent, true);
  assert.equal(host.state.pausedGoals.length, 1);
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId,
  );
  assert.ok(kickoff.payload.content[0].text.includes('继续执行下一步'));
});

test('migrate：pause 失败时先清除 goal、再取消自动启动且不发送 kickoff', async () => {
  const host = createFakeHost({ failPause: true });
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId,
    to: 'code',
    summary: '## 目标\n端口 7101',
    lang: 'zh',
  });
  assert.equal(result.goalPaused, false);
  assert.equal(result.kickoffSent, false);
  assert.match(result.warnings.join('\n'), /已清除目标并取消自动启动/);
  assert.equal(host.state.clearedGoals.length, 1);
  const clearIndex = host.state.calls.findIndex(
    (c) => c.method === 'goal.clear' && c.payload.sessionId === result.sessionId,
  );
  const cancelIndex = host.state.calls.findIndex(
    (c) => c.method === 'session.cancel' && c.payload.sessionId === result.sessionId,
  );
  assert.ok(clearIndex >= 0);
  assert.ok(cancelIndex > clearIndex, '必须先清掉尚未入队的 goal，再取消已排队或运行中的 attempt');
  assert.ok(!host.state.calls.some((c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId));
});

test('migrate：旧 host 没有可选 goal.clear 时仍 fail closed，并明确要求人工检查', async () => {
  const host = createFakeHost({ failPause: true });
  delete host.apiProxy.goals.clear;
  const result = await executeMigration(createApiProxyRpc(host.apiProxy), {
    sessionId: host.sourceSessionId,
    to: 'code',
    summary: '## 目标\n端口 7101',
    lang: 'zh',
  });
  assert.equal(result.goalPaused, false);
  assert.equal(result.kickoffSent, false);
  assert.match(result.warnings.join('\n'), /无法确认目标已清除/);
  assert.match(result.warnings.join('\n'), /apiProxy 上没有 goals\.clear/);
  assert.ok(host.state.calls.some((c) => c.method === 'session.cancel' && c.payload.sessionId === result.sessionId));
  assert.ok(!host.state.calls.some((c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId));
});

test('migrate：没挂 goal 服务时降级而不是失败', async () => {
  const host = createFakeHost({ failGoal: true });
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId, to: 'code', summary: '## 目标\n端口 7101', lang: 'zh',
  });
  assert.equal(result.goalCreated, false);
  assert.equal(result.warnings.length, 1);
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId,
  );
  assert.ok(kickoff.payload.content[0].text.includes('7101'), '降级后摘要仍须进上下文');
});

test('migrate：--inject goal 仍把摘要放进 kickoff，不能让首轮失忆', async () => {
  const host = createFakeHost();
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId, to: 'code', summary: '## 目标\n端口 7101', lang: 'zh', inject: 'goal',
  });
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId,
  );
  assert.ok(kickoff.payload.content[0].text.includes('7101'));
});

test('migrate：空摘要被拒绝', async () => {
  const host = createFakeHost();
  await assert.rejects(
    () => executeMigration(host.rpc, { sessionId: host.sourceSessionId, to: 'code', summary: '   ' }),
    /摘要为空/,
  );
});

test('migrate：新会话标题能看出来源', async () => {
  const host = createFakeHost();
  await host.handle('session.rename', { sessionId: host.sourceSessionId, title: '电商后端' });
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId, to: 'code', summary: '## 目标\nX', lang: 'zh', title: migratedTitle('电商后端', 'code'),
  });
  assert.equal(result.titled, true);
  assert.equal(host.state.renames.at(-1).title, '电商后端 → code');
});

test('waitIdle：会话排队慢也不会被误判成已跑完', async () => {
  // 0.1 的实现先 sleep 2s 再看 running；host 慢一点就会取到上一轮的回答。
  const host = createFakeHost({ startAfterPolls: 3, replyAfterPolls: 2 });
  const created = await host.handle('session.create', { agentPreset: 'standard' });
  await host.handle('session.prompt', { sessionId: created.sessionId, mode: 'queue', content: [{ type: 'text', text: '干活' }] });
  const settled = await waitIdle(host.rpc, created.sessionId, { pollMs: 1, startGraceMs: 500, timeoutMs: 5_000 });
  assert.equal(settled.idle, true);
  assert.equal(settled.started, true, '必须等到它真的跑起来再等它结束');
});

test('preview + execute：worker 轮询不应把 session.list 放大成全局扫描', async () => {
  const host = createFakeHost({ replyAfterPolls: 30 });
  const preview = await previewMigration(host.rpc, {
    sessionId: host.sourceSessionId,
    pollMs: 1,
    workerTimeoutMs: 5_000,
  });
  await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId,
    sourceSession: preview.sourceSession,
    to: 'code',
    summary: preview.summary,
    lang: preview.lang,
  });

  const listCalls = host.state.calls.filter((call) => call.method === 'session.list');
  assert.equal(listCalls.length, 1, '一次迁移只需读取一次源会话列表，worker 状态必须按会话查询');
});

test('档位推断不写死 provider/model', async () => {
  const host = createFakeHost();
  const pro = await resolveWorkerModel(host.rpc, host.sourceSessionId, 'pro');
  assert.equal(pro.model, 'deepseek-v4-pro');
  const flash = await resolveWorkerModel(host.rpc, host.sourceSessionId, 'flash');
  assert.equal(flash.model, 'deepseek-v4-flash');
  const follow = await resolveWorkerModel(host.rpc, host.sourceSessionId, 'current');
  assert.equal(follow.model, 'deepseek-v4');
  const forced = await resolveWorkerModel(host.rpc, host.sourceSessionId, 'pro', { provider: 'x', model: 'y' });
  assert.deepEqual([forced.provider, forced.model, forced.reason], ['x', 'y', 'configured']);
});

test('目录里没有对应档位的模型时退回会话当前模型', async () => {
  const host = createFakeHost({
    models: {
      current: { provider: 'acme', model: 'acme-1' },
      groups: [{ id: 'acme', models: [{ id: 'acme-1' }] }],
    },
  });
  const route = await resolveWorkerModel(host.rpc, host.sourceSessionId, 'pro');
  assert.deepEqual([route.provider, route.model, route.reason], ['acme', 'acme-1', 'fallback-current']);
});

test('preset 列表过滤掉 broken 的', async () => {
  const host = createFakeHost();
  const presets = await listPresets(host.rpc);
  assert.ok(!presets.some((p) => p.id === 'broken-one'));
  assert.equal(await resolveWorkerPreset(host.rpc), 'minimal');
});

test('能找到会话所属工作区', async () => {
  const host = createFakeHost();
  assert.equal(await findWorkspaceId(host.rpc, host.sourceSessionId), 'ws-1');
  assert.equal(await findWorkspaceId(host.rpc, 'unknown'), undefined);
});
