import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));

test('native + command runtime consumes only the trigger span and leaves argued Bridge commands with their original Host claim', async () => {
  const { registerBridgeCommandMenu } = await import('../src/client-entrypoints.ts');
  const { Context } = require('@deepseek-ai/cordis');
  let factory;
  vm.runInNewContext(await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-commands/lib/client.js', import.meta.url), 'utf8'), {
    AbortController, queueMicrotask, console,
    window: { __ModuleLoader__: { load: value => { factory = value.factory; } } },
  });
  // The actual command runtime/decision table is exercised. Popup/DOM stores
  // are deliberately unavailable: an action must never open another picker UI.
  const { CommandUiRuntime } = factory(id => id === '@deepseek-ai/dsh-client-ui-primitives' ? {}
    : id === '@deepseek-ai/dsh-client-store' ? { createSnapshotStore: () => assert.fail('the action must not create a popup') } : require(id));
  const ctx = new Context();
  const actx = new Context();
  let source;
  const invocations = [];
  const rpcCalls = [];
  const consumes = [];
  const draft = { text: 'Keep this unrelated draft', attachmentIds: ['draft-image-1'] };
  const before = structuredClone(draft);
  actx.on('slash/input-consume-token', request => { consumes.push(request); return true; });
  ctx.provide('locale', { bind: () => key => key });
  ctx.provide('inputTriggers', { registerSource(value) { source = value; return () => {}; } });
  const binding = { ctx: actx, session: { getSnapshot: () => ({ openState: 'open' }) } };
  ctx.provide('sessions', {
    subagentAddress: () => undefined, binding: () => binding,
    using: async (_id, _options, run) => run({ binding }), scope: () => actx,
  });
  ctx.provide('remote', { $on: () => () => {}, commands: {
    list: async () => ({ ok: true, value: [{ name: 'bridge', description: 'Original Host description', input: { hint: '<preset>' } }] }),
    execute: async (id, line, attachments) => { rpcCalls.push([id, line, attachments]); return { ok: true, value: { result: { kind: 'success', text: 'Host receipt' } } }; },
  } });
  const commands = new CommandUiRuntime(ctx);
  const off = registerBridgeCommandMenu(commands, {
    currentSession: () => 'source', conversationVisible: () => true, blocked: () => false,
    launch: id => invocations.push([id, '/bridge']),
  });
  try {
    const session = { sessionId: 'source' };
    const rows = await source.candidates(session, { query: '', position: 'leading', drilled: false, signal: new AbortController().signal });
    assert.equal(rows.filter(row => row.name === 'bridge').length, 1, 'a decoration never duplicates the Host row');
    assert.equal(rows.find(row => row.name === 'bridge').description, 'Original Host description');
    const pick = source.onPick({ candidate: { name: 'bridge' }, session, position: 'leading', via: 'menu',
      span: { start: 0, end: 0, draftRev: 1 } });
    assert.equal(pick, 'handled');
    assert.deepEqual(invocations, [['source', '/bridge']]);
    assert.equal(consumes.length, 1);
    assert.equal(consumes[0].guard.kind, 'span');
    assert.equal(consumes[0].guard.span.start, 0);
    assert.equal(consumes[0].guard.span.end, 0);
    assert.deepEqual(draft, before, 'the action only consumes the empty menu trigger span, never a draft or its attachments');
    await source.matchEnter(session, '/bridge', new AbortController().signal, { attachments: 1 });
    assert.equal(invocations.length, 2, 'bare enter with an attachment uses the non-submitting picker action');
    assert.deepEqual(draft.attachmentIds, ['draft-image-1']);
    for (const args of ['ptc', '--doctor', 'ptc --go --preview-id preview-12345678 --summary64 YQ']) {
      const answer = await source.matchEnter(session, `/bridge ${args}`, new AbortController().signal, { attachments: 0 });
      assert.equal(answer.claim.name, 'bridge');
      await answer.claim.submit(args, actx, []);
      assert.equal(rpcCalls.at(-1)[1], `/bridge ${args}`);
    }
    assert.equal(invocations.length, 2, 'argued lines never enter the optional client action');
  } finally {
    off();
    await ctx.fiber.dispose();
    await actx.fiber.dispose();
  }
});

