import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBridgeSource,
  buildBridgeInstruction,
  buildBridgeKickoff,
  appendVisualEvidence,
  collectVisualEvidence,
  detectLang,
  estimateSummaryTokens,
  summaryTokenBudget,
  SOURCE_CHAR_BUDGET,
  SUMMARY_CHAR_BUDGET,
} from '../src/compression.ts';

const user = (t) => ({ role: 'user', content: t });
const asst = (t, toolNodes) => ({ role: 'assistant', content: t, toolNodes });

test('用户消息全文保留，条数正确', () => {
  const msgs = [user('第一条'), asst('回复一'), user('第二条'), asst('回复二')];
  const src = buildBridgeSource(msgs);
  assert.equal(src.userMessagesUsed, 2);
  assert.equal(src.userMessagesTotal, 2);
  assert.ok(src.text.includes('第一条') && src.text.includes('第二条'));
  assert.equal(src.truncated, false);
  assert.deepEqual(src.dropped, []);
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
  assert.ok(src.text.length <= SOURCE_CHAR_BUDGET);
});

test('预算可被配置覆盖', () => {
  const msgs = [user('x'.repeat(5_000))];
  const src = buildBridgeSource(msgs, { sourceCharBudget: 2_000 });
  assert.equal(src.truncated, true);
  assert.ok(src.text.length <= 2_000);
});

/* --- 语义断言：超预算时保住的必须是"最新"，而不是"最老" ---
 * 0.1 的实现按顺序装、装不下就 slice 后 break，于是活下来的是最老的用户消息，
 * 而承载"刚完成什么/卡在哪"的最近助手结论段整段消失。 */
test('超预算时保留最新的用户消息，丢弃最老的', () => {
  const msgs = [];
  for (let i = 1; i <= 400; i += 1) msgs.push(user(`第${i}条需求：${'细节'.repeat(40)}`));
  msgs.push(user('最后一条：端口必须 7101'));
  const src = buildBridgeSource(msgs, { sourceCharBudget: 8_000 });
  assert.equal(src.truncated, true);
  assert.ok(src.text.includes('7101'), '最新一条用户消息必须在取材里');
  assert.ok(!src.text.includes('第1条需求'), '最老的用户消息应当被丢弃');
  assert.ok(src.dropped.includes('users'));
});

test('超预算时最近助手结论段不会整段消失', () => {
  const msgs = [];
  for (let i = 1; i <= 400; i += 1) msgs.push(user(`第${i}条需求：${'细节'.repeat(40)}`));
  msgs.push(asst('刚刚完成了订单模块的重构'));
  const src = buildBridgeSource(msgs, { sourceCharBudget: 8_000 });
  assert.ok(src.text.includes('刚刚完成了订单模块的重构'), '最近助手结论必须留在取材里');
});

test('超长 compaction 底稿不会把用户消息挤没', () => {
  const msgs = [
    { role: 'assistant', kind: 'compaction', content: '压'.repeat(61_000) },
    user('端口固定 7101，禁止 MongoDB'),
    user('下一步：把 orders.ts 拆成两个模块'),
  ];
  const src = buildBridgeSource(msgs);
  assert.ok(src.text.includes('7101'), 'compaction 再长也不能吃掉用户意图');
  assert.ok(src.text.includes('orders.ts'));
  assert.ok(src.text.length <= SOURCE_CHAR_BUDGET);
});

test('userMessagesUsed 报告真实纳入条数，不是总条数', () => {
  const msgs = [];
  for (let i = 1; i <= 200; i += 1) msgs.push(user(`第${i}条：${'内容'.repeat(30)}`));
  const src = buildBridgeSource(msgs, { sourceCharBudget: 4_000 });
  assert.equal(src.userMessagesTotal, 200);
  assert.ok(src.userMessagesUsed > 0);
  assert.ok(src.userMessagesUsed < 200, `纳入 ${src.userMessagesUsed} 条应当少于总数`);
  const numbered = src.text.split('\n').filter((l) => /^\d+\. /.test(l)).length;
  assert.equal(src.userMessagesUsed, numbered, 'used 必须等于正文里真实出现的条目数');
});

