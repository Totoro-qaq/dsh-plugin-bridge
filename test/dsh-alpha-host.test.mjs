import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDshAlphaHost,
  probeDshAlphaHost,
  resolveDshHost,
} from '../src/dsh-alpha-host.ts';
import { foldedHistory, waitIdle } from '../src/migrate.ts';

function fixture() {
  const calls = [];
  const agent = { id: 's-source' };
  const services = {
    sessionController: {
      list: async () => ({
        items: [{
          sessionId: 's-source',
          running: false,
          blank: false,
          cwd: '/work/project',
          projections: {
            asOfSeq: 4,
            values: {
              agentPreset: 'minimal',
              modelSelection: {
                lastUsed: { provider: 'deepseek', model: 'v4' },
                next: { provider: 'deepseek', model: 'v4-pro', reasoningEffort: 'high' },
              },
            },
          },
        }],
      }),
      create: async (request) => {
        calls.push(['create', request]);
        return { sessionId: 's-target', agentPreset: request.agentPreset };
      },
      inspect: async () => ({
        meta: { id: 's-source', cwd: '/work/project', agentPreset: 'minimal' },
        events: [
          { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 'hello' }] } },
          { type: 'assistant/message', seq: 1, time: 2, data: { message: { content: [{ type: 'text', text: 'world' }] } } },
        ],
      }),
      modelCatalog: async () => ({
        default: { provider: 'deepseek', model: 'v4' },
        groups: [{ id: 'deepseek', models: [{ id: 'v4' }, { id: 'v4-pro' }] }],
        failures: [],
      }),
      selectModel: async (request) => { calls.push(['selectModel', request]); return { selected: request }; },
      prompt: async (request) => { calls.push(['prompt', request]); return { accepted: true }; },
      cancel: (request) => { calls.push(['cancel', request]); return { accepted: true }; },
      rename: async (request) => { calls.push(['rename', request]); return { title: request.title, seq: 5 }; },
      attachment: async (request) => ({ attachment: { attachmentId: request.attachmentId }, data: 'AA==' }),
      resolveAgent: async (sessionId) => {
        calls.push(['resolveAgent', sessionId]);
        return { agent };
      },
    },
    workspaceRegistry: {
      list: () => [{ id: 'ws-1', sessionIds: ['s-source'], path: '/work/project' }],
    },
    workspaceController: {
      archiveSession: async (request) => { calls.push(['archiveSession', request]); return { archivedSessionIds: [request.sessionId] }; },
    },
    agentPresets: {
      remoteExportList: async () => ({
        presets: [{ id: 'standard', isDefault: true }, { id: 'ptc' }, { id: 'minimal' }],
      }),
    },
    goals: {
      remoteExportCreate: (resolved, request) => {
        calls.push(['goal.create', resolved, request]);
        return { ref: { id: 'g-1', revision: 1 } };
      },
      pause: (resolved, ref) => { calls.push(['goal.pause', resolved, ref]); return { ...ref, revision: 2 }; },
      clear: (resolved, ref) => { calls.push(['goal.clear', resolved, ref]); return { ...ref, revision: 2 }; },
    },
  };
  return { services, calls, agent };
}

test('alpha adapter exposes the complete BridgeHost contract without apiProxy', async () => {
  const { services, calls, agent } = fixture();
  const host = createDshAlphaHost(services);

  assert.equal(host.descriptor.id, 'dsh-typed-controllers');
  assert.equal(probeDshAlphaHost(services).every((row) => row.available), true);

  const listed = await host.sessions.list();
  assert.equal(listed.items[0].agentPreset, 'minimal');
  const models = await host.sessions.models({ sessionId: 's-source' });
  assert.deepEqual(models.current, { provider: 'deepseek', model: 'v4-pro', reasoningEffort: 'high' });
  assert.equal(models.groups[0].models[1].id, 'v4-pro');

  const history = await host.sessions.history({ sessionId: 's-source', maxMessages: 10 });
  assert.deepEqual(history.events.map((entry) => entry.event.type), ['user/message', 'assistant/message']);

  await host.sessions.prompt({ sessionId: 's-target', mode: 'queue', content: [{ type: 'text', text: 'go' }] });
  const prompt = calls.find(([name]) => name === 'prompt')[1];
  assert.match(prompt.requestId, /^bridge-/);
  assert.equal(prompt.sessionId, 's-target');

  assert.deepEqual(await host.workspaces.list(), {
    items: [{ workspaceId: 'ws-1', sessionIds: ['s-source'] }],
  });
  await host.goals.create({ sessionId: 's-source', objective: 'handoff', maxGoalRounds: 1 });
  assert.deepEqual(calls.find(([name]) => name === 'goal.create').slice(1), [agent, { objective: 'handoff', maxGoalRounds: 1 }]);
});