test('current official slot registry restores Bridge contributions across owner lifetimes and cleans up on unload', async () => {
  const { Context } = require('@deepseek-ai/cordis');
  const factories = new Map();
  const styles = new Set();
  const calls = [];
  const shortcutRows = new Map([['other-plugin.open', { id: 'other-plugin.open' }]]);
  const menuDecorations = new Map([['other_command', { name: 'other_command' }]]);
  const outcome = { kind: 'success', text: 'ok' };
  const sandbox = {
    AbortController, queueMicrotask, console,
    document: {
      documentElement: { lang: 'en' },
      querySelector: () => null,
      querySelectorAll: () => [],
      head: {
        append: element => styles.add(element),
        // The real Conversation bundle includes Host CSS at factory load.
        // This test tracks only Bridge's separately owned style lifecycle.
        appendChild: element => element,
      },
      createElement: () => {
        const element = { dataset: {}, textContent: '', remove: () => styles.delete(element) };
        return element;
      },
    },
    window: { __ModuleLoader__: { load: ({ id, factory }) => factories.set(id, factory) } },
  };
  for (const file of [
    '../node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js',
    '../node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
    '../lib/client.js',
  ]) {
    vm.runInNewContext(await readFile(new URL(file, import.meta.url), 'utf8'), sandbox);
  }
  // Visual primitives and DOM mounts are not exercised here. Cordis, SlotCore, SlotRegistry and
  // the built Bridge client are real; this checks registration, not browser pixels.
  const load = id => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { JsonTree: () => null, MarkdownText: () => null, MenuItemButton: () => null };
    if (id === '@deepseek-ai/dsh-client-store') return {
      createSnapshotStore(initial) {
        let value = initial;
        const listeners = new Set();
        return { getSnapshot: () => value, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
          set: next => { value = next; for (const listener of listeners) listener(); } };
      },
      notifySubscribers: listeners => { for (const listener of listeners) listener(); },
      defineStore: () => () => ({}),
    };
    if (id === 'react-dom') return { flushSync: () => assert.fail('this test must not mount a DOM renderer') };
    if (id === 'react-dom/client') return { createRoot: () => assert.fail('this test must not mount a DOM renderer') };
    return require(id);
  };
  const { SlotRegistry } = factories.get('@deepseek-ai/dsh-client-ui-renderer')(load);
  const { UiConversation } = factories.get('@deepseek-ai/dsh-client-ui-conversation')(load);
  const bridge = factories.get('dsh-plugin-bridge')(load);
  const ctx = new Context();
  new SlotRegistry(ctx);
  const uiConversation = new UiConversation(ctx, {});
  const neighborDefinition = { kind: 'other-plugin-state', match: () => null, start: () => ({}), update: context => context.state };
  uiConversation.events.register(neighborDefinition);
  let sessionState;
  const entryNotices = [];
  const scoped = { get: name => name === 'conversation' ? { input: { for: owner => {
    assert.equal(owner, scoped);
    return { notify: (level, text) => entryNotices.push([level, text]) };
  } } } : undefined };
  ctx.provide('sessions', { binding: () => sessionState === undefined ? undefined : {
    ctx: scoped, session: { getSnapshot: () => sessionState },
  } });
  const remote = { commands: { execute: async (sessionId, line, images) => {
    calls.push([sessionId, line, Array.from(images)]);
    return { ok: true, value: { result: outcome } };
  } } };
  ctx.provide('remote', remote);
  ctx.provide('remote.commands', remote.commands);
  const slots = ctx.get('slots');
  const fiber = ctx.plugin(bridge);
  let owner;
  const declare = () => {
    const off = slots.register({
      name: 'root',
      children: {
        'conversation.chat.commandview': { kind: 'keyed', scope: 'session' },
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'conversation.plan-review.actions': { kind: 'list', scope: 'session' },
        'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
        'sidebar.workspaces.session.menu.item': { kind: 'list', scope: 'root' },
        'conversation.composer.dock': { kind: 'list', scope: 'session' },
        'tool.call.toolview': { kind: 'keyed', scope: 'session' },
      },
    }, () => null);
    slots.register({ name: 'conversation.session.header.utilities', id: 'other-plugin/utility', order: 40 }, () => null);
    slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'other-plugin/session-menu', order: 450 }, () => null);
    slots.register({ name: 'conversation.composer.dock', id: 'other-plugin/dock', order: 40 }, () => null);
    slots.register({ name: 'tool.call.toolview', key: 'other_plugin_tool' }, () => null);
    slots.register({ name: 'conversation.chat.node', key: 'other-plugin-node' }, () => null);
    return off;
  };
  try {
    // Bridge starts before the owner, as it can when the host assembles its UI.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(slots.entries('conversation.chat.commandview').length, 0);
    assert.equal(uiConversation.events.entries().filter(definition => definition.kind === 'dsh-bridge-review').length, 1,
      'production apply registers the optional projection with the actual Conversation service');
    owner = declare();
    const card = slots.entries('conversation.chat.commandview')[0];
    assert.equal(card.options.key, 'bridge');
    assert.equal(slots.entries('conversation.plan-review.actions')[0].options.id, 'dsh-plugin-bridge/approved-plan');
    assert.equal(slots.entries('conversation.session.header.utilities').length, 1, 'no resident Bridge header button');
    assert.equal(slots.entries('sidebar.workspaces.session.menu.item').length, 1, 'optional row action can wait while core command remains usable');
    assert.equal(slots.entries('conversation.composer.dock')[0].options.id, 'dsh-plugin-bridge/entry-error');
    assert.equal(slots.entries('tool.call.toolview')[0].options.key, 'bridge_prepare');
    assert.equal(slots.entries('conversation.session.header.utilities')[0].options.id, 'other-plugin/utility');
    assert.equal(slots.entries('conversation.composer.dock')[1].options.id, 'other-plugin/dock');
    assert.equal(slots.entries('tool.call.toolview')[1].options.key, 'other_plugin_tool');
    assert.equal(slots.entries('conversation.chat.node').filter(entry => entry.options.key === 'dsh-bridge-review').length, 1);
    assert.ok(slots.entries('conversation.chat.node').some(entry => entry.options.key === 'other-plugin-node'));
    await slots.entries('conversation.composer.dock')[0].inject('source-current').launcher.launch('source-current');
    assert.deepEqual(calls, [['source-current', '/bridge', []]]);
    calls.length = 0;
    assert.equal(await card.inject('source-current').execute('source-current', '/bridge --doctor'), outcome);
    assert.deepEqual(calls, [['source-current', '/bridge --doctor', []]]);
    assert.equal(styles.size, 1);

    const launcher = slots.entries('conversation.composer.dock')[0].inject('source-current').launcher;
    calls.length = 0;
    sessionState = { blank: true, openState: 'open' };
    assert.equal(await launcher.launch('source-current'), false);
    assert.deepEqual(calls, [], 'known blank Hero must not run an invisible command lifecycle');
    assert.equal(entryNotices.at(-1)[0], 'error', 'Hero InputBar surfaces error-level native notices');
    assert.match(entryNotices.at(-1)[1], /no conversation content/i);
    sessionState = { blank: true, openState: 'loading' };
    assert.equal(await launcher.launch('source-current'), false);
    assert.deepEqual(calls, []);
    assert.match(entryNotices.at(-1)[1], /not ready/i);
    sessionState = { blank: false, openState: 'open' };
    assert.equal(await launcher.launch('source-current'), true);
    assert.deepEqual(calls, [['source-current', '/bridge', []]], 'an existing open conversation retains its original picker path');
    sessionState = undefined;

    // Optional Host services can arrive after Bridge. Before this point all
    // original command and new on-screen actions were already registered.
    let selected = 'source-current';
    let activePanel = null;
    ctx.provide('shortcuts', { register(command) {
      assert.equal(shortcutRows.has(command.id), false);
      shortcutRows.set(command.id, command);
      return () => { shortcutRows.delete(command.id); };
    } });
    ctx.provide('uiSession', { adapter: { current: { getSnapshot: () => ({ key: selected }) } } });
    ctx.provide('layout', { panelInfo: { getSnapshot: () => ({ activePanelId: activePanel }) } });
    ctx.provide('commandUi', { decorate(decoration) {
      assert.equal(menuDecorations.has(decoration.name), false);
      menuDecorations.set(decoration.name, decoration);
      return () => { menuDecorations.delete(decoration.name); };
    } });
    await new Promise(resolve => setTimeout(resolve, 0));
    const rowEntry = slots.entries('sidebar.workspaces.session.menu.item').find(item => item.options.id === 'dsh-plugin-bridge/handoff');
    assert.ok(rowEntry, 'public session menu entry registers when its optional source services arrive');
    assert.equal(rowEntry.options.order, 350);
    assert.equal(rowEntry.inject().menu.available('source-current'), true);
    assert.equal(rowEntry.inject().menu.available('other'), false);
    const shortcut = shortcutRows.get('dsh-plugin-bridge.open');
    assert.ok(shortcut);
    assert.equal(Object.keys(shortcut.defaults).length, 0);
    calls.length = 0;
    const keyboard = { source: 'keyboard', region: 'page', modal: null, target: null };
    const deferred = shortcut.resolve(keyboard);
    selected = 'navigated-away';
    deferred.run();
    assert.deepEqual(calls, []);
    selected = 'source-current';
    activePanel = 'dsh-jot';
    assert.equal(shortcut.resolve(keyboard).status, 'pass');
    activePanel = null;
    shortcut.resolve(keyboard).run();
    await Promise.resolve();
    assert.deepEqual(calls, [['source-current', '/bridge', []]]);
    await new Promise(resolve => setTimeout(resolve, 0));
    calls.length = 0;
    const menu = menuDecorations.get('bridge');
    assert.ok(menu);
    assert.equal(menu.ui.kind, 'action');
    assert.equal(menu.available({ sessionId: 'source-current' }), true);
    menu.ui.run({ sessionId: 'source-current' });
    await Promise.resolve();
    assert.deepEqual(calls, [['source-current', '/bridge', []]]);

    owner();
    assert.equal(slots.entries('conversation.chat.commandview').length, 0);
    assert.equal(slots.entries('conversation.plan-review.actions').length, 0);
    assert.equal(slots.entries('conversation.session.header.utilities').length, 0);
    assert.equal(slots.entries('sidebar.workspaces.session.menu.item').length, 0);
    assert.equal(slots.entries('conversation.composer.dock').length, 0);
    assert.equal(slots.entries('tool.call.toolview').length, 0);
    assert.equal(slots.entries('conversation.chat.node').length, 0);
    owner = declare();
    assert.equal(slots.entries('conversation.chat.commandview').length, 1);
    assert.equal(slots.entries('conversation.plan-review.actions').length, 1);
    assert.equal(slots.entries('conversation.session.header.utilities').length, 1);
    assert.equal(slots.entries('sidebar.workspaces.session.menu.item').length, 2);
    assert.equal(slots.entries('conversation.composer.dock').length, 2);
    assert.equal(slots.entries('tool.call.toolview').length, 2);
    assert.equal(slots.entries('conversation.chat.node').length, 2);
    assert.equal(uiConversation.events.entries().filter(definition => definition.kind === 'dsh-bridge-review').length, 1,
      'renderer owner reload does not duplicate the independently owned projection');

    await fiber.dispose();
    assert.equal(slots.entries('conversation.chat.commandview').length, 0);
    assert.equal(slots.entries('conversation.plan-review.actions').length, 0);
    assert.equal(slots.entries('conversation.session.header.utilities').length, 1);
    assert.equal(slots.entries('conversation.session.header.utilities')[0].options.id, 'other-plugin/utility');
    assert.equal(slots.entries('sidebar.workspaces.session.menu.item').length, 1);
    assert.equal(slots.entries('sidebar.workspaces.session.menu.item')[0].options.id, 'other-plugin/session-menu');
    assert.equal(slots.entries('conversation.composer.dock').length, 1);
    assert.equal(slots.entries('conversation.composer.dock')[0].options.id, 'other-plugin/dock');
    assert.equal(slots.entries('tool.call.toolview').length, 1);
    assert.equal(slots.entries('tool.call.toolview')[0].options.key, 'other_plugin_tool');
    assert.equal(slots.entries('conversation.chat.node').length, 1);
    assert.equal(slots.entries('conversation.chat.node')[0].options.key, 'other-plugin-node');
    assert.equal(uiConversation.events.entries().some(definition => definition.kind === 'dsh-bridge-review'), false,
      'production plugin disposal removes its optional Conversation Definition');
    assert.equal(uiConversation.events.entries().find(definition => definition.kind === 'other-plugin-state'), neighborDefinition);
    assert.equal(styles.size, 0);
    assert.equal(shortcutRows.size, 1);
    assert.equal(shortcutRows.has('other-plugin.open'), true);
    assert.equal(shortcut.resolve(keyboard).status, 'pass');
    assert.equal(menuDecorations.size, 1);
    assert.equal(menuDecorations.has('other_command'), true);
    assert.equal(menu.available({ sessionId: 'source-current' }), false);
    owner();
    owner = declare();
    assert.equal(slots.entries('conversation.chat.commandview').length, 0, 'unloaded Bridge must not register again');
    assert.equal(slots.entries('conversation.plan-review.actions').length, 0);
    assert.equal(slots.entries('conversation.session.header.utilities').length, 1);
    assert.equal(slots.entries('sidebar.workspaces.session.menu.item').length, 1);
    assert.equal(slots.entries('conversation.composer.dock').length, 1);
    assert.equal(slots.entries('tool.call.toolview').length, 1);
  } finally {
    await fiber.dispose();
    owner?.();
    await ctx.fiber.dispose();
  }
});

