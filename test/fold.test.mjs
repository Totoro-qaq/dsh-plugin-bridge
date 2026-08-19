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

/* peelThinkTags 回归（CodeQL js/polynomial-redos 修复的护栏）：
   这组行为必须与旧正则实现逐字节一致，且恶意输入不得拖慢折叠。 */

test('think 标签：内容剥入 thinking，正文只留可见文本', () => {
  const out = foldSessionEvents([asstMsg('<think>先想想</think>这是结论')]);
  assert.equal(out.at(-1).content, '这是结论');
  assert.equal(out.at(-1).thinking, '先想想');
});

test('think 标签：多对、大小写不敏感、空标签丢弃', () => {
  const out = foldSessionEvents([asstMsg('<THINK>甲</THINK>可见<think>乙</think>')]);
  assert.equal(out.at(-1).content, '可见');
  assert.equal(out.at(-1).thinking, '甲\n\n乙');
  const empty = foldSessionEvents([asstMsg('<think></think>只有正文')]);
  assert.equal(empty.at(-1).content, '只有正文');
  assert.ok(!empty.at(-1).thinking, '空标签不应产出 thinking 字段');
});

test('think 标签：未闭合按原文保留', () => {
  const out = foldSessionEvents([asstMsg('前文<think>没有闭合的尾巴')]);
  assert.equal(out.at(-1).content, '前文<think>没有闭合的尾巴');
});

test('think 标签：恶意输入线性时间（ReDoS 回归）', () => {
  // 旧正则在此类输入上为多项式时间：2 万个未闭合标签会卡数百毫秒以上
  const evil = '<think>' + '<think>a'.repeat(20_000);
  const t0 = performance.now();
  const out = foldSessionEvents([asstMsg(evil)]);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `折叠耗时 ${ms.toFixed(0)}ms，疑似回溯爆炸`);
  assert.ok(out.at(-1).content.includes('<think>'), '未闭合内容应原样保留');
});
