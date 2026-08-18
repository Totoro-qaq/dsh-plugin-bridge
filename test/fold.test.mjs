/**
 * 折叠器测试。
 *
 * 折叠是迁移链路的第一步，也是最容易静默出错的一步：漏掉一种事件 =
 * 取材少一段事实 = 摘要少一个约定，而且不会有任何报错。0.1 里这段代码
 * 住在 eval/ 且零测试覆盖，现在它是产品代码。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foldSessionEvents,
  isCompactCheckpoint,
  stripCompactTags,
  toolDetail,
  toolName,
} from '../src/fold.ts';

let seq = 0;
const ev = (type, data) => ({ type, seq: (seq += 1), time: 1_700_000_000_000 + seq * 1000, data });
const userMsg = (text, extra = {}) => ev('user/message', { content: [{ type: 'text', text }], ...extra });
const asstMsg = (text, turn = 1, step = 1) =>
  ev('assistant/message', { turn, step, message: { content: [{ type: 'text', text }] } });

test('用户与助手消息按时间序折叠', () => {
  const out = foldSessionEvents([userMsg('第一问'), asstMsg('第一答'), userMsg('第二问'), asstMsg('第二答')]);
  assert.deepEqual(out.map((m) => [m.role, m.content]), [
    ['user', '第一问'], ['assistant', '第一答'], ['user', '第二问'], ['assistant', '第二答'],
  ]);
});

test('chunk 增量拼成完整助手消息，turn/end 收尾', () => {
  const out = foldSessionEvents([
    userMsg('问'),
    ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: '前' } }),
    ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: '后' } }),
    ev('turn/end', {}),
  ]);
  assert.equal(out.at(-1).role, 'assistant');
  assert.equal(out.at(-1).content, '前后');
});

test('同一 step 已被 assistant/message 终结时，chunk 不再重复累加', () => {
  const out = foldSessionEvents([
    userMsg('问'),
    ev('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: '答' } }),
    asstMsg('答', 1, 1),
  ]);
  const assistants = out.filter((m) => m.role === 'assistant');
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0].content, '答', '不应折叠成「答答」');
});

test('推理块不进正文', () => {
  const out = foldSessionEvents([
    userMsg('问'),
    ev('assistant/message', {
      turn: 1, step: 1,
      message: { content: [{ type: 'reasoning', thinking: '内心戏' }, { type: 'text', text: '结论' }] },
    }),
  ]);
  assert.equal(out.at(-1).content, '结论');
  assert.equal(out.at(-1).thinking, '内心戏');
});

test('工具调用与结果配对，入参进 detail', () => {
  const out = foldSessionEvents([
    userMsg('看一下'),
    ev('tool/call', { turn: 1, step: 1, tool: 'bash', callId: 'c1', input: { command: 'ls src/' } }),
    ev('tool/result', { turn: 1, step: 1, callId: 'c1', output: '一大堆 stdout' }),
    ev('turn/end', {}),
  ]);
  const node = out.at(-1).toolNodes[0];
  assert.equal(node.title, 'bash');
  assert.equal(node.status, 'done');
  assert.equal(node.detail, 'ls src/');
});

test('runtime-context 之类的噪音用户消息被丢掉', () => {
  const out = foldSessionEvents([
    userMsg('<system-reminder>别忘了什么什么</system-reminder>'),
    userMsg('Current runtime context\ncwd: /tmp'),
    userMsg('真正的需求'),
  ]);
  assert.deepEqual(out.map((m) => m.content), ['真正的需求']);
});

test('compaction 检查点：认 provenance 标记，且剥掉面向模型的 preamble', () => {
  // 上游 frameSummary() 的真实形状。
  const framed = 'This is an automatically generated checkpoint condensing an earlier span '
    + 'of the conversation to free up context. Continue the task directly from the messages '
    + 'that follow, without acknowledging this checkpoint.\n\n'
    + '<compacted-summary>端口 7101，禁止 MongoDB</compacted-summary>';
  const out = foldSessionEvents([
    userMsg(framed, { source: { kind: 'plugin', plugin: 'compact', compactionId: 'x' } }),
    userMsg('继续'),
  ]);
  assert.equal(out[0].kind, 'compaction');
  assert.equal(out[0].content, '端口 7101，禁止 MongoDB');
  assert.ok(!out[0].content.includes('without acknowledging'), 'preamble 是给模型的指令，不该喂给压缩工人');
});

test('compaction 兜底：只有文本标签也能认出来', () => {
  assert.equal(isCompactCheckpoint(undefined, 'x <compacted-summary>y</compacted-summary>'), true);
  assert.equal(isCompactCheckpoint({ source: { kind: 'plugin', plugin: 'compact' } }), true);
  assert.equal(isCompactCheckpoint({ source: { kind: 'user' } }, '普通消息'), false);
  assert.equal(stripCompactTags('前言\n\n<compacted-summary>正文</compacted-summary>'), '正文');
  assert.equal(stripCompactTags('没有标签的文本'), '没有标签的文本');
});

test('图片消息即使没有文本也保留', () => {
  const out = foldSessionEvents([ev('user/message', { content: [{ type: 'image' }] })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].imageCount, 1);
});

test('工具名与入参的兜底解析', () => {
  assert.equal(toolName({ call: { name: 'str_replace_editor' } }), 'str_replace_editor');
  assert.equal(toolName(undefined), 'tool');
  assert.equal(toolDetail({ input: { file_path: '/a/b.ts' } }), '/a/b.ts');
  assert.equal(toolDetail(undefined), '');
});

test('空事件列表返回空数组', () => {
  assert.deepEqual(foldSessionEvents([]), []);
});