function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children ?? []).map((child) => textOf(child)).join('');
}

function findNodes(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children ?? []) findNodes(child, predicate, found);
  return found;
}

function loadBuiltClient(options = {}) {
  const React = require('react');
  const sourceUrl = new URL('../lib/client.js', import.meta.url);
  const factories = new Map();
  const sandbox = {
    console,
    TextEncoder, btoa,
    window: {
      __ModuleLoader__: { load: ({ factory }) => { factories.set('dsh-plugin-bridge', factory); } },
      setInterval: (...args) => globalThis.setInterval(...args),
      clearInterval: (...args) => globalThis.clearInterval(...args),
    },
  };
  Object.defineProperty(sandbox, 'Date', { get: () => Date });
  vm.runInNewContext(require('node:fs').readFileSync(sourceUrl, 'utf8'), sandbox, { filename: 'client.js' });
  const factory = factories.get('dsh-plugin-bridge');
  const exported = factory((id) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { JsonTree: () => null, MarkdownText: () => null,
      ...options.missingMenuPrimitive ? {} : {
        MenuItemButton: ({ children, disabled, onSelect }) => React.createElement('button', { role: 'menuitem', disabled, onClick: onSelect }, children),
      } };
    if (id === 'react-dom' || id === 'react-dom/client') throw new Error('the live-region test must not mount a DOM renderer');
    return require(id);
  });
  return { React, TestRenderer: require('react-test-renderer'), ...exported };
}

