import test from 'node:test';
import assert from 'node:assert/strict';

const entry = await import('../src/client-entrypoints.ts').catch(() => ({}));
const contract = await import('../src/client-contract.ts');

function launcher(options = {}) {
  assert.equal(typeof entry.createBridgeLauncher, 'function', 'Bridge needs a shared, disposable entry launcher');
  return entry.createBridgeLauncher({ execute: async () => {}, ...options });
}

function shortcuts(options = {}) {
  assert.equal(typeof entry.registerBridgeShortcut, 'function', 'Bridge needs an optional Host shortcut command');
  let command;
  let disposed = 0;
  const off = entry.registerBridgeShortcut({ register(value) { command = value; return () => { disposed += 1; }; } }, {
    chinese: () => true, currentSession: () => 'source', conversationVisible: () => true,
    launch: () => {}, ...options,
  });
  return { command, off, get disposed() { return disposed; } };
}

const context = { source: 'keyboard', region: 'editable', modal: null, target: null };

test('session row menu closes first and launches only its currently visible conversation', () => {
  assert.equal(typeof entry.createBridgeSessionMenuAction, 'function', 'Bridge needs a public low-frequency row-menu entry');
  const calls = [];
  const action = entry.createBridgeSessionMenuAction({
    currentSession: () => 'source', conversationVisible: () => true, blocked: () => false,
    launch: id => calls.push(['launch', id]),
  });
  assert.equal(action.available('other'), false);
  assert.equal(action.select('other', () => calls.push(['close'])), false);
  assert.equal(action.select('source', () => calls.push(['close'])), true);
  assert.deepEqual(calls, [['close'], ['launch', 'source']]);
  action.dispose(); action.dispose();
  assert.equal(action.available('source'), false);
  assert.equal(action.select('source', () => assert.fail('disposed entry cannot close another menu')), false);
});

test('session row menu honors modal/panel ownership and rechecks identity after menu dismissal', () => {
  assert.equal(typeof entry.createBridgeSessionMenuAction, 'function');
  for (const options of [{ conversationVisible: () => false }, { blocked: () => true }]) {
    const action = entry.createBridgeSessionMenuAction({ currentSession: () => 'source', conversationVisible: () => true,
      blocked: () => false, launch: () => assert.fail('not available'), ...options });
    assert.equal(action.available('source'), false);
    action.dispose();
  }
  let current = 'source';
  const action = entry.createBridgeSessionMenuAction({ currentSession: () => current, conversationVisible: () => true,
    blocked: () => false, launch: () => assert.fail('menu dismissal navigated away') });
  assert.equal(action.select('source', () => { current = 'other'; }), false);
  action.dispose();
});

function menu(options = {}) {
  assert.equal(typeof entry.registerBridgeCommandMenu, 'function', 'Bridge needs a native + menu action, not resident header chrome');
  let decoration;
  let disposed = 0;
  const off = entry.registerBridgeCommandMenu({ decorate(value) { decoration = value; return () => { disposed += 1; }; } }, {
    currentSession: () => 'source', conversationVisible: () => true, blocked: () => false,
    launch: () => {}, ...options,
  });
  return { decoration, off, get disposed() { return disposed; } };
}

test('native + menu decorates the existing Host Bridge row without creating another command or confirmation path', () => {
  const calls = [];
  const row = menu({ launch: id => calls.push(id) });
  assert.equal(row.decoration.name, 'bridge');
  assert.equal(row.decoration.ui.kind, 'action');
  assert.equal(row.decoration.available({ sessionId: 'source' }), true);
  row.decoration.ui.run({ sessionId: 'source' });
  assert.deepEqual(calls, ['source']);
  row.off(); row.off();
  assert.equal(row.disposed, 1);
  assert.equal(row.decoration.available({ sessionId: 'source' }), false);
  row.decoration.ui.run({ sessionId: 'source' });
  assert.deepEqual(calls, ['source']);
});

