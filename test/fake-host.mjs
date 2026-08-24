/**
 * 一个够真的假 dsh host。
 *
 * 迁移链路的正确性此前只能靠烧 token 的实测来验证；这里把网关的行为
 * （会话生命周期、running 状态、history 事件形状、goal / workspace / 模型目录）
 * 模拟出来，于是 previewMigration / executeMigration / CLI 都能在 CI 里跑完整条链路。
 * 事件形状与上游 `session.history` 一致，可直接喂给折叠器。
 */

export function createFakeHost(options = {}) {
  const {
    workerReply = '## 目标\n把电商后端做完\n## 当前状态\n刚定完约定\n## 关键决策与约定\n- 端口 7101\n'
      + '- 数据库 PostgreSQL，禁止 MongoDB\n## 关键文件\nsrc/shop/orders.ts\n## 下一步\n写订单模块',
    // 提示发出后，要被轮询几次才算跑完（用来模拟排队延迟 / 竞态）。
    replyAfterPolls = 2,
    // 第一次轮询前就已经不 running：模拟「host 还没排上队」。
    startAfterPolls = 0,
    failGoal = false,
    failPause = false,
    failClear = false,
    sourceImage = undefined,
    targetSupportsImages = false,
    presets = [
      { id: 'standard', trust: 'system', isDefault: true },
      { id: 'code', trust: 'system' },
      { id: 'minimal', trust: 'system' },
      { id: 'cordis', trust: 'system' },
      { id: 'broken-one', trust: 'user', broken: '组装失败' },
    ],
    models = {
      current: { provider: 'deepseek-official', model: 'deepseek-v4' },
      routable: true,
      groups: [{
        id: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-v4' }, { id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }],
      }],
      failures: [],
    },
  } = options;

  let nextId = 0;
  let seq = 0;
  const sessions = new Map();
  const calls = [];
  const archived = [];
  const goals = [];
  const pausedGoals = [];
  const clearedGoals = [];
  const renames = [];
  const selected = [];
  const attachments = new Map();

  const newSession = (agentPreset, extra = {}) => {
    const sessionId = `s-${(nextId += 1)}`;
    sessions.set(sessionId, {
      sessionId, agentPreset, running: false, blank: true, events: [],
      pendingPolls: 0, startPolls: 0, turnStarted: false, reply: null, ...extra,
    });
    return sessions.get(sessionId);
  };

  const push = (session, type, data) => {
    seq += 1;
    session.events.push({ event: { type, seq, time: 1_700_000_000_000 + seq * 1000, data } });
  };

  /** 源会话：一段带工具痕迹的真实历史。 */
  const source = newSession('minimal', { cwd: '/work/shop' });
  source.blank = false;
  push(source, 'user/message', { content: [{ type: 'text', text: '我们在做电商后端，端口固定 7101，数据库用 PostgreSQL，禁止引入 MongoDB。' }] });
  push(source, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '收到，逐条确认。' }] } });
  push(source, 'user/message', { content: [{ type: 'text', text: '核心逻辑写在 src/shop/orders.ts。' }] });
  push(source, 'tool/call', { turn: 2, step: 1, tool: 'str_replace_editor', callId: 'c1', input: { file_path: 'src/shop/orders.ts' } });
  push(source, 'tool/result', { turn: 2, step: 1, callId: 'c1', output: '（一大段 stdout，不该进摘要）' });
  push(source, 'assistant/message', { turn: 2, step: 1, message: { content: [{ type: 'text', text: '已建好 orders.ts 骨架。' }] } });

  function tick() {
    for (const session of sessions.values()) {
      if (session.startPolls > 0) {
        session.startPolls -= 1;
        continue;
      }
      if (session.pendingPolls > 0) {
        if (!session.turnStarted) {
          session.turnStarted = true;
          push(session, 'turn/start', {});
        }
        session.running = true;
        session.pendingPolls -= 1;
        if (session.pendingPolls === 0) {
          session.running = false;
          if (session.reply) {
            push(session, 'assistant/message', { turn: 9, step: 1, message: { content: [{ type: 'text', text: session.reply }] } });
            session.reply = null;
          }
          push(session, 'turn/end', {});
        }
      }
    }
  }

  if (sourceImage) {
    const ref = {
      attachmentId: 'img-source-1',
      mediaType: 'image/png',
      bytes: 8,
      width: 16,
      height: 16,
      name: 'source.png',
    };
    attachments.set(ref.attachmentId, { attachment: ref, data: 'iVBORw0KGgo=' });
    push(source, 'user/message', {
      content: [
        { type: 'image', attachment: ref },
        ...(sourceImage.userText ? [{ type: 'text', text: sourceImage.userText }] : []),
      ],
    });
    if (typeof sourceImage.assistantText === 'string') {
      push(source, 'assistant/message', {
        turn: 3,
        step: 1,
        message: { content: [{ type: 'text', text: sourceImage.assistantText }] },
      });
    }
  }

  function fail(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    error.rpc = { code, message, details };
    throw error;
  }

  async function handle(method, payload = {}) {
    calls.push({ method, payload });
    switch (method) {
      case 'session.list': {
        tick();
        return {
          items: [...sessions.values()]
            .filter((s) => !archived.includes(s.sessionId))
            .map((s) => ({
              sessionId: s.sessionId, running: s.running, blank: s.blank,
              cwd: s.cwd, agentPreset: s.agentPreset,
              projections: { values: { title: s.title ?? undefined } },
            })),
        };
      }
      case 'session.create': {
        if (payload.agentPreset && !presets.some((p) => p.id === payload.agentPreset)) {
          fail('agent-preset-not-found', `未知 preset ${payload.agentPreset}`);
        }
        const created = newSession(payload.agentPreset ?? 'standard', { cwd: payload.cwd ?? '/work/shop' });
        return { sessionId: created.sessionId, agentPreset: created.agentPreset };
      }
      case 'session.history': {
        tick();
        const session = sessions.get(payload.sessionId) ?? fail('session-not-found', '没有这个会话');
        return { events: session.events, hasMore: false };
      }
      case 'session.models':
        return models;
      case 'session.selectModel': {
        const session = sessions.get(payload.sessionId) ?? fail('session-not-found', '没有这个会话');
        selected.push({
          sessionId: session.sessionId,
          provider: payload.provider,
          model: payload.model,
          ...(payload.reasoningEffort ? { reasoningEffort: payload.reasoningEffort } : {}),
        });
        return {
          provider: payload.provider,
          model: payload.model,
          ...(payload.reasoningEffort ? { reasoningEffort: payload.reasoningEffort } : {}),
        };
      }
      case 'session.prompt': {
        const session = sessions.get(payload.sessionId) ?? fail('session-not-found', '没有这个会话');
        if (session !== source && payload.content.some((part) => part.type === 'image') && !targetSupportsImages) {
          fail('attachment-error', '当前模型不支持图片', { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' });
        }
        session.blank = false;
        push(session, 'user/message', { content: payload.content });
        session.pendingPolls = replyAfterPolls;
        session.startPolls = startAfterPolls;
        session.turnStarted = false;
        session.reply = session === source ? '好的' : workerReply;
        return { accepted: true };
      }
      case 'session.attachment': {
        sessions.get(payload.sessionId) ?? fail('session-not-found', '没有这个会话');
        return attachments.get(payload.attachmentId) ?? fail(
          'attachment-error',
          '图片不属于源会话',
          { reason: 'ATTACHMENT_NOT_REFERENCED' },
        );
      }
      case 'session.cancel': {
        const session = sessions.get(payload.sessionId) ?? fail('session-not-found', '没有这个会话');
        session.running = false;
        session.pendingPolls = 0;
        return { accepted: true };
      }
      case 'session.rename': {
        renames.push({ sessionId: payload.sessionId, title: payload.title });
        const session = sessions.get(payload.sessionId);
        if (session) session.title = payload.title;
        return { title: payload.title };
      }
      case 'agentPreset.list':
        return { presets };
      case 'goal.create': {
        if (failGoal) fail('internal', '这个部署没挂 goal 服务');
        goals.push({ ...payload });
        return { ref: { id: 'g-1', revision: 1 } };
      }
      case 'goal.pause': {
        if (failPause) fail('internal', '暂停目标失败');
        pausedGoals.push({ ...payload });
        return { ref: { id: payload.ref.id, revision: payload.ref.revision + 1 } };
      }
      case 'goal.clear': {
        if (failClear) fail('internal', '清除目标失败');
        clearedGoals.push({ ...payload });
        return { cleared: true };
      }
      case 'workspace.list':
        return { items: [{ workspaceId: 'ws-1', path: '/work/shop', sessionIds: [source.sessionId] }], archivedSessionIds: archived };
      case 'workspace.archiveSession':
        archived.push(payload.sessionId);
        return { archivedSessionIds: archived };
      default:
        fail('bad-request', `假 host 没实现 ${method}`);
    }
  }

  /** 把 handle 包成 ctx.apiProxy 的形状（信封与上游 unary 方法一致）。 */
  const unary = (method) => async (request, signal) => {
    try {
      return { rpcId: request.rpcId, result: { ok: true, value: await handle(method, request.payload, signal) } };
    } catch (error) {
      return {
        rpcId: request.rpcId,
        result: { ok: false, error: { code: error.code ?? 'internal', message: error.message, details: error.details ?? {} } },
      };
    }
  };
  const apiProxy = {
    sessions: {
      list: unary('session.list'),
      create: unary('session.create'),
      history: unary('session.history'),
      models: unary('session.models'),
      selectModel: unary('session.selectModel'),
      prompt: unary('session.prompt'),
      cancel: unary('session.cancel'),
      rename: unary('session.rename'),
      attachment: unary('session.attachment'),
    },
    workspace: {
      list: unary('workspace.list'),
      archiveSession: unary('workspace.archiveSession'),
    },
    goals: { create: unary('goal.create'), pause: unary('goal.pause'), clear: unary('goal.clear') },
    agentPresets: { list: unary('agentPreset.list') },
  };

  return {
    handle,
    apiProxy,
    sourceSessionId: source.sessionId,
    state: { sessions, calls, archived, goals, pausedGoals, clearedGoals, renames, selected, attachments },
    /** 把假 host 包成 migrate.ts 需要的 Rpc。 */
    rpc: (method, payload) => handle(method, payload),
  };
}