test('空会话不炸，返回空取材', () => {
  const src = buildBridgeSource([]);
  assert.equal(src.text, '');
  assert.equal(src.truncated, false);
  assert.equal(src.userMessagesTotal, 0);
});

test('图片-only 用户消息不会再从压缩输入静默消失', () => {
  const src = buildBridgeSource([{ role: 'user', content: '', imageCount: 2 }]);
  assert.equal(src.userMessagesTotal, 1);
  assert.equal(src.visualEvidence.images, 2);
  assert.equal(src.visualEvidence.unresolved, 1);
  assert.match(src.text, /image attachments: 2/);
});

test('视觉证据逐字追加，不交给摘要模型改写', () => {
  const exact = 'OCR: ERR_43179\n按钮位于右下角；小字看不清。';
  const evidence = collectVisualEvidence([
    { role: 'user', content: '请看报错', imageCount: 1 },
    { role: 'assistant', content: exact },
    { role: 'user', content: '继续' },
  ]);
  const handoff = appendVisualEvidence('## 目标\n修复问题', evidence, 'zh');
  assert.ok(handoff.includes(exact));
  assert.match(handoff, /原文搬运，未经二次摘要/);
  assert.equal(evidence.represented, 1);
  assert.equal(evidence.unresolved, 0);
});

test('未识别图片明确标记 unresolved，禁止猜测', () => {
  const evidence = collectVisualEvidence([{ role: 'user', content: '', imageCount: 1 }]);
  const handoff = appendVisualEvidence('## Goal\nFix it', evidence, 'en');
  assert.match(handoff, /## Unresolved images/);
  assert.match(handoff, /Do not infer/);
});

test('视觉证据预算按完整块省略，不从正文中间截断', () => {
  const exact = '视觉原文'.repeat(200);
  const evidence = collectVisualEvidence([
    { role: 'user', content: '看图', imageCount: 1 },
    { role: 'assistant', content: exact },
  ], 100);
  assert.equal(evidence.included.length, 0);
  assert.equal(evidence.omitted, 1);
  assert.equal(evidence.truncated, true);
  assert.ok(!appendVisualEvidence('摘要', evidence, 'zh').includes(exact.slice(0, 20)));
});

test('压缩指令含固定五段 schema（中/英）', () => {
  for (const s of ['## 目标', '## 当前状态', '## 关键决策', '## 关键文件', '## 下一步']) {
    assert.ok(buildBridgeInstruction('zh').includes(s), s);
  }
  for (const s of ['## Goal', '## Current state', '## Key decisions', '## Key files', '## Next step']) {
    assert.ok(buildBridgeInstruction('en').includes(s), s);
  }
});

test('摘要预算真的会进入指令文本', () => {
  assert.equal(summaryTokenBudget(SUMMARY_CHAR_BUDGET), 900);
  assert.ok(buildBridgeInstruction('zh').includes('≤900 tokens'));
  const tight = buildBridgeInstruction('zh', { summaryCharBudget: 1_200 });
  assert.ok(tight.includes('≤450 tokens'), tight.slice(0, 200));
  assert.equal(estimateSummaryTokens(0, { summaryCharBudget: 1_200 }).output, 450);
});

test('kickoff 双语可用且非空', () => {
  assert.ok(buildBridgeKickoff('zh').length > 10);
  assert.ok(buildBridgeKickoff('en').length > 10);
});

test('成本预估随字符数单调', () => {
  const a = estimateSummaryTokens(1_000);
  const b = estimateSummaryTokens(50_000);
  assert.ok(b.input > a.input);
  assert.equal(a.output, 900);
});

test('语言自动判定跟着取材走', () => {
  assert.equal(detectLang('我们在做电商后端项目，端口 7101'), 'zh');
  assert.equal(detectLang('We are building an e-commerce backend on port 7101'), 'en');
  assert.equal(detectLang(''), 'en');
});
