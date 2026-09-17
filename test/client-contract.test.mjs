import test from 'node:test';
import assert from 'node:assert/strict';

import { Context, Service } from '@deepseek-ai/cordis';

import {
  BRIDGE_NAVIGATION_SERVICE,
  buildBridgeMigrationCommand,
  appendBridgeTextListItem,
  bridgeSessionRoutes,
  openBridgeSession,
  openBridgeSessionWhenVisible,
  parseBridgeCard,
  parseJsonDocument,
  parseBridgeTextProjection,
  removeBridgeTextListItem,
  replaceBridgeTextListItem,
  replaceBridgeTextSection,
  uiLanguageOf,
} from '../src/client-contract.ts';

const PREVIEW_ID = 'preview-12345678';

const ZH_PREVIEW = `─── 交接摘要 · minimal → code（请过目，重点看数字与路径）───
## 目标
把 API 迁到 8118 端口。

## 当前状态
已有路由与测试。
───────────────────────────────────────────
取材 1200 字符 · 用户消息 4/5 条 · 压缩模型 deepseek-v4-flash · 用时 8s
预览 ID：${PREVIEW_ID}
⚠ 取材因预算被裁剪（old assistant），摘要是基于被裁过的历史写的

没问题就执行：/bridge code --go
要改：编辑 /tmp/summary.md 之后 /bridge code --go --file /tmp/summary.md`;

const EN_PREVIEW = `─── Handoff · standard → minimal (review numbers and paths) ───
## Goal
Keep the current decision and stop after restating it.
───────────────────────────────────────────
Source 980 chars · user messages 3/3 · worker deepseek-v4-flash · 6s
Preview ID: ${PREVIEW_ID}

Review and run: /bridge minimal --go`;

const ZH_SUMMARY = `## 目标
把 API 迁到 8118 端口。

## 当前状态
已有路由与测试。

## 关键决策与约定
- 保留原会话
- 确认后才迁移

## 关键文件
- src/command.ts
- src/client.tsx

## 下一步
运行完整验证。`;

const EN_SUMMARY = `## Goal
Move the API to port 8118.

## Current state
Routes and tests exist.

## Key decisions & conventions
- Preserve the source session
- Migrate only after confirmation

## Key files
- src/command.ts
- src/client.tsx

## Next step
Run the complete verification.`;

function field(projection, key) {
  return projection.sections.find((section) => section.key === key);
}

