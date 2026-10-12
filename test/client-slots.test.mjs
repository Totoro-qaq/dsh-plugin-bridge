import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(new URL('../package.json', import.meta.url));

test('current official slot registry restores Bridge contributions across owner lifetimes and cleans up on unload', async () => {
  const { Context } = require('@deepseek-ai/cordis');
  const factories = new Map();
  const styles = new Set();
  const calls = [];
  const outcome = { kind: 'success', text: 'ok' };
  const sandbox = {
    AbortController, queueMicrotask, console,
    document: {
      documentElement: { lang: 'en' },
      querySelector: () => null,
      head: { append: element => styles.add(element) },
      createElement: () => {
        const element = { dataset: {}, textContent: '', remove: () => styles.delete(element) };
        return element;
      },
    },
    window: { __ModuleLoader__: { load: ({ id, factory }) => factories.set(id, factory) } },
  };
  for (const file of [
    '../node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js',
    '../lib/client.js',
  ]) {
    vm.runInNewContext(await readFile(new URL(file, import.meta.url), 'utf8'), sandbox);
  }
  // Visual primitives and DOM mounts are not exercised here. Cordis, SlotCore, SlotRegistry and
  // the built Bridge client are real; this checks registration, not browser pixels.
  const load = id => {
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { JsonTree: () => null, MarkdownText: () => null };
    if (id === 'react-dom') return { flushSync: () => assert.fail('this test must not mount a DOM renderer') };
    if (id === 'react-dom/client') return { createRoot: () => assert.fail('this test must not mount a DOM renderer') };
    return require(id);
  };
  const { SlotRegistry } = factories.get('@deepseek-ai/dsh-client-ui-renderer')(load);
  const bridge = factories.get('dsh-plugin-bridge')(load);
  const ctx = new Context();
  new SlotRegistry(ctx);
  ctx.provide('sessions', {});
  const remote = { commands: { execute: async (sessionId, line, images) => {
    calls.push([sessionId, line, Array.from(images)]);
    return { ok: true, value: { result: outcome } };
  } } };
  ctx.provide('remote', remote);
  ctx.provide('remote.commands', remote.commands);
  const slots = ctx.get('slots');
  const fiber = ctx.plugin(bridge);
  let owner;
  const declare = () => slots.register({
    name: 'root',
    children: {
      'conversation.chat.commandview': { kind: 'keyed', scope: 'session' },
      'conversation.plan-review.actions': { kind: 'list', scope: 'session' },
    },
  }, () => null);
  try {
    // Bridge starts before the owner, as it can when the host assembles its UI.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(slots.entries('conversation.chat.commandview').length, 0);
    owner = declare();
    const card = slots.entries('conversation.chat.commandview')[0];
    assert.equal(card.options.key, 'bridge');
    assert.equal(slots.entries('conversation.plan-review.actions')[0].options.id, 'dsh-plugin-bridge/approved-plan');
    assert.equal(await card.inject('source-current').execute('source-current', '/bridge --doctor'), outcome);
    assert.deepEqual(calls, [['source-current', '/bridge --doctor', []]]);
    assert.equal(styles.size, 1);

    owner();
    assert.equal(slots.entries('conversation.chat.commandview').length, 0);
    assert.equal(slots.entries('conversation.plan-review.actions').length, 0);
    owner = declare();
    assert.equal(slots.entries('conversation.chat.commandview').length, 1);
    assert.equal(slots.entries('conversation.plan-review.actions').length, 1);

    await fiber.dispose();
    assert.equal(slots.entries('conversation.chat.commandview').length, 0);
    assert.equal(slots.entries('conversation.plan-review.actions').length, 0);
    assert.equal(styles.size, 0);
    owner();
    owner = declare();
    assert.equal(slots.entries('conversation.chat.commandview').length, 0, 'unloaded Bridge must not register again');
    assert.equal(slots.entries('conversation.plan-review.actions').length, 0);
  } finally {
    await fiber.dispose();
    owner?.();
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

function loadBuiltClient() {
  const React = require('react');
  const sourceUrl = new URL('../lib/client.js', import.meta.url);
  const factories = new Map();
  const sandbox = {
    console,
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
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { JsonTree: () => null, MarkdownText: () => null };
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