test('host resolver keeps rc.2 apiProxy as the first choice and falls back to alpha controllers', () => {
  const { services } = fixture();
  const alpha = resolveDshHost(services);
  assert.equal(alpha.descriptor.id, 'dsh-typed-controllers');

  const apiProxy = { sessions: {}, workspace: {}, goals: {}, agentPresets: {} };
  const legacy = resolveDshHost({ ...services, apiProxy });
  assert.equal(legacy.descriptor.id, 'dsh-api-proxy');
});

test('alpha probe fails closed when one required controller is missing', () => {
  const { services } = fixture();
  delete services.sessionController.prompt;
  const report = probeDshAlphaHost(services);
  assert.equal(report.find((row) => row.method === 'session.prompt').available, false);
});

test('optional service discovery never touches Cordis properties without inject', () => {
  const { services } = fixture();
  const cordis = new Proxy({
    get: (name) => services[name],
  }, {
    get(target, key) {
      if (key === 'get') return target.get;
      throw new Error(`cannot get property "${String(key)}" without inject`);
    },
  });

  assert.equal(resolveDshHost(cordis).descriptor.id, 'dsh-typed-controllers');
  assert.equal(probeDshAlphaHost(cordis).every((row) => row.available), true);
});

test('a long alpha history is inspected once and preserves the same bounded message window', async () => {
  const { services } = fixture();
  const events = Array.from({ length: 240 }, (_, seq) => ({
    type: seq % 2 === 0 ? 'user/message' : 'assistant/message', seq, time: seq + 1,
    data: { content: [{ type: 'text', text: `fact-${seq}` }] },
  }));
  let inspections = 0;
  services.sessionController.inspect = async () => {
    inspections++;
    return { meta: {}, events };
  };
  const host = createDshAlphaHost(services);
  const messages = await foldedHistory(host, 's-source', { pageMessages: 20, maxPages: 6 });
  assert.equal(inspections, 1, 'pagination must not repeatedly materialize the whole history');
  assert.deepEqual(messages.map(message => message.content), events.slice(-120).map(event => event.data.content[0].text));

  events.push({ type: 'user/message', seq: 240, time: 241, data: { content: [{ type: 'text', text: 'new fact' }] } });
  const next = await foldedHistory(host, 's-source', { pageMessages: 20, maxPages: 6 });
  assert.equal(inspections, 2, 'a new read must observe a new snapshot, not a TTL cache');
  assert.equal(next.at(-1).content, 'new fact');
});

test('alpha worker polling still observes newly appended turn events after a snapshot read', async () => {
  const { services } = fixture();
  let inspections = 0;
  services.sessionController.inspect = async () => ({ meta: {}, events: ++inspections < 3
    ? [{ type: 'turn/start', seq: 2, time: 1, data: {} }]
    : [{ type: 'turn/start', seq: 2, time: 1, data: {} }, { type: 'turn/end', seq: 3, time: 2, data: {} }],
  });
  const host = createDshAlphaHost(services);
  await foldedHistory(host, 's-source');
  assert.deepEqual(await waitIdle(host, 's-source', { afterSeq: 1, pollMs: 1, timeoutMs: 1000 }), { idle: true, started: true });
  assert.equal(inspections, 3);
});

test('single-read and legacy paged histories agree with interleaved tool and compaction events', async () => {
  const { services } = fixture();
  const events = [];
  const append = (type, data) => events.push({ type, seq: events.length, time: events.length + 1, data });
  for (let i = 0; i < 40; i++) {
    append('turn/start', {});
    append('user/message', { content: [{ type: 'text', text: i === 28 ? '<compacted-summary>current port 7813</compacted-summary>' : `question-${i}` }] });
    append('tool/call', { tool: 'read', callId: `c${i}`, input: { path: `src/${i}.ts` } });
    append('tool/result', { callId: `c${i}`, output: `result-${i}` });
    append('assistant/message', { message: { content: [{ type: 'text', text: `answer-${i}` }] } });
    append('turn/end', {});
  }
  services.sessionController.inspect = async () => ({ meta: {}, events });
  const host = createDshAlphaHost(services);
  const { historyWindow: unused, ...sessions } = host.sessions;
  const legacy = { ...host, sessions };
  for (const pageMessages of [1, 3, 20, 60]) {
    assert.deepEqual(
      await foldedHistory(host, 's-source', { pageMessages, maxPages: 3 }),
      await foldedHistory(legacy, 's-source', { pageMessages, maxPages: 3 }),
    );
  }
});

test('snapshot failures and cancellation propagate without returning stale or empty history', async () => {
  const { services } = fixture();
  const abort = new AbortController();
  services.sessionController.inspect = async (_id, signal) => {
    assert.equal(signal, abort.signal);
    signal.throwIfAborted();
    throw new Error('history read failed');
  };
  const host = createDshAlphaHost(services, abort.signal);
  await assert.rejects(foldedHistory(host, 's-source'), /history read failed/);
  abort.abort(new Error('cancelled read'));
  await assert.rejects(foldedHistory(host, 's-source'), /cancelled read/);
});
