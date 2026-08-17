/**
 * 交接摘要 schema 契约测试。
 * benchmark 的四层指标（摘要保真/复述/探针/漂移）全部建立在「工人模型严格
 * 输出固定五段摘要」之上，这组测试锁住指令文本里的 schema 约定不被改漂：
 * 段落集合与顺序、各段条数上限、反编造规则、总预算，以及指令与取材的对齐。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBridgeInstruction,
  buildBridgeKickoff,
  buildBridgeSource,
  estimateSummaryTokens,
} from '../src/compression.ts';

/** 提取指令文本中的 schema 标题（## 开头、按出现顺序）。 */
function headersOf(instruction) {
  return [...instruction.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
}

test('zh 指令：恰好五段、标题与顺序固定', () => {
  assert.deepEqual(headersOf(buildBridgeInstruction('zh')), [
    '目标',
    '当前状态',
    '关键决策与约定',
    '关键文件',
    '下一步',
  ]);
});

test('en 指令：恰好五段、标题与顺序固定', () => {
  assert.deepEqual(headersOf(buildBridgeInstruction('en')), [
    'Goal',
    'Current state',
    'Key decisions & conventions',
    'Key files',
    'Next step',
  ]);
});

test('各段条数上限写进指令（schema 的量化约束）', () => {
  const zh = buildBridgeInstruction('zh');
  assert.match(zh, /目标[\s\S]*?1-2 句/, '目标 ≤2 句');
  assert.match(zh, /当前状态[\s\S]*?3-5 句/, '状态 ≤5 句');
  assert.match(zh, /≤5 条/, '决策 ≤5 条');
  assert.match(zh, /≤10 个路径/, '文件 ≤10 路径');
  assert.match(zh, /下一步[\s\S]*?1-2 句/, '下一步 ≤2 句');

  const en = buildBridgeInstruction('en');
  for (const constraint of ['1-2 sentences', '3-5 sentences', '≤5 bullets', '≤10 paths']) {
    assert.ok(en.includes(constraint), constraint);
  }
});

test('反编造与路径来源规则存在（漂移的主要防线）', () => {
  assert.match(buildBridgeInstruction('zh'), /路径必须来自取材，不得编造/);
  assert.match(buildBridgeInstruction('en'), /never invent/i);
});

test('去原模式工具细节的规则存在（迁状态不迁痕迹）', () => {
  assert.match(buildBridgeInstruction('zh'), /删去与原模式工具细节相关的内容/);
  assert.match(buildBridgeInstruction('en'), /drop details tied to the old preset's tools/i);
});

test('决策段要求附理由（决策理由是探针命中率的关键载体）', () => {
  assert.match(buildBridgeInstruction('zh'), /附决策理由/);
  assert.match(buildBridgeInstruction('en'), /include the reasoning/i);
});

test('输出纪律：只要摘要，不要寒暄', () => {
  assert.match(buildBridgeInstruction('zh'), /不要寒暄，直接输出摘要/);
  assert.match(buildBridgeInstruction('en'), /no pleasantries — output the summary only/i);
});

test('总预算契约：指令声明 ≤900 tokens 与成本预估 output 一致', () => {
  assert.match(buildBridgeInstruction('zh'), /≤900 tokens/);
  assert.match(buildBridgeInstruction('en'), /≤900 tokens total/);
  // estimateSummaryTokens 的 output 就是 GUI 成本预估行展示的数字，
  // 必须与指令对工人模型的要求同源。
  assert.equal(estimateSummaryTokens(0).output, 900);
});

test('指令承诺的取材成分与 buildBridgeSource 的实际取材对齐', () => {
  const zh = buildBridgeInstruction('zh');
  // 指令开头声明的取材成分，必须能在真实取材文本里找到对应分区
  for (const part of ['用户消息全文', '助手输出', '压缩摘要']) {
    assert.ok(zh.includes(part), `指令应声明取材含：${part}`);
  }
  const source = buildBridgeSource([
    { role: 'assistant', kind: 'compaction', content: '早前摘要' },
    { role: 'user', content: '需求' },
    { role: 'assistant', content: '结论' },
  ]);
  for (const section of ['【早前上下文压缩摘要】', '【用户消息全文（按时间序）】', '助手输出摘要】']) {
    assert.ok(source.text.includes(section), `取材应含分区：${section}`);
  }
});

test('kickoff：指明 goal 是跨模式交接摘要，并要求复述理解（复述层是验证手段）', () => {
  const zh = buildBridgeKickoff('zh');
  assert.match(zh, /另一套工具模式/);
  assert.match(zh, /复述/);
  const en = buildBridgeKickoff('en');
  assert.match(en, /different tool preset/i);
  assert.match(en, /restating your understanding/i);
});
