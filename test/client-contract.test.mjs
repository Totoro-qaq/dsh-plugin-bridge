import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBridgeMigrationCommand,
  parseBridgeCard,
  parseJsonDocument,
} from '../src/client-contract.ts';

const ZH_PREVIEW = `─── 交接摘要 · minimal → code（请过目，重点看数字与路径）───
## 目标
把 API 迁到 8118 端口。

## 当前状态
已有路由与测试。
───────────────────────────────────────────
取材 1200 字符 · 用户消息 4/5 条 · 压缩模型 deepseek-v4-flash · 用时 8s
⚠ 取材因预算被裁剪（old assistant），摘要是基于被裁过的历史写的

没问题就执行：/bridge code --go
要改：编辑 /tmp/summary.md 之后 /bridge code --go --file /tmp/summary.md`;

const EN_PREVIEW = `─── Handoff · standard → minimal (review numbers and paths) ───
## Goal
Keep the current decision and stop after restating it.
───────────────────────────────────────────
Source 980 chars · user messages 3/3 · worker deepseek-v4-flash · 6s

Review and run: /bridge minimal --go`;

test('native card parses Chinese preview into editable Markdown without transport chrome', () => {
  const card = parseBridgeCard({ kind: 'success', text: ZH_PREVIEW });
  assert.equal(card.phase, 'preview');
  assert.equal(card.lang, 'zh');
  assert.equal(card.sourcePreset, 'minimal');
  assert.equal(card.targetPreset, 'code');
  assert.match(card.summary, /^## 目标/);
  assert.doesNotMatch(card.summary, /取材 1200/);
  assert.match(card.stats, /取材 1200/);
  assert.deepEqual(card.warnings, ['取材因预算被裁剪（old assistant），摘要是基于被裁过的历史写的']);
});

test('native card parses English preview and preserves the exact target', () => {
  const card = parseBridgeCard({ kind: 'success', text: EN_PREVIEW });
  assert.equal(card.phase, 'preview');
  assert.equal(card.lang, 'en');
  assert.equal(card.sourcePreset, 'standard');
  assert.equal(card.targetPreset, 'minimal');
  assert.match(card.summary, /## Goal/);
});

test('native card parses created target session for navigation', () => {
  const card = parseBridgeCard({
    kind: 'success',
    text: [
      'Created a new session in the code preset from the edited WebUI preview.',
      'Target session: Checkout API → code · s-target-42',
      'The new session will only restate the handoff, then wait for your confirmation.',
      'The source session is untouched and remains available; archive the target if the handoff is unsatisfactory.',
    ].join('\n'),
  });
  assert.deepEqual(card, {
    phase: 'migrated',
    lang: 'en',
    targetPreset: 'code',
    title: 'Checkout API → code',
    sessionId: 's-target-42',
    details: [
      'The new session will only restate the handoff, then wait for your confirmation.',
      'The source session is untouched and remains available; archive the target if the handoff is unsatisfactory.',
    ],
    warnings: [],
  });
});

test('edited summary command uses bounded base64url and never shell quoting', () => {
  const summary = '## 目标\n端口改成 8118；保留 `*.md`。';
  const command = buildBridgeMigrationCommand('code', summary, 'zh');
  assert.match(command, /^\/bridge code --go --lang zh --summary64 [A-Za-z0-9_-]+$/);
  assert.doesNotMatch(command, /端口|\s['"]/);
});

test('JSON renderer only claims a complete JSON document', () => {
  assert.deepEqual(parseJsonDocument('{"port":8118,"ok":true}'), { port: 8118, ok: true });
  assert.equal(parseJsonDocument('## Goal\n```json\n{"ok":true}\n```'), undefined);
  assert.equal(parseJsonDocument('{broken'), undefined);
});

test('card parser stays linear on adversarial host output', () => {
  const hostilePreview = `─── 交接摘要 · ${' '.repeat(40_000)}→${'→!'.repeat(20_000)}`;
  const hostileTarget = `目标会话：${'a · '.repeat(20_000)}${' '.repeat(40_000)}`;
  const started = performance.now();
  assert.equal(parseBridgeCard({ kind: 'success', text: hostilePreview }).phase, 'message');
  assert.equal(parseBridgeCard({ kind: 'success', text: `已在 code 模式下建好新会话\n${hostileTarget}` }).phase, 'message');
  assert.ok(performance.now() - started < 250, '超长宿主输出必须在线性时间内被拒绝');
});
