/** Bridge-only review projection, outside the Host's collapsed process details. */
import type { ConversationLocation, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { parseBridgeCard, readBridgeToolOutcome, type BridgeOutcome } from './client-contract.ts'

export interface BridgeReviewData { readonly outcome: Exclude<BridgeOutcome, null> }
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'dsh-bridge-review': BridgeReviewData }
}

interface Review {
  readonly owner: 'native' | 'ptc'
  readonly callId: string
  readonly result?: BridgeReviewData & { readonly seq: number; readonly location: ConversationLocation }
}
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const identity = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 1024 ? value : undefined
const idOf = (owner: Review['owner'], callId: string): string => JSON.stringify([owner, callId])

function acceptedOutcome(meta: unknown): BridgeReviewData['outcome'] | undefined {
  const outcome = readBridgeToolOutcome(meta)
  if (!outcome) return undefined
  const card = parseBridgeCard(outcome)
  if (card.phase === 'error' || (card.phase === 'message' && card.picker)
    || (card.phase === 'preview' && card.previewId)) return outcome
  return undefined
}

/** Nonexclusive observer: native Tool/PTC records and their original view remain untouched. */
export function createBridgeReviewDefinition(): ConversationNodeDefinition<Review> {
  return {
    kind: 'dsh-bridge-review', target: 'chat',
    match(event) {
      const data = object(event.data)
      if (!data) return null
      if (event.type === 'tool/call') {
        const callId = identity(data.callId)
        return data.name === 'bridge_prepare' && callId ? { id: idOf('native', callId), role: 'start' } : null
      }
      if (event.type === 'tool/result') {
        const message = object(data.message)
        const callId = identity(message?.toolCallId)
        return callId && message?.isError !== true && acceptedOutcome(data.meta)
          ? { id: idOf('native', callId), role: 'update' } : null
      }
      if (event.type === 'tool/ptc-dispatch-start' || event.type === 'tool/ptc-dispatch') {
        const callId = identity(data.subCallId)
        return data.name === 'bridge_prepare' && callId
          && (event.type === 'tool/ptc-dispatch-start' || (data.isError !== true && acceptedOutcome(data.meta)))
          ? { id: idOf('ptc', callId), role: 'start' } : null
      }
      return null
    },
    start(_context, match) {
      const data = object(match.event.data)!
      const owner = match.event.type === 'tool/call' ? 'native' : 'ptc'
      const callId = identity(owner === 'native' ? data.callId : data.subCallId)!
      const outcome = match.event.type === 'tool/ptc-dispatch' ? acceptedOutcome(data.meta) : undefined
      return { owner, callId, ...(outcome ? { result: { outcome, seq: match.event.seq, location: match.location } } : {}) }
    },
    update(context, match) {
      const data = object(match.event.data)!
      const callId = identity(match.event.type === 'tool/result' ? object(data.message)?.toolCallId : data.subCallId)
      const outcome = (match.event.type === 'tool/result' || match.event.type === 'tool/ptc-dispatch') ? acceptedOutcome(data.meta) : undefined
      if (!outcome || callId !== context.state.callId) return context.state
      return { ...context.state, result: { outcome, seq: match.event.seq, location: match.location } }
    },
    buildViewNode(context) {
      // Native update-only windows have no owning bridge_prepare call header.
      // Prepending that exact header lets the assembler replay and admit it.
      const result = context.state?.result
      if (!result) return null
      return {
        key: context.key, kind: 'dsh-bridge-review', id: context.id, target: 'chat',
        anchorSeq: result.seq, location: result.location, visibility: 'visible', groupTree: 'turn',
        data: { outcome: result.outcome },
      } satisfies ChatConversationViewNode
    },
  }
}
