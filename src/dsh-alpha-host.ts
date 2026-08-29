/**
 * DSH v0.1.2 alpha typed-controller adapter.
 *
 * The alpha removed the legacy ApiProxy service.  Keep that product change at
 * this boundary: migration code continues to consume BridgeHost, while this
 * adapter talks to the Host controllers structurally so the package can still
 * be built against the current rc.2 SDK.
 */
import { randomUUID } from 'node:crypto'

import { createApiProxyHost, probeApiProxy, type ApiProxyLike } from './api-rpc.ts'
import {
  REQUIRED_BRIDGE_CAPABILITIES,
  type BridgeHost,
  type BridgeHostProbe,
  type ModelSelection,
  type SessionRow,
} from './host.ts'
import { RpcError } from './rpc.ts'
import type { SessionEvent } from './types.ts'

type UnknownRecord = Record<string, unknown>

interface AlphaSessionController {
  list(request: { cursor?: string }, signal: AbortSignal): Promise<{ items?: unknown[] }>
  create(request: UnknownRecord): Promise<UnknownRecord>
  inspect(sessionId: string, signal?: AbortSignal): Promise<{ meta: UnknownRecord; events: SessionEvent[] }>
  modelCatalog(): Promise<UnknownRecord>
  selectModel(request: UnknownRecord): Promise<unknown>
  prompt(request: UnknownRecord, signal: AbortSignal): Promise<unknown>
  cancel(request: { sessionId: string }): unknown
  rename(request: UnknownRecord): Promise<unknown>
  attachment?(request: UnknownRecord): Promise<unknown>
  resolveAgent(sessionId: string): Promise<{ agent?: unknown; error?: AlphaFailure }>
}

interface AlphaFailure {
  code?: string
  message?: string
  details?: unknown
}

interface AlphaServices {
  apiProxy?: ApiProxyLike
  sessionController?: Partial<AlphaSessionController>
  workspaceRegistry?: { list?: () => unknown[] }
  workspaceController?: { archiveSession?: (request: { sessionId: string }) => Promise<unknown> }
  agentPresets?: { remoteExportList?: () => Promise<{ presets?: unknown[] }> }
  goals?: {
    remoteExportCreate?: (agent: unknown, request: UnknownRecord) => unknown
    pause?: (agent: unknown, ref: UnknownRecord) => unknown
    clear?: (agent: unknown, ref: UnknownRecord) => unknown
  }
}

type ContextLike = AlphaServices & { get?: (name: string) => unknown }

const ALPHA_METHODS: Record<string, (services: AlphaServices) => unknown> = {
  'session.list': services => services.sessionController?.list,
  'session.create': services => services.sessionController?.create,
  'session.history': services => services.sessionController?.inspect,
  'session.models': services => services.sessionController?.modelCatalog,
  'session.selectModel': services => services.sessionController?.selectModel,
  'session.prompt': services => services.sessionController?.prompt,
  'session.cancel': services => services.sessionController?.cancel,
  'session.rename': services => services.sessionController?.rename,
  'workspace.list': services => services.workspaceRegistry?.list,
  'workspace.archiveSession': services => services.workspaceController?.archiveSession,
  'agentPreset.list': services => services.agentPresets?.remoteExportList,
  'goal.create': services => services.goals?.remoteExportCreate,
  'goal.pause': services => services.goals?.pause,
}

function service<T>(ctx: ContextLike, name: keyof AlphaServices): T | undefined {
  try {
    const getter = ctx.get
    if (typeof getter === 'function') {
      const found = getter.call(ctx, name)
      if (found !== undefined) return found as T
    }
  } catch {
    // Cordis returns undefined for an unavailable optional service; custom
    // Context implementations may throw instead, so fall through to fixtures.
  }
  try {
    return ctx[name] as T | undefined
  } catch {
    return undefined
  }
}

function servicesOf(ctx: ContextLike): AlphaServices {
  return {
    apiProxy: service<ApiProxyLike>(ctx, 'apiProxy'),
    sessionController: service<Partial<AlphaSessionController>>(ctx, 'sessionController'),
    workspaceRegistry: service<AlphaServices['workspaceRegistry']>(ctx, 'workspaceRegistry'),
    workspaceController: service<AlphaServices['workspaceController']>(ctx, 'workspaceController'),
    agentPresets: service<AlphaServices['agentPresets']>(ctx, 'agentPresets'),
    goals: service<AlphaServices['goals']>(ctx, 'goals'),
  }
}

