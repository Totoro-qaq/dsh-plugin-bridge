import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDshAlphaHost,
  probeDshAlphaHost,
  resolveDshHost,
} from '../src/dsh-alpha-host.ts';

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