test('running card announces the stable status politely and hides the ticking seconds', async () => {
  const { React, TestRenderer, BridgeCommandCard } = loadBuiltClient();
  const previousWindow = global.window;
  global.window = globalThis;
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  try {
    const renderer = TestRenderer.create(React.createElement(BridgeCommandCard, {
      node: { outcome: null },
      execute: async () => ({ kind: 'success', text: '' }),
      openSession: async () => {},
      sessionId: 's-1',
    }));
    const before = renderer.toJSON();
    const beforeLive = findNodes(before, (node) => node.props?.['aria-live'] === 'polite');
    assert.equal(beforeLive.length, 1);
    assert.equal(textOf(beforeLive[0]), '');
    assert.equal(textOf(beforeLive[0]).includes('seconds'), false);
    await TestRenderer.act(async () => {});
    const mounted = renderer.toJSON();
    const live = findNodes(mounted, (node) => node.props?.['aria-live'] === 'polite');
    const hidden = findNodes(mounted, (node) => node.props?.['aria-hidden'] === 'true' && textOf(node).includes('s'));
    assert.equal(textOf(live[0]), 'Generating an editable handoff preview');
    assert.equal(textOf(live[0]).includes('seconds'), false);
    await TestRenderer.act(async () => { mock.timers.tick(2500); });
    const ticked = renderer.toJSON();
    const tickedLive = findNodes(ticked, (node) => node.props?.['aria-live'] === 'polite');
    const tickedHidden = findNodes(ticked, (node) => node.props?.['aria-hidden'] === 'true' && textOf(node).includes('s'));
    assert.equal(textOf(tickedLive[0]).includes('2s'), false);
    assert.equal(textOf(tickedLive[0]).includes('seconds'), false);
    assert.match(textOf(tickedHidden[0]), / · 2s/);
    assert.equal(hidden.length > 0, true);
  } finally {
    mock.timers.reset();
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('preview, migrated, and picker status regions mount empty', async () => {
  const { React, TestRenderer, PoliteStatus } = loadBuiltClient();
  const renderer = TestRenderer.create(React.createElement(PoliteStatus, { text: 'Ready' }));
  const before = findNodes(renderer.toJSON(), (node) => node.props?.['aria-live'] === 'polite');
  assert.equal(before.length, 1);
  assert.equal(before[0].props['aria-live'], 'polite');
  assert.equal(textOf(before[0]), '');
  await TestRenderer.act(async () => {});
  const after = findNodes(renderer.toJSON(), (node) => node.props?.['aria-live'] === 'polite');
  assert.equal(textOf(after[0]), 'Ready');
  assert.equal(after[0].props['aria-live'], 'polite');
});

test('low-frequency menu has no resident header button and reveals a localized retry only on entry failure', async () => {
  const { React, TestRenderer, BridgeEntryNotice, BridgeLaunchButton } = loadBuiltClient();
  assert.equal(BridgeLaunchButton, undefined, 'the superseded resident header button must be removed');
  assert.equal(typeof BridgeEntryNotice, 'function', 'menu launch errors must remain visible');
  const calls = [];
  let snapshot = { busy: false, error: '' };
  const launcher = { subscribe: () => () => {}, snapshotFor: () => snapshot,
    launch: async id => { calls.push(id); return true; } };
  const renderer = TestRenderer.create(React.createElement(BridgeEntryNotice, { launcher, sessionId: 'source', language: 'zh' }));
  assert.equal(renderer.toJSON(), null, 'idle menu support reserves no composer or header space');
  snapshot = { busy: false, error: 'Host unavailable' };
  renderer.update(React.createElement(BridgeEntryNotice, { launcher, sessionId: 'source', language: 'zh' }));
  assert.match(textOf(renderer.toJSON()), /重试打开迁移/);
  await TestRenderer.act(async () => { renderer.root.findByType('button').props.onClick(); });
  assert.deepEqual(calls, ['source']);
  renderer.update(React.createElement(BridgeEntryNotice, { launcher, sessionId: 'source', language: 'en' }));
  assert.match(textOf(renderer.toJSON()), /Retry handoff picker/);
  assert.match(textOf(renderer.toJSON()), /Host unavailable/);
  renderer.unmount();
});

test('session menu item is localized and keeps other rows hidden while dismissing before the picker', async () => {
  const { React, TestRenderer, BridgeSessionMenuItem } = loadBuiltClient();
  assert.equal(typeof BridgeSessionMenuItem, 'function', 'a public session-menu item replaces the unavailable inline + action');
  const actions = [];
  const idle = { busy: false, error: '' };
  const launcher = { subscribe: () => () => {}, snapshotFor: () => idle };
  const menu = { available: id => id === 'source', select: (id, close) => { close(); actions.push(['launch', id]); } };
  const props = { launcher, menu, subscribe: () => () => {}, sessionId: 'source',
    useMenuOpenState: () => [true, open => actions.push(['open', open])], language: 'zh' };
  const renderer = TestRenderer.create(React.createElement(BridgeSessionMenuItem, props));
  assert.equal(renderer.root.findByProps({ role: 'menuitem' }).props.children, '迁移会话');
  await TestRenderer.act(async () => { renderer.root.findByType('button').props.onClick(); });
  assert.deepEqual(actions, [['open', false], ['launch', 'source']]);
  renderer.update(React.createElement(BridgeSessionMenuItem, { ...props, language: 'en' }));
  assert.equal(renderer.root.findByType('button').props.children, 'Hand off session');
  renderer.update(React.createElement(BridgeSessionMenuItem, { ...props, sessionId: 'other' }));
  assert.equal(renderer.toJSON(), null);
  renderer.unmount();
});

test('missing optional menu primitive disables only the Bridge row without changing hook order', () => {
  const { React, TestRenderer, BridgeSessionMenuItem } = loadBuiltClient({ missingMenuPrimitive: true });
  const idle = { busy: false, error: '' };
  const launcher = { subscribe: () => () => {}, snapshotFor: () => idle };
  let visible = true;
  let reads = 0;
  const props = { launcher, menu: { available: () => visible, select: () => assert.fail('missing primitive cannot act') },
    subscribe: () => () => {}, sessionId: 'source', language: 'en', useMenuOpenState() { reads += 1; return [true, () => {}]; } };
  let renderer;
  assert.doesNotThrow(() => { renderer = TestRenderer.create(React.createElement(BridgeSessionMenuItem, props)); });
  assert.equal(renderer.toJSON(), null);
  visible = false;
  assert.doesNotThrow(() => renderer.update(React.createElement(BridgeSessionMenuItem, props)));
  visible = true;
  assert.doesNotThrow(() => renderer.update(React.createElement(BridgeSessionMenuItem, props)));
  assert.equal(reads, 3, 'the same owner hook remains unconditional on each render');
  renderer.unmount();
});

test('entry-failure CSS bounds message scrolling and prevents retry controls from shrinking (structure only)', async () => {
  const built = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8');
  const message = /\.dsh-bridge-entry-error>span\{([^}]+)\}/u.exec(built)?.[1];
  assert.ok(message, 'the entry error message needs its own bounded scrolling rule');
  assert.match(message, /max-height:6em/);
  assert.match(message, /overflow:auto/);
  assert.match(message, /overflow-wrap:anywhere/);
  assert.match(message, /min-width:0/);
  const retry = /\.dsh-bridge-entry-error>\.dsh-bridge-button\{([^}]+)\}/u.exec(built)?.[1];
  assert.ok(retry, 'the entry retry must not compress with a long message');
  assert.match(retry, /flex:0 0 auto/);
});

const TOOL_SUMMARY = `## Goal\nKeep the task.\n\n## Current state\nTests pending.\n\n## Key decisions & conventions\n- Preserve source\n\n## Key files\n- src/client.tsx\n\n## Next step\nReview before migration.`;
const TOOL_PREVIEW = `─── Handoff · standard → ptc (review numbers and paths) ───\n${TOOL_SUMMARY}\n───────────────────────────────────────────\nSource 980 chars · user messages 3/3 · worker test · 6s\nPreview ID: preview-12345678\n\nReview and run: /bridge ptc --go`;

test('natural-language tool card uses only settled server meta and requires an explicit click with the edited payload', async () => {
  const { React, TestRenderer, BridgeToolCard } = loadBuiltClient();
  assert.equal(typeof BridgeToolCard, 'function', 'Bridge needs a natural-language tool preview renderer');
  const calls = [];
  const props = { phase: 'result', toolName: 'bridge_prepare', callId: 'call-1', sessionId: 'source',
    block: { meta: { bridge: { version: 1, outcome: { kind: 'success', text: TOOL_PREVIEW } } },
      isError: false, call: { args: { go: true } }, content: [{ type: 'text', text: 'ignored model-facing result' }] },
    execute: async (id, line) => { calls.push([id, line]); return { kind: 'error', text: 'Synthetic stop after confirmed payload' }; },
    openSession: async () => assert.fail('a failed synthetic confirmation cannot navigate'),
  };
  let renderer;
  await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(BridgeToolCard, props)); });
  assert.deepEqual(calls, [], 'a settled tool preview must not migrate while rendering');
  const markdown = renderer.root.findAllByType('button').find(node => textOf(node.toJSON?.()) === 'Markdown'
    || node.props.role === 'tab' && node.props.children === 'Markdown');
  assert.ok(markdown);
  await TestRenderer.act(async () => { markdown.props.onClick(); });
  const editor = renderer.root.findByType('textarea');
  const edited = TOOL_SUMMARY.replace('Tests pending.', 'User-reviewed state.');
  await TestRenderer.act(async () => { editor.props.onChange({ currentTarget: { value: edited } }); });
  const confirm = renderer.root.findAllByType('button').find(node => node.props.children === 'Confirm migration');
  assert.equal(confirm.props.disabled, false);
  await TestRenderer.act(async () => { confirm.props.onClick(); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'source');
  assert.match(calls[0][1], /^\/bridge ptc --go --lang en --preview-id preview-12345678 --summary64 /);
  assert.equal(Buffer.from(calls[0][1].split('--summary64 ')[1], 'base64url').toString('utf8'), edited);
  assert.doesNotMatch(calls[0][1], /--continue/);
  renderer.unmount();
});

