/** Optional model entry: prepare a human-reviewed handoff, never execute one. */
import type { BridgeInvocation, BridgeResult } from './command.ts'

interface ToolExecution {
  readonly agent?: {
    readonly id?: string
    readonly session?: { readonly id?: string; readonly header?: { readonly id?: string } }
  }
  readonly callId: string
  readonly signal: AbortSignal
  /** A Host-owned marker for this successful tool result, not a global pause. */
  concludeTurn?(): void
}

type Outcome = { kind: 'success' | 'error'; text: string }
type Arguments = { targetPreset?: string; lang?: 'zh' | 'en' | 'auto' }
type Content = Array<{ type: 'text'; text: string }>

/** Public ToolDefinition shape, deliberately without a runtime SDK import. */
export interface BridgePrepareTool {
  readonly name: 'bridge_prepare'
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: Outcome): Content
    presentationMeta(args: unknown, value: Outcome): { bridge: { version: 1; outcome: Outcome } }
  }
  execute(args: unknown, exec: ToolExecution): Promise<Outcome>
}

export interface BridgeNaturalLanguage {
  readonly tool: BridgePrepareTool
  /** Abort new work, then wait for all owned preparation calls to settle. */
  dispose(): Promise<void>
}

const TTL_MS = 30 * 60_000
const MAX_COMPLETED = 128
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function argumentsOf(value: unknown): Arguments {
  if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('Invalid Bridge parameters: expected an object.')
  }
  if (Reflect.ownKeys(value).some(key => key !== 'targetPreset' && key !== 'lang')
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !('value' in item))) {
    throw new Error('Invalid Bridge parameter: only targetPreset and lang are accepted.')
  }
  const target = value.targetPreset
  if (Object.hasOwn(value, 'targetPreset')
    && (typeof target !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(target))) {
    throw new Error('Invalid Bridge target preset. Use a preset identifier, not a command.')
  }
  const lang = value.lang
  if (Object.hasOwn(value, 'lang') && lang !== 'zh' && lang !== 'en' && lang !== 'auto') {
    throw new Error('Invalid Bridge language: use zh, en, or auto.')
  }
  return value as Arguments
}

function sessionIdOf(exec: ToolExecution): string {
  const agent = exec?.agent
  const identities = [agent?.id, agent?.session?.id, agent?.session?.header?.id]
    .filter(value => value !== undefined)
  if (identities.length === 0 || identities.some(value => typeof value !== 'string' || !/^[^\s]{1,512}$/u.test(value))
    || new Set(identities).size !== 1) {
    throw new Error('Bridge needs one consistent, Host-owned current session identity.')
  }
  return identities[0] as string
}

interface Preparation {
  readonly fingerprint: string
  readonly at: number
  promise: Promise<Outcome>
  settled: boolean
}

/** Share the command's pending-preview table instead of creating another migration engine. */
export function createBridgeNaturalLanguage(deps: {
  handler: (invocation: BridgeInvocation) => Promise<BridgeResult>
  workerSessionIds: ReadonlySet<string>
  now?: () => number
}): BridgeNaturalLanguage {
  const lifecycle = new AbortController()
  const records = new Map<string, Preparation>()
  const preparingSessions = new Set<string>()
  const active = new Set<Promise<Outcome>>()
  const now = deps.now ?? Date.now
  let disposed = false
  let disposal: Promise<void> | undefined
  const prune = (): void => {
    for (const [key, record] of records) {
      if (record.settled && now() - record.at >= TTL_MS) records.delete(key)
    }
    let completed = [...records.values()].filter(record => record.settled).length
    for (const [key, record] of records) {
      if (completed <= MAX_COMPLETED) break
      if (record.settled) { records.delete(key); completed-- }
    }
  }
  const tool: BridgePrepareTool = {
    name: 'bridge_prepare',
    description: 'When the user asks to move this conversation/task to another DSH preset or mode, prepare an editable handoff preview. '
      + 'This NEVER migrates a session, authorizes continuation, or confirms a handoff. The user must review/edit the Bridge card and click Confirm migration. '
      + 'Use targetPreset for the requested preset ID (for example ptc); omit it to offer the target picker. Do not call from summary workers. '
      + 'No session ID, command, file, summary, go, or continue parameter is accepted.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        targetPreset: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,127}$', description: 'Requested DSH preset ID, not a command.' },
        lang: { type: 'string', enum: ['zh', 'en', 'auto'], description: 'Handoff display language; omit to follow Bridge settings.' },
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['kind', 'text'],
        properties: { kind: { type: 'string', enum: ['success', 'error'] }, text: { type: 'string' } },
      },
      render: (_args, value) => [{ type: 'text', text: value.kind === 'success'
        ? 'Bridge prepared a handoff review or target picker. No migration has happened. The user must review/edit the Bridge card and explicitly confirm migration. If this client has no Bridge card, use /bridge to open the same review flow.'
        : `Bridge could not prepare the handoff: ${value.text}` }],
      presentationMeta: (_args, value) => ({ bridge: { version: 1, outcome: value } }),
    },
    async execute(input, exec) {
      if (disposed) throw new Error('Bridge was unloaded; the preview entry is disposed.')
      const args = argumentsOf(input)
      const sessionId = sessionIdOf(exec)
      if (deps.workerSessionIds.has(sessionId)) throw new Error('Bridge summary workers cannot recursively prepare a handoff.')
      if (typeof exec.callId !== 'string' || !exec.callId || exec.callId.length > 1024) throw new Error('Invalid Bridge tool call identity.')
      exec.signal.throwIfAborted()
      prune()
      const key = JSON.stringify([sessionId, exec.callId])
      const fingerprint = JSON.stringify([args.targetPreset ?? null, args.lang ?? null])
      const recorded = records.get(key)
      if (recorded) {
        if (recorded.fingerprint !== fingerprint) throw new Error('The same Bridge call cannot be replayed with different parameters.')
        return recorded.promise
      }
      if (preparingSessions.has(sessionId)) throw new Error('A Bridge preview is already in progress for this session. Wait for it to finish.')
      const signal = AbortSignal.any([exec.signal, lifecycle.signal])
      preparingSessions.add(sessionId)
      // Install the identity/lock before entering any user-supplied asynchronous handler.
      const record: Preparation = { fingerprint, at: now(), settled: false, promise: undefined as never }
      records.set(key, record)
      const operation = Promise.resolve().then(async (): Promise<Outcome> => {
        signal.throwIfAborted()
        const rawInput = [args.targetPreset, args.lang ? `--lang ${args.lang}` : undefined].filter(Boolean).join(' ')
        const result = await deps.handler({ agent: { session: { id: sessionId } }, rawInput, signal })
        // A handler may finish despite cancellation. Such a preview must never become actionable.
        signal.throwIfAborted()
        if (disposed) throw new Error('Bridge was unloaded before preparation finished.')
        const outcome: Outcome = { kind: result.kind, text: result.text ?? '' }
        if (outcome.kind === 'success') exec.concludeTurn?.()
        return outcome
      }).finally(() => {
        preparingSessions.delete(sessionId)
        record.settled = true
        active.delete(operation)
        prune()
      })
      record.promise = operation
      active.add(operation)
      return operation
    },
  }
  return {
    tool,
    dispose() {
      if (disposal) return disposal
      disposed = true
      lifecycle.abort(new Error('Bridge was unloaded; preparation aborted.'))
      disposal = Promise.allSettled([...active]).then(() => { records.clear(); preparingSessions.clear() })
      return disposal
    },
  }
}