test('native card parses Chinese preview into editable Markdown without transport chrome', () => {
  const card = parseBridgeCard({ kind: 'success', text: ZH_PREVIEW });
  assert.equal(card.phase, 'preview');
  assert.equal(card.lang, 'zh');
  assert.equal(card.sourcePreset, 'minimal');
  assert.equal(card.targetPreset, 'code');
  assert.equal(card.previewId, PREVIEW_ID);
  assert.match(card.summary, /^## 目标/);
  assert.equal(card.summaryFile, '/tmp/summary.md');
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
  assert.equal(card.previewId, PREVIEW_ID);
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
  const command = buildBridgeMigrationCommand('code', summary, 'zh', PREVIEW_ID);
  assert.match(command, /^\/bridge code --go --lang zh --preview-id preview-12345678 --summary64 [A-Za-z0-9_-]+$/);
  assert.doesNotMatch(command, /端口|\s['"]/);
});

test('strict bilingual five-section summaries project to plain text without mutating Markdown', () => {
  for (const [summary, lang] of [[ZH_SUMMARY, 'zh'], [EN_SUMMARY, 'en']]) {
    const projection = parseBridgeTextProjection(summary);
    assert.ok(projection);
    assert.equal(projection.lang, lang);
    assert.equal(projection.markdown, summary, 'entering text mode must preserve every source byte');
    assert.deepEqual(projection.sections.map((section) => section.key), [
      'goal',
      'currentState',
      'keyDecisions',
      'keyFiles',
      'nextStep',
    ]);
    assert.equal(field(projection, 'keyDecisions').text.includes('- '), false);
    assert.equal(field(projection, 'keyFiles').text.includes('- '), false);
  }
});

test('one text-field edit changes only that body and preserves the opaque visual suffix byte-for-byte', () => {
  const suffix = `\n\n## 视觉证据——原文搬运，未经二次摘要
不得改写这一段。

### 源用户消息 4 · 1 张图片
图片原文与 \`## 当前状态\` 字样。`;
  const original = `${ZH_SUMMARY}${suffix}`;
  const projection = parseBridgeTextProjection(original);
  assert.ok(projection);
  assert.equal(projection.opaqueSuffix, suffix.slice(2));

  const edited = replaceBridgeTextSection(projection, 'currentState', '用户已确认文本编辑模式。');
  assert.equal(
    edited,
    original.replace('已有路由与测试。', '用户已确认文本编辑模式。'),
  );
  assert.equal(edited.slice(edited.indexOf('## 视觉证据')), suffix.slice(2));
});

test('fenced code headings cannot masquerade as editable schema headings', () => {
  const withFence = ZH_SUMMARY.replace('把 API 迁到 8118 端口。', `把 API 迁到 8118 端口。

\`\`\`markdown
## 当前状态
## 自定义结构
\`\`\``);
  const projection = parseBridgeTextProjection(withFence);
  assert.equal(projection, undefined);
});

test('text projection fails closed for missing, duplicate, mixed, out-of-order, JSON, and custom structures', () => {
  const invalid = [
    ZH_SUMMARY.replace(/\n\n## 当前状态[\s\S]*?(?=\n\n## 关键决策与约定)/u, ''),
    ZH_SUMMARY.replace('## 当前状态', '## 目标'),
    ZH_SUMMARY.replace('## 当前状态', '## Current state'),
    ZH_SUMMARY.replace('## 当前状态', '## 临时').replace('## 目标', '## 当前状态').replace('## 临时', '## 目标'),
    '{"goal":"move the API"}',
    `${ZH_SUMMARY}\n\n## 备注\n这不是协议允许的附录。`,
    `前置说明\n${ZH_SUMMARY}`,
  ];
  for (const markdown of invalid) {
    assert.equal(parseBridgeTextProjection(markdown), undefined, markdown.slice(0, 80));
  }
});

test('CRLF and every unedited section remain intact while edited list text regenerates Markdown bullets', () => {
  const original = EN_SUMMARY.replaceAll('\n', '\r\n');
  const projection = parseBridgeTextProjection(original);
  assert.ok(projection);
  assert.equal(projection.lineEnding, '\r\n');
  assert.equal(field(projection, 'keyDecisions').text, 'Preserve the source session\r\nMigrate only after confirmation');

  const edited = replaceBridgeTextSection(
    projection,
    'keyDecisions',
    'Preserve the source session\nLet a non-developer review plain text',
  );
  const expectedBody = '- Preserve the source session\r\n- Let a non-developer review plain text';
  assert.equal(edited, original.replace(
    '- Preserve the source session\r\n- Migrate only after confirmation',
    expectedBody,
  ));
  assert.equal(edited.includes('\n') && !edited.includes('\r\n'), false);
});

test('model-produced ordered decision lists remain losslessly editable in text mode', () => {
  const ordered = ZH_SUMMARY.replace(
    '- 保留原会话\n- 确认后才迁移',
    '1. 保留原会话\n2. 确认后才迁移',
  );
  const projection = parseBridgeTextProjection(ordered);
  assert.ok(projection, 'a flat ordered list is still the standard five-section schema');
  const decisions = field(projection, 'keyDecisions');
  assert.equal(decisions.listStyle, 'ordered');
  assert.equal(decisions.text, '保留原会话\n确认后才迁移');
  assert.equal(replaceBridgeTextSection(projection, 'nextStep', '运行 alpha.5 验证。'), ordered.replace(
    '运行完整验证。',
    '运行 alpha.5 验证。',
  ));
});

test('ordered list item edits preserve markers and append the next ordinal', () => {
  const ordered = EN_SUMMARY.replace(
    '- Preserve the source session\n- Migrate only after confirmation',
    '7) Preserve the source session\n8) Migrate only after confirmation',
  );
  const projection = parseBridgeTextProjection(ordered);
  assert.ok(projection);

  const edited = replaceBridgeTextListItem(
    projection,
    'keyDecisions',
    1,
    'Migrate only after explicit confirmation',
  );
  assert.equal(edited, ordered.replace(
    '8) Migrate only after confirmation',
    '8) Migrate only after explicit confirmation',
  ));

  const appended = appendBridgeTextListItem(projection, 'keyDecisions', 'Keep the target paused');
  assert.match(appended, /8\) Migrate only after confirmation\n9\) Keep the target paused/u);
  const appendedProjection = parseBridgeTextProjection(appended);
  assert.ok(appendedProjection);
  assert.equal(removeBridgeTextListItem(appendedProjection, 'keyDecisions', 2), ordered);
});

test('ordered list continuations keep the model-produced unindented value line', () => {
  const ordered = ZH_SUMMARY.replace(
    '- 保留原会话\n- 确认后才迁移',
    '1. 保留原会话\n2. 服务端口固定为：\n8118\n3. 确认后才迁移',
  );
  const projection = parseBridgeTextProjection(ordered);
  assert.ok(projection);
  const decisions = field(projection, 'keyDecisions');
  assert.deepEqual(decisions.items.map((item) => item.text), [
    '保留原会话',
    '服务端口固定为：\n8118',
    '确认后才迁移',
  ]);
  const edited = replaceBridgeTextListItem(projection, 'keyDecisions', 1, '服务端口保持：\n8118');
  assert.equal(edited, ordered.replace('2. 服务端口固定为：\n8118', '2. 服务端口保持：\n8118'));
});

test('wrapped Markdown list continuations stay in one item and other edits preserve them byte-for-byte', () => {
  const wrapped = EN_SUMMARY.replace(
    '- Preserve the source session',
    '- Port:\n8118\n- Preserve the source session',
  );
  const projection = parseBridgeTextProjection(wrapped);
  assert.ok(projection);
  const decisions = field(projection, 'keyDecisions');
  assert.deepEqual(decisions.items.map((item) => item.text), [
    'Port:\n8118',
    'Preserve the source session',
    'Migrate only after confirmation',
  ]);
  const edited = replaceBridgeTextListItem(projection, 'keyDecisions', 1, 'Preserve the source session exactly');
  assert.match(edited, /- Port:\n8118\n- Preserve the source session exactly/u);
  assert.equal(edited.replace('Preserve the source session exactly', 'Preserve the source session'), wrapped);

  const firstEdited = replaceBridgeTextListItem(projection, 'keyDecisions', 0, 'Port changed:\n8118');
  assert.match(firstEdited, /- Port changed:\n8118\n- Preserve the source session/u);
  assert.doesNotMatch(firstEdited, /\n  8118/u, 'editing the first line must retain the original continuation indentation');
});

test('text projection is reversible and list add/remove only touches the selected item span', () => {
  const projection = parseBridgeTextProjection(EN_SUMMARY);
  assert.ok(projection);
  for (const section of projection.sections) {
    assert.equal(replaceBridgeTextSection(projection, section.key, section.text), EN_SUMMARY);
  }
  const appended = appendBridgeTextListItem(projection, 'keyFiles', 'src/new.ts');
  assert.match(appended, /- src\/client\.tsx\n- src\/new\.ts/u);
  const appendedProjection = parseBridgeTextProjection(appended);
  assert.ok(appendedProjection);
  const removed = removeBridgeTextListItem(appendedProjection, 'keyFiles', 2);
  assert.equal(removed, EN_SUMMARY);
});

test('key files may use the generator contract of one bare path per line', () => {
  const bare = EN_SUMMARY.replace('- src/command.ts\n- src/client.tsx', 'src/command.ts\nsrc/client.tsx');
  const projection = parseBridgeTextProjection(bare);
  assert.ok(projection);
  assert.deepEqual(field(projection, 'keyFiles').items.map((item) => item.text), ['src/command.ts', 'src/client.tsx']);
  assert.equal(replaceBridgeTextListItem(projection, 'keyFiles', 1, 'src/client.tsx'), bare);
});

test('sentence sections may use a simple flat bullet presentation without exposing markers', () => {
  const bulleted = ZH_SUMMARY.replace('已有路由与测试。', '- 已有路由。\n- 测试尚未运行。');
  const projection = parseBridgeTextProjection(bulleted);
  assert.ok(projection);
  const current = field(projection, 'currentState');
  assert.equal(current.textStyle, 'bullets');
  assert.equal(current.text, '已有路由。\n测试尚未运行。');
  const edited = replaceBridgeTextSection(projection, 'currentState', '已有路由。\n测试正在运行。');
  assert.match(edited, /## 当前状态\n- 已有路由。\n- 测试正在运行。/u);
});

test('nested lists and every supported Markdown block family fail closed to the source editor', () => {
  const invalid = [
    EN_SUMMARY.replace('- Preserve the source session', '- Preserve the source session\n  - nested decision'),
    EN_SUMMARY.replace('Routes and tests exist.', 'Routes exist.\n<!-- hidden -->'),
    EN_SUMMARY.replace('Routes and tests exist.', 'Routes exist.\n--!>'),
    EN_SUMMARY.replace('Run the complete verification.', '> quoted next step'),
    EN_SUMMARY.replace('Run the complete verification.', '<?processing instruction?>'),
    EN_SUMMARY.replace('Run the complete verification.', '---'),
    EN_SUMMARY.replace('Run the complete verification.', 'Setext heading\n==='),
    EN_SUMMARY.replace('Run the complete verification.', '| A | B |\n| --- | --- |\n| 1 | 2 |'),
    EN_SUMMARY.replace('Run the complete verification.', '[owner]: https://example.com'),
    EN_SUMMARY.replace('Run the complete verification.', '    indented code'),
  ];
  for (const markdown of invalid) assert.equal(parseBridgeTextProjection(markdown), undefined);
});

test('plain-text edits cannot introduce Markdown block structure into a canonical section', () => {
  const projection = parseBridgeTextProjection(ZH_SUMMARY);
  assert.ok(projection);
  const edited = replaceBridgeTextSection(
    projection,
    'nextStep',
    '## 这只是用户输入的普通文字\n- 这也不是新的列表结构',
  );
  assert.match(edited, /## 下一步\n\\## 这只是用户输入的普通文字\n\\- 这也不是新的列表结构$/u);
  const reparsed = parseBridgeTextProjection(edited);
  assert.ok(reparsed, 'plain-text serialization must keep the five-section schema valid');
  assert.equal(field(reparsed, 'nextStep').text, '## 这只是用户输入的普通文字\n- 这也不是新的列表结构');

  const blockLike = replaceBridgeTextSection(
    projection,
    'nextStep',
    '---\n<?note?>\n| --- | --- |\n[owner]: https://example.com',
  );
  const blockLikeProjection = parseBridgeTextProjection(blockLike);
  assert.ok(blockLikeProjection);
  assert.equal(
    field(blockLikeProjection, 'nextStep').text,
    '---\n<?note?>\n| --- | --- |\n[owner]: https://example.com',
  );
  assert.throws(
    () => replaceBridgeTextSection(projection, 'nextStep', '    indented code'),
    /four spaces/u,
  );
});

test('migration command checks trimmed emptiness but encodes the exact original summary bytes', () => {
  const summary = ' \r\n## Goal\r\nKeep both edge spaces.  \r\n ';
  const command = buildBridgeMigrationCommand('code', summary, 'en', PREVIEW_ID);
  const payload = command.slice(command.lastIndexOf(' ') + 1);
  assert.equal(Buffer.from(payload, 'base64url').toString('utf8'), summary);
  assert.throws(() => buildBridgeMigrationCommand('code', ' \r\n\t ', 'en', PREVIEW_ID), /empty/u);
  assert.throws(
    () => buildBridgeMigrationCommand('code', '## Goal\nX', 'en --continue', PREVIEW_ID),
    /language/u,
  );
  assert.throws(() => buildBridgeMigrationCommand('code', '## Goal\nX', 'en', 'bad'), /preview ID/u);
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

test('text projection heading scan stays linear on adversarial whitespace', () => {
  const hostile = `##\t${'\t'.repeat(80_000)}x\n${EN_SUMMARY}`;
  const started = performance.now();
  assert.equal(parseBridgeTextProjection(hostile), undefined);
  assert.ok(performance.now() - started < 250, 'heading parsing must not backtrack over host-controlled whitespace');
});

test('running card follows the official WebUI document language', () => {
  assert.equal(uiLanguageOf('en'), 'en');
  assert.equal(uiLanguageOf('en-US'), 'en');
  assert.equal(uiLanguageOf('zh-CN'), 'zh');
  assert.equal(uiLanguageOf('zh-Hans'), 'zh');
  assert.equal(uiLanguageOf(''), 'en');
  assert.equal(uiLanguageOf(undefined), 'en');
});

/** Session list double with the `ctx.sessions.list` face: snapshot byId plus subscribe. */
function fakeSessionList(ids) {
  const byId = Object.fromEntries(ids.map((id) => [id, { id }]));
  const listeners = new Set();
  return {
    listeners,
    getSnapshot: () => ({ byId: { ...byId } }),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    add(id) {
      byId[id] = { id };
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * Client ctx double recording every navigation call in order.
 * `navigation(calls)` builds what `ctx.get('uiWorkspace')` returns (openSession since DSH 0.1.5-alpha.2);
 * `legacyOpen` adds `sessions.open`, which DSH 0.1.6-alpha.2 removed.
 */
function fakeClientContext({ ids = ['target'], navigation, legacyOpen = false, legacyFailure } = {}) {
  const calls = [];
  const list = fakeSessionList(ids);
  const sessions = { list };
  if (legacyOpen) {
    sessions.open = (id) => {
      calls.push(['sessions.open', id]);
      if (legacyFailure) throw legacyFailure;
    };
  }
  const service = navigation?.(calls);
  return {
    calls,
    list,
    sessions,
    get: (name) => (name === BRIDGE_NAVIGATION_SERVICE ? service : undefined),
  };
}

/** `uiWorkspace` double; `failure` makes openSession throw after recording the call. */
const navigatorFor = (failure) => (calls) => ({
  openSession(target) {
    calls.push(['uiWorkspace.openSession', target]);
    if (failure) throw failure;
  },
});

test('session navigation prefers the uiWorkspace service when the host provides it', async () => {
  // DSH 0.1.5-alpha.2 through 0.1.6-alpha.1 offer both paths; navigate once, through the view owner.
  const older = fakeClientContext({ legacyOpen: true, navigation: navigatorFor() });
  assert.deepEqual(bridgeSessionRoutes(older), ['uiWorkspace.openSession', 'sessions.open']);
  assert.equal(openBridgeSession(older, 'target', 'en'), 'uiWorkspace.openSession');
  assert.deepEqual(older.calls, [['uiWorkspace.openSession', 'target']]);

  // DSH 0.1.6-alpha.2 offers only the navigation service.
  const alpha2 = fakeClientContext({ navigation: navigatorFor() });
  assert.deepEqual(bridgeSessionRoutes(alpha2), ['uiWorkspace.openSession']);
  assert.equal(await openBridgeSessionWhenVisible(alpha2, 'target', { lang: 'zh' }), 'uiWorkspace.openSession');
  assert.deepEqual(alpha2.calls, [['uiWorkspace.openSession', 'target']]);
});

test('session navigation falls back to sessions.open on hosts without uiWorkspace.openSession', async () => {
  // DSH 0.1.0 and 0.1.1: no uiWorkspace service at all.
  const legacy = fakeClientContext({ legacyOpen: true });
  assert.deepEqual(bridgeSessionRoutes(legacy), ['sessions.open']);
  assert.equal(await openBridgeSessionWhenVisible(legacy, 'target', { lang: 'en' }), 'sessions.open');
  assert.deepEqual(legacy.calls, [['sessions.open', 'target']]);

  // DSH 0.1.2 through 0.1.5-alpha.1: uiWorkspace exists but has no openSession.
  const dsh012 = fakeClientContext({ legacyOpen: true, navigation: () => ({ archiveSession: async () => {} }) });
  assert.equal(openBridgeSession(dsh012, 'target', 'zh'), 'sessions.open');

  // A context without ctx.get, or whose get throws, still reaches the legacy path.
  const withoutGet = fakeClientContext({ legacyOpen: true });
  delete withoutGet.get;
  assert.equal(openBridgeSession(withoutGet, 'target', 'en'), 'sessions.open');
  const strictGet = fakeClientContext({ legacyOpen: true });
  strictGet.get = () => { throw new Error('cannot get property "uiWorkspace" without inject'); };
  assert.equal(openBridgeSession(strictGet, 'target', 'en'), 'sessions.open');
});

test('session navigation fails fast with a localized error when the host offers no route', async () => {
  const bare = fakeClientContext();
  assert.deepEqual(bridgeSessionRoutes(bare), []);
  assert.throws(() => openBridgeSession(bare, 'target', 'en'), /exposes no session navigation.*open it from the sidebar/u);
  assert.throws(() => openBridgeSession(bare, 'target', 'zh'), /没有提供插件可用的会话导航.*请从侧边栏打开/u);

  const unlisted = fakeClientContext({ ids: [] });
  const started = performance.now();
  await assert.rejects(
    openBridgeSessionWhenVisible(unlisted, 'target', { lang: 'zh', timeoutMs: 10_000 }),
    /没有提供插件可用的会话导航/u,
  );
  assert.ok(performance.now() - started < 1_000, 'a host without navigation must not wait for the list');
  assert.equal(unlisted.list.listeners.size, 0);
});

test('a throwing navigation service falls back to sessions.open or surfaces a localized cause', () => {
  const failure = new Error('sessions.retain: unknown session target');

  const older = fakeClientContext({ legacyOpen: true, navigation: navigatorFor(failure) });
  assert.equal(openBridgeSession(older, 'target', 'en'), 'sessions.open');
  assert.deepEqual(older.calls, [['uiWorkspace.openSession', 'target'], ['sessions.open', 'target']]);

  const alpha2 = fakeClientContext({ navigation: navigatorFor(failure) });
  assert.throws(
    () => openBridgeSession(alpha2, 'target', 'en'),
    (error) => error.message === 'Could not open target session target: sessions.retain: unknown session target'
      && error.cause === failure,
  );
  assert.throws(
    () => openBridgeSession(alpha2, 'target', 'zh'),
    (error) => error.message === '无法打开目标会话 target：sessions.retain: unknown session target',
  );

  const bothFail = fakeClientContext({
    legacyOpen: true,
    legacyFailure: new Error('unknown session'),
    navigation: navigatorFor(failure),
  });
  assert.throws(() => openBridgeSession(bothFail, 'target', 'en'), (error) => error.cause === failure);
  assert.deepEqual(bothFail.calls, [['uiWorkspace.openSession', 'target'], ['sessions.open', 'target']]);
});

test('session navigation waits until the created target is listed, then releases the subscription', async () => {
  const ctx = fakeClientContext({ ids: [], navigation: navigatorFor() });
  const opened = openBridgeSessionWhenVisible(ctx, 'target', { lang: 'en', timeoutMs: 10_000 });
  await Promise.resolve();
  assert.deepEqual(ctx.calls, [], 'DSH 0.1.6-alpha.2 retain() throws for a session that is not listed yet');
  assert.equal(ctx.list.listeners.size, 1);
  ctx.list.add('other');
  assert.deepEqual(ctx.calls, []);
  ctx.list.add('target');
  assert.equal(await opened, 'uiWorkspace.openSession');
  assert.deepEqual(ctx.calls, [['uiWorkspace.openSession', 'target']]);
  assert.equal(ctx.list.listeners.size, 0);
});

test('session navigation wait times out with localized copy and stops when the plugin disposes', async () => {
  const late = fakeClientContext({ ids: [], legacyOpen: true });
  await assert.rejects(
    openBridgeSessionWhenVisible(late, 'target', { lang: 'en', timeoutMs: 5 }),
    (error) => error.message === 'Target session target has not reached this browser yet.',
  );
  await assert.rejects(
    openBridgeSessionWhenVisible(late, 'target', { lang: 'zh', timeoutMs: 5 }),
    /目标会话 target 还没有同步到当前浏览器/u,
  );
  assert.equal(late.list.listeners.size, 0);
  assert.deepEqual(late.calls, []);

  const disposed = fakeClientContext({ ids: [], legacyOpen: true });
  const fiber = new AbortController();
  const waiting = openBridgeSessionWhenVisible(disposed, 'target', { lang: 'en', signal: fiber.signal, timeoutMs: 10_000 });
  await Promise.resolve();
  assert.equal(disposed.list.listeners.size, 1);
  fiber.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(disposed.list.listeners.size, 0);
  disposed.list.add('target');
  assert.deepEqual(disposed.calls, [], 'a disposed plugin fiber must not navigate later');
  await assert.rejects(
    openBridgeSessionWhenVisible(disposed, 'target', { lang: 'en', signal: fiber.signal }),
    { name: 'AbortError' },
  );
});

test('a real Cordis client fiber reaches an un-injected uiWorkspace service through ctx.get', async () => {
  const calls = [];
  const root = new Context();
  const list = fakeSessionList(['target']);
  root.provide('sessions', { list });
  await root.plugin({
    name: 'ui-layout',
    apply: (ctx) => { ctx.provide('layout', { selectPanel: (panel) => { calls.push(['layout.selectPanel', panel]); } }); },
  });

  // Mirrors DSH 0.1.6-alpha.2 UiWorkspaceService: a named Service whose method reads its own injected layout.
  class UiWorkspace extends Service {
    constructor(ctx) {
      super(ctx, BRIDGE_NAVIGATION_SERVICE);
    }

    openSession(target) {
      calls.push(['uiWorkspace.openSession', target]);
      this.ctx.layout.selectPanel(null);
    }
  }
  await root.plugin({ name: 'ui-workspace', inject: ['layout'], apply: (ctx) => { new UiWorkspace(ctx); } });

  let bridgeCtx;
  const bridge = await root.plugin({ name: 'bridge-client', inject: ['sessions'], apply: (ctx) => { bridgeCtx = ctx; } });
  assert.throws(() => bridgeCtx.uiWorkspace, /without inject/u, 'property access stays strict for undeclared services');
  assert.deepEqual(bridgeSessionRoutes(bridgeCtx), ['uiWorkspace.openSession']);
  assert.equal(await openBridgeSessionWhenVisible(bridgeCtx, 'target', { lang: 'en' }), 'uiWorkspace.openSession');
  assert.deepEqual(calls, [['uiWorkspace.openSession', 'target'], ['layout.selectPanel', null]]);
  await bridge.dispose();
});