function failureOf(error: unknown): AlphaFailure {
  const value = error as {
    failure?: AlphaFailure
    rpc?: AlphaFailure
    code?: string
    message?: string
    details?: unknown
  }
  return value?.failure ?? value?.rpc ?? {
    code: value?.code,
    message: value?.message,
    details: value?.details,
  }
}

async function invoke<T>(method: string, operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof RpcError) throw error
    const failure = failureOf(error)
    throw new RpcError(
      method,
      failure.code ?? 'internal',
      failure.message ?? (error instanceof Error ? error.message : String(error)),
      failure.details,
    )
  }
}

function required<T>(method: string, value: T | undefined): T {
  if (value === undefined) throw new RpcError(method, 'unavailable', `DSH alpha host 没有提供 ${method}`)
  return value
}

function projectionValues(row: unknown): UnknownRecord {
  const values = (row as { projections?: { values?: unknown } })?.projections?.values
  return values !== null && typeof values === 'object' ? values as UnknownRecord : {}
}

function sessionRow(row: unknown): SessionRow {
  const source = row as UnknownRecord
  const values = projectionValues(row)
  const preset = typeof values.agentPreset === 'string'
    ? values.agentPreset
    : typeof source.agentPreset === 'string' ? source.agentPreset : undefined
  return {
    sessionId: String(source.sessionId ?? ''),
    ...(typeof source.running === 'boolean' ? { running: source.running } : {}),
    ...(typeof source.blank === 'boolean' ? { blank: source.blank } : {}),
    ...(typeof source.cwd === 'string' ? { cwd: source.cwd } : {}),
    ...(preset === undefined ? {} : { agentPreset: preset }),
    ...(typeof source.parentSessionId === 'string' ? { parentSessionId: source.parentSessionId } : {}),
    ...Object.keys(values).length === 0 ? {} : { projections: { values } },
  }
}

function currentModel(row: unknown): Partial<ModelSelection> | undefined {
  const selection = projectionValues(row).modelSelection
  if (selection === null || typeof selection !== 'object') return undefined
  const record = selection as { next?: unknown; lastUsed?: unknown }
  const candidate = record.next ?? record.lastUsed
  if (candidate === null || typeof candidate !== 'object') return undefined
  const model = candidate as UnknownRecord
  if (typeof model.provider !== 'string' || typeof model.model !== 'string') return undefined
  return {
    provider: model.provider,
    model: model.model,
    ...(typeof model.reasoningEffort === 'string' ? { reasoningEffort: model.reasoningEffort } : {}),
  }
}

function paginateHistory(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { events: { event: SessionEvent }[]; hasMore: boolean } {
  const visible = beforeSeq === undefined ? [...events] : events.filter(event => (event.seq ?? -1) < beforeSeq)
  let count = 0
  let cut = 0
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const type = visible[index]?.type
    if (type !== 'user/message' && type !== 'assistant/message') continue
    count += 1
    if (count >= maxMessages) {
      cut = index
      break
    }
  }
  return {
    events: visible.slice(cut).map(event => ({ event })),
    hasMore: cut > 0,
  }
}

async function resolvedAgent(services: AlphaServices, sessionId: string): Promise<unknown> {
  const resolve = required('session.resolveAgent', services.sessionController?.resolveAgent)
  const result = await invoke('session.resolveAgent', () => resolve.call(services.sessionController, sessionId))
  if (result.error !== undefined) {
    throw new RpcError(
      'session.resolveAgent',
      result.error.code ?? 'internal',
      result.error.message ?? 'DSH alpha 无法恢复目标会话',
      result.error.details,
    )
  }
  return required('session.resolveAgent', result.agent)
}

/** Probe the real alpha services instead of the adapter's always-present closures. */
export function probeDshAlphaHost(input: ContextLike): BridgeHostProbe[] {
  const services = servicesOf(input)
  return REQUIRED_BRIDGE_CAPABILITIES.map(method => ({
    method,
    available: typeof ALPHA_METHODS[method]?.(services) === 'function',
  }))
}

