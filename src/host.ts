/**
 * Bridge 的宿主端口。
 *
 * 迁移核心只依赖这些语义能力；DSH HTTP、进程内 apiProxy，以及未来可能出现的
 * dsh-std participant 都应在 adapter 中实现本接口。RPC 方法名与产品对象形状不应
 * 再进入 migrate.ts。
 */
import { RpcError, type Rpc } from './rpc.ts';
import type { ImageAttachmentRef, SessionEvent } from './types.ts';

export interface BridgeHostDescriptor {
  /** adapter 的稳定标识，例如 dsh-api-proxy、dsh-http-api 或 dsh-std。 */
  id: string;
  version?: string;
  transport?: string;
}

export interface SessionRow {
  sessionId: string;
  running?: boolean;
  blank?: boolean;
  cwd?: string;
  agentPreset?: string;
  parentSessionId?: string;
  projections?: { values?: Record<string, unknown> };
}

export interface PresetRow {
  id: string;
  trust?: 'system' | 'user';
  isDefault?: boolean;
  name?: string;
  description?: string;
  broken?: string;
}

export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface SessionModels {
  current?: Partial<ModelSelection>;
  groups?: { id: string; models?: { id: string }[] }[];
  [key: string]: unknown;
}

export type PromptContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: ImageAttachmentRef['mediaType']; data: string; name?: string };

export interface BridgeHost {
  readonly descriptor: BridgeHostDescriptor;
  readonly sessions: {
    list(input?: { cursor?: string }): Promise<{ items?: SessionRow[]; nextCursor?: string }>;
    create(input: { workspaceId?: string; cwd?: string; agentPreset?: string }): Promise<{ sessionId: string; agentPreset?: string }>;
    history(input: {
      sessionId: string;
      maxMessages?: number;
      beforeSeq?: number;
    }, options?: { timeoutMs?: number }): Promise<{ events?: { event: SessionEvent }[]; hasMore?: boolean }>;
    models(input: { sessionId: string }): Promise<SessionModels>;
    selectModel(input: { sessionId: string } & ModelSelection): Promise<unknown>;
    prompt(input: { sessionId: string; mode: 'queue'; content: readonly PromptContent[] }): Promise<unknown>;
    cancel(input: { sessionId: string }): Promise<unknown>;
    rename(input: { sessionId: string; title: string }): Promise<unknown>;
    attachment?(input: {
      sessionId: string;
      attachmentId: string;
    }): Promise<{ attachment?: ImageAttachmentRef; data?: string }>;
  };
  readonly workspaces: {
    list(): Promise<{ items?: { workspaceId: string; sessionIds?: string[] }[] }>;
    archiveSession(input: { sessionId: string }): Promise<unknown>;
  };
  readonly presets: {
    list(): Promise<{ presets?: PresetRow[] }>;
  };
  readonly goals: {
    create(input: {
      sessionId: string;
      objective: string;
      maxGoalRounds: number;
    }): Promise<{ ref: { id: string; revision: number } }>;
    pause(input: { sessionId: string; ref: { id: string; revision: number } }): Promise<unknown>;
    clear?(input: { sessionId: string; ref: { id: string; revision: number } }): Promise<unknown>;
  };
}

/** 0.2.x 兼容入口：现有调用者仍可传入旧的字符串 Rpc。 */
export type BridgeHostInput = BridgeHost | Rpc;

export const REQUIRED_BRIDGE_CAPABILITIES = Object.freeze([
  'session.list',
  'session.create',
  'session.history',
  'session.models',
  'session.selectModel',
  'session.prompt',
  'session.cancel',
  'session.rename',
  'workspace.list',
  'workspace.archiveSession',
  'agentPreset.list',
  'goal.create',
  'goal.pause',
] as const);

export const OPTIONAL_BRIDGE_CAPABILITIES = Object.freeze([
  'session.attachment',
  'goal.clear',
] as const);

export interface BridgeHostProbe {
  method: string;
  available: boolean;
}

