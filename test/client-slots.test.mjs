import test from 'node:test';
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