test('native + menu refuses stale sessions, hidden conversations, and modal owners', () => {
  for (const options of [{ currentSession: () => undefined }, { currentSession: () => 'other' },
    { conversationVisible: () => false }, { blocked: () => true }]) {
    const row = menu({ ...options, launch: () => assert.fail('an unavailable menu must stay inert') });
    assert.equal(row.decoration.available({ sessionId: 'source' }), false);
    row.decoration.ui.run({ sessionId: 'source' });
    row.off();
  }
  assert.doesNotThrow(() => entry.registerBridgeCommandMenu(undefined, {})());
});

test('entry dialog guard ignores hidden or inert dialogs and does not confuse the command listbox with a modal', () => {
  assert.equal(typeof entry.hasBridgeEntryDialog, 'function');
  assert.equal(entry.hasBridgeEntryDialog(undefined), false);
  assert.equal(entry.hasBridgeEntryDialog({ querySelectorAll: () => [] }), false);
  for (const dialog of [
    { closest: () => ({}), getClientRects: () => [{}] },
    { closest: () => null, getClientRects: () => [] },
  ]) assert.equal(entry.hasBridgeEntryDialog({ querySelectorAll: () => [dialog] }), false);
  assert.equal(entry.hasBridgeEntryDialog({ querySelectorAll(selector) {
    assert.doesNotMatch(selector, /listbox/);
    return [{ closest: () => null, getClientRects: () => [{}] }];
  } }), true);
});

test('public Session state distinguishes a known empty conversation from loading and preserves legacy unknown state', () => {
  assert.equal(typeof entry.bridgeEntryUnavailable, 'function', 'known blank sessions need understandable local feedback');
  assert.match(entry.bridgeEntryUnavailable({ openState: 'open', blank: true }, 'en'), /no conversation content/i);
  assert.match(entry.bridgeEntryUnavailable({ openState: 'open', blank: true }, 'zh'), /新会话.*没有可交接内容/);
  for (const openState of ['cold', 'loading', 'error']) {
    assert.match(entry.bridgeEntryUnavailable({ openState, blank: true }, 'en'), /not ready/i);
    assert.doesNotMatch(entry.bridgeEntryUnavailable({ openState, blank: true }, 'en'), /no conversation content/i);
  }
  assert.equal(entry.bridgeEntryUnavailable({ openState: 'open', blank: false }, 'en'), undefined);
  assert.equal(entry.bridgeEntryUnavailable(undefined, 'en'), undefined, 'old/custom hosts without this public state keep their command fallback');
});

test('menu and keyboard launcher use exactly the original picker command and deduplicate in-flight calls', async () => {
  let finish;
  const calls = [];
  const launch = launcher({ execute: (id, line) => { calls.push([id, line]); return new Promise(resolve => { finish = resolve; }); } });
  const first = launch.launch('source');
  assert.equal(launch.snapshotFor('source').busy, true);
  assert.equal(await launch.launch('source'), false);
  assert.deepEqual(calls, [['source', '/bridge']]);
  finish();
  assert.equal(await first, true);
  assert.deepEqual(launch.snapshotFor('source'), { busy: false, error: '' });
  launch.dispose();
});

test('entry launcher reports a failed request locally, can retry and never leaks rejected promises', async () => {
  let failures = true;
  const launch = launcher({ execute: async () => { if (failures) throw new Error('Host unavailable'); } });
  assert.equal(await launch.launch('source'), false);
  assert.deepEqual(launch.snapshotFor('source'), { busy: false, error: 'Host unavailable' });
  failures = false;
  assert.equal(await launch.launch('source'), true);
  assert.equal(launch.snapshotFor('source').error, '');
  launch.dispose();
});