const REQUIRED_ACCESSORS: Record<typeof REQUIRED_BRIDGE_CAPABILITIES[number], (host: BridgeHost) => unknown> = {
  'session.list': host => host.sessions.list,
  'session.create': host => host.sessions.create,
  'session.history': host => host.sessions.history,
  'session.models': host => host.sessions.models,
  'session.selectModel': host => host.sessions.selectModel,
  'session.prompt': host => host.sessions.prompt,
  'session.cancel': host => host.sessions.cancel,
  'session.rename': host => host.sessions.rename,
  'workspace.list': host => host.workspaces.list,
  'workspace.archiveSession': host => host.workspaces.archiveSession,
  'agentPreset.list': host => host.presets.list,
  'goal.create': host => host.goals.create,
  'goal.pause': host => host.goals.pause,
};

/** 只检查端口形状，不执行任何宿主操作。 */
export function probeBridgeHost(host: BridgeHost | undefined): BridgeHostProbe[] {
  return REQUIRED_BRIDGE_CAPABILITIES.map(method => {
    let available = false;
    try {
      available = host !== undefined && typeof REQUIRED_ACCESSORS[method](host) === 'function';
    } catch {
      // 外部 adapter 可能只交出部分端口；doctor 必须报告缺失，不能自己先崩。
    }
    return { method, available };
  });
}

/**
 * 把现有 DSH 字符串 RPC 包成语义端口。
 *
 * 这是兼容 adapter，不是迁移核心的一部分；未来的 dsh-std adapter 可以直接实现
 * BridgeHost，而不需要复刻这些 DSH 路由名。
 */
export function createBridgeHostFromRpc(
  rpc: Rpc,
  descriptor: BridgeHostDescriptor = { id: 'dsh-rpc', transport: 'rpc' },
): BridgeHost {
  const host: BridgeHost = {
    descriptor: Object.freeze({ ...descriptor }),
    sessions: Object.freeze({
      list: (input = {}) => rpc<{ items?: SessionRow[]; nextCursor?: string }>('session.list', input),
      create: input => rpc<{ sessionId: string; agentPreset?: string }>('session.create', input),
      history: (input, options) => rpc<{ events?: { event: SessionEvent }[]; hasMore?: boolean }>(
        'session.history', input, options?.timeoutMs,
      ),
      models: input => rpc<SessionModels>('session.models', input),
      selectModel: input => rpc('session.selectModel', input),
      prompt: input => rpc('session.prompt', input),
      cancel: input => rpc('session.cancel', input),
      rename: input => rpc('session.rename', input),
      attachment: input => rpc<{ attachment?: ImageAttachmentRef; data?: string }>('session.attachment', input),
    }),
    workspaces: Object.freeze({
      list: () => rpc<{ items?: { workspaceId: string; sessionIds?: string[] }[] }>('workspace.list', {}),
      archiveSession: input => rpc('workspace.archiveSession', input),
    }),
    presets: Object.freeze({
      list: () => rpc<{ presets?: PresetRow[] }>('agentPreset.list', {}),
    }),
    goals: Object.freeze({
      create: input => rpc<{ ref: { id: string; revision: number } }>('goal.create', input),
      pause: input => rpc('goal.pause', input),
      clear: input => rpc('goal.clear', input),
    }),
  };
  return Object.freeze(host);
}

/** 将兼容输入规范化为 BridgeHost；核心入口统一调用此函数。 */
export function asBridgeHost(input: BridgeHostInput): BridgeHost {
  if (typeof input === 'function') return createBridgeHostFromRpc(input);
  if (input && typeof input === 'object' && typeof input.sessions?.list === 'function') return input;
  throw new RpcError('bridge.host', 'invalid-adapter', '宿主 adapter 没有实现 BridgeHost。');
}

/** 对缺失的可选能力给出与 RPC 错误一致的可分类失败。 */
export function missingHostCapability(capability: string): RpcError {
  return new RpcError('bridge.host', 'unavailable', `宿主 adapter 没有提供 ${capability}`);
}