/** Create the semantic BridgeHost over DSH v0.1.2 typed Host controllers. */
export function createDshAlphaHost(input: ContextLike, signal?: AbortSignal): BridgeHost {
  const services = servicesOf(input)
  const controller = services.sessionController
  const abort = signal ?? new AbortController().signal

  const host: BridgeHost = {
    descriptor: Object.freeze({ id: 'dsh-typed-controllers', version: '0.1.2-alpha', transport: 'in-process' }),
    sessions: Object.freeze({
      list: async (request = {}) => {
        const list = required('session.list', controller?.list)
        const value = await invoke('session.list', () => list.call(controller, request, abort))
        return { items: (value.items ?? []).map(sessionRow) }
      },
      create: async request => {
        const create = required('session.create', controller?.create)
        return await invoke('session.create', () => create.call(controller, request)) as { sessionId: string; agentPreset?: string }
      },
      history: async (request) => {
        const inspect = required('session.history', controller?.inspect)
        const value = await invoke('session.history', () => inspect.call(controller, request.sessionId, abort))
        return paginateHistory(value.events, request.beforeSeq, request.maxMessages ?? 60)
      },
      models: async ({ sessionId }) => {
        const list = required('session.list', controller?.list)
        const catalog = required('session.models', controller?.modelCatalog)
        const [listed, available] = await Promise.all([
          invoke('session.list', () => list.call(controller, {}, abort)),
          invoke('session.models', () => catalog.call(controller)),
        ])
        const row = (listed.items ?? []).find(item => (item as { sessionId?: unknown }).sessionId === sessionId)
        return {
          ...available,
          current: currentModel(row) ?? (available.default as Partial<ModelSelection> | undefined),
        }
      },
      selectModel: request => {
        const select = required('session.selectModel', controller?.selectModel)
        return invoke('session.selectModel', () => select.call(controller, { ...request }))
      },
      prompt: request => {
        const prompt = required('session.prompt', controller?.prompt)
        return invoke('session.prompt', () => prompt.call(controller, {
          ...request,
          requestId: `bridge-${randomUUID()}`,
        }, abort))
      },
      cancel: request => {
        const cancel = required('session.cancel', controller?.cancel)
        return invoke('session.cancel', () => cancel.call(controller, request))
      },
      rename: request => {
        const rename = required('session.rename', controller?.rename)
        return invoke('session.rename', () => rename.call(controller, request))
      },
      attachment: request => {
        const attachment = required('session.attachment', controller?.attachment)
        return invoke('session.attachment', () => attachment.call(controller, request)) as Promise<never>
      },
    }),
    workspaces: Object.freeze({
      list: async () => {
        const list = required('workspace.list', services.workspaceRegistry?.list)
        const rows = await invoke('workspace.list', () => list.call(services.workspaceRegistry))
        return {
          items: rows.map((item) => {
            const row = item as UnknownRecord
            return {
              workspaceId: String(row.id ?? row.workspaceId ?? ''),
              sessionIds: Array.isArray(row.sessionIds) ? row.sessionIds.map(String) : [],
            }
          }),
        }
      },
      archiveSession: request => {
        const archive = required('workspace.archiveSession', services.workspaceController?.archiveSession)
        return invoke('workspace.archiveSession', () => archive.call(services.workspaceController, request))
      },
    }),
    presets: Object.freeze({
      list: async () => {
        const list = required('agentPreset.list', services.agentPresets?.remoteExportList)
        return await invoke('agentPreset.list', () => list.call(services.agentPresets)) as { presets?: never[] }
      },
    }),
    goals: Object.freeze({
      create: async request => {
        const agent = await resolvedAgent(services, request.sessionId)
        const create = required('goal.create', services.goals?.remoteExportCreate)
        return await invoke('goal.create', () => create.call(services.goals, agent, {
          objective: request.objective,
          maxGoalRounds: request.maxGoalRounds,
        })) as { ref: { id: string; revision: number } }
      },
      pause: async request => {
        const agent = await resolvedAgent(services, request.sessionId)
        const pause = required('goal.pause', services.goals?.pause)
        return await invoke('goal.pause', () => pause.call(services.goals, agent, request.ref))
      },
      clear: async request => {
        const agent = await resolvedAgent(services, request.sessionId)
        const clear = required('goal.clear', services.goals?.clear)
        return await invoke('goal.clear', () => clear.call(services.goals, agent, request.ref))
      },
    }),
  }
  return Object.freeze(host)
}

/** Prefer the stable rc.2 path when present; otherwise use alpha controllers. */
export function resolveDshHost(input: ContextLike, signal?: AbortSignal): BridgeHost {
  const services = servicesOf(input)
  if (services.apiProxy !== undefined) return createApiProxyHost(services.apiProxy, signal)
  if (services.sessionController !== undefined) return createDshAlphaHost(services, signal)
  throw new RpcError('bridge.host', 'unavailable', '当前 DSH 没有可用的 apiProxy 或 typed sessionController')
}

/** Probe the active generation using its native surface. */
export function probeDshHost(input: ContextLike): BridgeHostProbe[] {
  const services = servicesOf(input)
  if (services.apiProxy !== undefined) return probeApiProxy(services.apiProxy)
  return probeDshAlphaHost(services)
}