test('tool preparation ignores argument or text metadata, failed Host results and missing preview IDs never enable confirmation', async () => {
  const { React, TestRenderer, BridgeToolCard } = loadBuiltClient();
  assert.equal(typeof BridgeToolCard, 'function');
  const base = { toolName: 'bridge_prepare', callId: 'call-2', sessionId: 'source', execute: async () => assert.fail('no automatic action'), openSession: async () => {} };
  for (const phase of ['preparing', 'start']) {
    const block = { get meta() { assert.fail('running phases cannot trust result metadata'); }, args: { preview: TOOL_PREVIEW } };
    let renderer;
    await TestRenderer.act(async () => { renderer = TestRenderer.create(React.createElement(BridgeToolCard, { ...base, phase, block })); });
    assert.match(textOf(renderer.toJSON()), /Generating an editable handoff preview/);
    assert.equal(renderer.root.findAllByType('button').length, 0);
    renderer.unmount();
  }
  for (const block of [
    { isError: false, content: [{ type: 'text', text: JSON.stringify({ bridge: { version: 1, outcome: { kind: 'success', text: TOOL_PREVIEW } } }) }] },
    { isError: true, meta: { bridge: { version: 1, outcome: { kind: 'success', text: TOOL_PREVIEW } } } },
    { isError: false, meta: { bridge: { version: 1, outcome: { kind: 'success', text: TOOL_PREVIEW.replace('Preview ID: preview-12345678\n', '') } } } },
  ]) {
    const renderer = TestRenderer.create(React.createElement(BridgeToolCard, { ...base, phase: 'result', block }));
    const confirms = renderer.root.findAllByType('button').filter(node => node.props.children === 'Confirm migration');
    assert.equal(confirms.every(node => node.props.disabled), true);
    renderer.unmount();
  }
});

