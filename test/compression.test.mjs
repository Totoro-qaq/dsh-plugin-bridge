import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBridgeSource,
  buildBridgeInstruction,
  buildBridgeKickoff,
  estimateSummaryTokens,
  SOURCE_CHAR_BUDGET,
} from '../src/compression.ts';

const user = (t) => ({ role: 'user', content: t });
const asst = (t, toolNodes) => ({ role: 'assistant', content: t, toolNodes });

test('用户消息全文保留，条数正确', () => {
  const msgs = [user('第一条'), asst('回复一'), user('第二条'), asst('回复二')];
  const src = buildBridgeSource(msgs);
  assert.equal(src.userMessagesUsed, 2);
  assert.ok(src.text.includes('第一条') && src.text.includes('第二条'));
});

test('复用最近一次 compaction 摘要当底稿', () => {
  const msgs = [
    { role: 'assistant', kind: 'compaction', content: '旧摘要' },
    user('后续'),
    { role: 'assistant', kind: 'compaction', content: '新摘要' },
  ];
  const src = buildBridgeSource(msgs);
  assert.equal(src.reusedCompaction, true);
  assert.ok(src.text.includes('新摘要'));
  assert.ok(!src.text.includes('【早前上下文压缩摘要】\n旧摘要'));
});

test('工具痕迹只留名字与首个路径，丢弃 stdout', () => {
  const msgs = [asst('做了修改', [{ title: 'edit_file', detail: 'src/a.ts\n+很长的 diff 内容\n更多输出' }])];
  const src = buildBridgeSource(msgs);
  assert.ok(src.text.includes('edit_file src/a.ts'));
  assert.ok(!src.text.includes('很长的 diff 内容'));
});

test('预算截断：超限打 truncated 标记且不超预算', () => {
  const big = '字'.repeat(30_000);
  const msgs = [user(big), user(big), user(big)];
  const src = buildBridgeSource(msgs);
  assert.equal(src.truncated, true);
  assert.ok(src.text.length <= SOURCE_CHAR_BUDGET + 20);
});

test('预算可被配置覆盖', () => {
  const msgs = [user('x'.repeat(5_000))];
  const src = buildBridgeSource(msgs, { sourceCharBudget: 2_000 });
  assert.equal(src.truncated, true);
  assert.ok(src.text.length <= 2_020);
});

test('压缩指令含固定五段 schema（中/英）', () => {
  for (const s of ['## 目标', '## 当前状态', '## 关键决策', '## 关键文件', '## 下一步']) {
    assert.ok(buildBridgeInstruction('zh').includes(s), s);
  }
  for (const s of ['## Goal', '## Current state', '## Key decisions', '## Key files', '## Next step']) {
    assert.ok(buildBridgeInstruction('en').includes(s), s);
  }
});

test('kickoff 双语可用且非空', () => {
  assert.ok(buildBridgeKickoff('zh').length > 10);
  assert.ok(buildBridgeKickoff('en').length > 10);
});

test('成本预估随字符数单调', () => {
  const a = estimateSummaryTokens(1_000);
  const b = estimateSummaryTokens(50_000);
  assert.ok(b.input > a.input);
  assert.ok(a.output === 900);
});
