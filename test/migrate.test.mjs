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

test('migrate：goal 的自主轮次被限制成 1，而不是上游默认的 256', async () => {
  const host = createFakeHost();
  await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId,
    to: 'code',
    summary: '## 目标\n继续做电商后端',
    lang: 'zh',
  });
  assert.equal(host.state.goals.length, 1);
  assert.equal(host.state.goals[0].maxGoalRounds, 1, '不显式设值就是 256 轮自主循环');
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

test('migrate：--inject goal 时首轮提示只引用目标', async () => {
  const host = createFakeHost();
  const result = await executeMigration(host.rpc, {
    sessionId: host.sourceSessionId, to: 'code', summary: '## 目标\n端口 7101', lang: 'zh', inject: 'goal',
  });
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === result.sessionId,
  );
  assert.ok(!kickoff.payload.content[0].text.includes('7101'));
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