test('original slash-command preview retains the same human confirmation and exact payload', async () => {
  const { React, TestRenderer, BridgeCommandCard } = loadBuiltClient();
  const calls = [];
  const renderer = TestRenderer.create(React.createElement(BridgeCommandCard, {
    node: { outcome: { kind: 'success', text: TOOL_PREVIEW } }, sessionId: 'original-source',
    execute: async (id, line) => { calls.push([id, line]); return { kind: 'error', text: 'Synthetic confirmation receipt' }; },
    openSession: async () => assert.fail('this receipt cannot open a target'),
  }));
  assert.deepEqual(calls, []);
  const confirm = renderer.root.findAllByType('button').find(node => node.props.children === 'Confirm migration');
  assert.equal(confirm.props.disabled, false);
  await TestRenderer.act(async () => { confirm.props.onClick(); });
  assert.equal(calls[0][0], 'original-source');
  assert.match(calls[0][1], /^\/bridge ptc --go --lang en --preview-id preview-12345678 --summary64 /);
  assert.equal(Buffer.from(calls[0][1].split('--summary64 ')[1], 'base64url').toString('utf8'), TOOL_SUMMARY);
  renderer.unmount();
});

test('a localized target picker leads with the user action and keeps command syntax collapsed', async () => {
  const { React, TestRenderer, BridgeCommandCard } = loadBuiltClient();
  for (const [lang, text, helpLabel] of [
    ['zh', '用法：\n  /bridge <模式> --go\n可迁入：ptc · minimal · cordis\n当前：standard', '命令行用法（可选）'],
    ['en', 'Usage:\n  /bridge <preset> --go\nAvailable: ptc · minimal · cordis\nCurrent: standard', 'Command-line help (optional)'],
  ]) {
    const calls = [];
    const renderer = TestRenderer.create(React.createElement(BridgeCommandCard, {
      node: { outcome: { kind: 'success', text } }, sessionId: 'source',
      execute: async (id, line) => { calls.push([id, line]); return { kind: 'success', text: '' }; },
      openSession: async () => assert.fail('a picker must not create or open a target'),
    }));
    const help = renderer.root.findAllByType('details');
    assert.equal(help.length, 1, 'advanced command syntax belongs in a disclosure');
    assert.notEqual(help[0].props.open, true, 'help starts collapsed');
    assert.equal(help[0].findByType('summary').props.children, helpLabel);
    assert.equal(help[0].findByType('pre').props.children, text, 'retain exact CLI help for advanced users');
    assert.equal(renderer.root.findAllByType('pre').length, 1);
    assert.match(textOf(renderer.toJSON()), lang === 'zh' ? /确认前不会创建目标会话/ : /No target is created before you confirm/);
    const target = renderer.root.findAllByType('button').find(node => node.props.children === 'ptc');
    assert.ok(target, 'stable preset identifiers remain selectable without translating the command target');
    await TestRenderer.act(async () => { target.props.onClick(); });
    assert.deepEqual(calls, [['source', lang === 'en' ? '/bridge ptc --lang en' : '/bridge ptc']]);
    renderer.unmount();
  }
});