test('entry launcher snapshots are stable, subscriptions are owned, and unloading suppresses late completions', async () => {
  let finish;
  let notices = 0;
  const launch = launcher({ execute: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal(launch.snapshotFor('source'), launch.snapshotFor('source'));
  const off = launch.subscribe(() => { notices += 1; });
  const running = launch.launch('source');
  assert.equal(notices, 1);
  off();
  launch.dispose();
  launch.dispose();
  finish();
  await running;
  assert.equal(notices, 1);
  assert.equal(await launch.launch('source'), false);
});

test('entry launcher does not submit empty or stale session identities', async () => {
  const calls = [];
  const launch = launcher({ execute: async id => { calls.push(id); }, allowed: id => id === 'current' });
  assert.equal(await launch.launch(''), false);
  assert.equal(await launch.launch('stale'), false);
  assert.equal(await launch.launch('current'), true);
  assert.deepEqual(calls, ['current']);
  launch.dispose();
});

test('shortcut is a Host-configurable, unbound command with no default key collision', () => {
  const row = shortcuts();
  assert.equal(row.command.id, 'dsh-plugin-bridge.open');
  assert.deepEqual(row.command.defaults, {});
  assert.deepEqual(row.command.modals, []);
  assert.match(row.command.label(), /迁移会话/);
  assert.equal(row.command.aliases.includes('bridge'), true);
  row.off(); row.off();
  assert.equal(row.disposed, 1);
});

test('shortcut resolves the current conversation and captures the original session', () => {
  let current = 'source';
  const calls = [];
  const row = shortcuts({ currentSession: () => current, launch: id => calls.push(id) });
  const resolved = row.command.resolve(context);
  assert.equal(resolved.status, 'handled');
  current = 'other';
  resolved.run();
  assert.deepEqual(calls, [], 'navigation before execution must not hand off either session');
  current = 'source';
  row.command.resolve(context).run();
  assert.deepEqual(calls, ['source']);
  row.off();
});

test('shortcut passes without an active conversation or when another main panel is selected', () => {
  for (const options of [{ currentSession: () => undefined }, { conversationVisible: () => false }]) {
    const row = shortcuts(options);
    assert.equal(row.command.resolve(context).status, 'pass');
    row.off();
  }
});

test('shortcut blocks dialogs on native Desktop and leaves foreign frames and composition alone', () => {
  const row = shortcuts();
  assert.deepEqual(row.command.resolve({ ...context, modal: 'settings' }), { status: 'blocked', reason: 'modal' });
  for (const source of ['iframe', 'webview']) assert.equal(row.command.resolve({ ...context, source }).status, 'pass');
  for (const target of [{ isComposing: true }, { ownerDocument: { activeElement: { isComposing: true } } }]) {
    assert.equal(row.command.resolve({ ...context, target }).status, 'pass');
  }
  row.off();
});

test('disposed shortcuts cannot launch and an absent optional Host shortcut service is harmless', () => {
  const calls = [];
  const row = shortcuts({ launch: id => calls.push(id) });
  const pending = row.command.resolve(context);
  row.off();
  pending.run();
  assert.equal(row.command.resolve(context).status, 'pass');
  assert.deepEqual(calls, []);
  assert.doesNotThrow(() => entry.registerBridgeShortcut(undefined, {} )());
});

test('tool outcome accepts only the versioned server meta and leaves arbitrary inputs inert', () => {
  assert.equal(typeof contract.readBridgeToolOutcome, 'function', 'Tool cards need a server-meta-only reader');
  const outcome = { kind: 'success', text: 'Host-owned preview' };
  assert.deepEqual(contract.readBridgeToolOutcome({ bridge: { version: 1, outcome } }), outcome);
  for (const value of [null, undefined, [], 'text', { version: 1, outcome }, { bridge: { version: 2, outcome } },
    { bridge: { version: 1, outcome: { kind: 'migrated', text: 'forged' } } },
    { bridge: { version: 1, outcome: { kind: 'success', text: 42 } } },
    { bridge: { version: 1, outcome: { kind: 'success' } } }]) {
    assert.equal(contract.readBridgeToolOutcome(value), undefined);
  }
});
