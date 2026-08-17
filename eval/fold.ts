import type { SessionEvent } from './types.js';
import type { ChatMessage, ToolNode } from '../src/types.js';

function blockBody(block: Record<string, unknown>): string {
  if (typeof block.text === 'string' && block.text) return block.text;
  if (typeof block.thinking === 'string' && block.thinking) return block.thinking;
  if (typeof block.content === 'string' && block.content) return block.content;
  return '';
}

function isReasoningBlock(block: Record<string, unknown>): boolean {
  return block.type === 'reasoning' || block.type === 'thinking';
}

function peelThinkTags(text: string): { text: string; thinking: string } {
  const parts: string[] = [];
  const visible = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed) parts.push(trimmed);
    return '';
  });
  return { text: visible.trim(), thinking: parts.join('\n\n') };
}

function splitContentBlocks(blocks: unknown): { text: string; thinking: string; imageCount: number } {
  if (!Array.isArray(blocks)) return { text: '', thinking: '', imageCount: 0 };
  let text = '';
  let thinking = '';
  let imageCount = 0;
  for (const item of blocks) {
    const block = asRecord(item);
    if (!block) continue;
    if (block.type === 'image') {
      imageCount += 1;
      continue;
    }
    const body = blockBody(block);
    if (!body) continue;
    if (isReasoningBlock(block)) thinking += body;
    else if (block.type === 'text' || block.type == null) text += body;
  }
  const peeled = peelThinkTags(text);
  return { text: peeled.text, thinking: thinking || peeled.thinking, imageCount };
}

function textFromBlocks(blocks: unknown): string {
  return splitContentBlocks(blocks).text;
}

function imageCountFromBlocks(blocks: unknown): number {
  return splitContentBlocks(blocks).imageCount;
}

function stampThinkingMs(assistant: ChatMessage, startedAt: number | undefined, endedAt: number | undefined): void {
  if (assistant.thinkingMs != null || !assistant.thinking || startedAt == null || endedAt == null) return;
  const delta = endedAt - startedAt;
  if (delta >= 0) assistant.thinkingMs = delta;
}

function applyAssistantBlocks(assistant: ChatMessage, blocks: unknown): void {
  const split = splitContentBlocks(blocks);
  if (split.text) assistant.content = split.text;
  if (split.thinking) assistant.thinking = split.thinking;
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isNoiseUserText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith('<system-reminder>') || trimmed.startsWith('<system-notification>')) return true;
  if (/^<\/?runtime-context\b/i.test(trimmed) || /<\/runtime-context>/i.test(trimmed)) return true;
  if (/^Current runtime context\b/i.test(trimmed)) return true;
  if (trimmed.includes('supersedes earlier runtime-context')) return true;
  if (/^Current DSH file policy:/im.test(trimmed) && /Approval policy:/i.test(trimmed)) return true;
  return false;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function chunkText(chunk: Record<string, unknown> | null | undefined): string {
  if (!chunk) return '';
  if (typeof chunk.text === 'string' && chunk.text) return chunk.text;
  if (typeof chunk.delta === 'string' && chunk.delta) return chunk.delta;
  return blockBody(asRecord(chunk.block) ?? {});
}

function compactJson(value: unknown, limit = 240): string {
  if (value == null) return '';
  try {
    const json = JSON.stringify(value);
    if (!json || json === '{}' || json === '[]' || json === 'null') return '';
    return json.length > limit ? `${json.slice(0, limit)}…` : json;
  } catch {
    return '';
  }
}

function firstString(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function toolDetail(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const call = asRecord(data.call);
  const input = asRecord(data.input) ?? asRecord(data.arguments) ?? asRecord(data.args)
    ?? asRecord(call?.arguments) ?? asRecord(call?.input);
  return firstString([
    data.command,
    data.path,
    data.file,
    data.query,
    input?.command,
    input?.path,
    input?.file_path,
    input?.file,
    input?.query,
    input?.pattern,
  ]) || compactJson(input);
}

export function toolOutput(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  const pieces = [data.output, data.result, data.text, data.content];
  for (const piece of pieces) {
    if (typeof piece === 'string' && piece.trim()) return piece.trim();
    if (Array.isArray(piece)) {
      const text = piece
        .map((item) => (typeof item === 'string' ? item : blockBody(asRecord(item) ?? {})))
        .join('')
        .trim();
      if (text) return text;
    }
  }
  const error = asRecord(data.error);
  if (typeof error?.message === 'string' && error.message) return error.message;
  if (typeof data.error === 'string' && data.error) return data.error;
  return compactJson(data.output ?? data.result, 400);
}

/** Wire marker from dsh-compaction: `source.kind === 'plugin' && source.plugin === 'compact'`. */
export function isCompactCheckpoint(data: Record<string, unknown> | undefined, text = ''): boolean {
  const source = asRecord(data?.source);
  if (source?.kind === 'plugin' && source.plugin === 'compact') return true;
  return text.includes('<compacted-summary>');
}

export function stripCompactTags(text: string): string {
  return text.replace(/<\/?compacted-summary>/g, '').trim();
}

function asNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** `turn:step` when both are on the event payload; otherwise null. */
export function stepKey(event: SessionEvent): string | null {
  const turn = asNum(event.data?.turn);
  const step = asNum(event.data?.step);
  if (turn == null || step == null) return null;
  return `${turn}:${step}`;
}

export function toolName(data: Record<string, unknown> | undefined): string {
  if (!data) return 'tool';
  const name = data.tool ?? data.name ?? data.toolName;
  if (typeof name === 'string' && name) return name;
  const call = data.call;
  if (call && typeof call === 'object' && 'name' in call && typeof (call as { name: unknown }).name === 'string') {
    return (call as { name: string }).name;
  }
  return 'tool';
}

function callIdOf(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  if (typeof data.callId === 'string' && data.callId) return data.callId;
  const message = data.message;
  if (message && typeof message === 'object' && 'callId' in message) {
    const id = (message as { callId: unknown }).callId;
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

function finalizedSteps(events: SessionEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.type !== 'assistant/message') continue;
    const key = stepKey(event);
    if (key) keys.add(key);
  }
  return keys;
}

function keepAssistant(message: ChatMessage): boolean {
  return Boolean(message.content || message.thinking || message.toolNodes?.length);
}

function newAssistant(event: SessionEvent): ChatMessage {
  return {
    id: `e-${event.seq}`,
    role: 'assistant',
    latestEventSeq: event.seq,
    content: '',
    timestamp: formatTime(event.time),
  };
}

/** Fold a history page (or live mux events) into conversation messages. */
export function foldSessionEvents(events: SessionEvent[]): ChatMessage[] {
  const skipChunks = finalizedSteps(events);
  const out: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;
  let thinkingStartedAt: number | undefined;

  for (const event of events) {
    const data = event.data;
    if (event.type === 'user/message') {
      if (assistant && keepAssistant(assistant)) {
        stampThinkingMs(assistant, thinkingStartedAt, event.time);
        out.push(assistant);
      }
      assistant = null;
      thinkingStartedAt = undefined;
      const text = textFromBlocks(data?.content);
      const imageCount = imageCountFromBlocks(data?.content);
      if (isCompactCheckpoint(data, text)) {
        out.push({
          id: `e-${event.seq}`,
          role: 'system',
          kind: 'compaction',
          content: stripCompactTags(text),
          timestamp: formatTime(event.time),
        });
        continue;
      }
      if (isNoiseUserText(text)) continue;
      if (!text && imageCount === 0) continue;
      out.push({
        id: `e-${event.seq}`,
        role: 'user',
        content: text,
        imageCount,
        timestamp: formatTime(event.time),
      });
      continue;
    }

    if (event.type === 'assistant/message') {
      if (!assistant) assistant = newAssistant(event);
      assistant.latestEventSeq = event.seq;
      const message = data?.message as { content?: unknown } | undefined;
      applyAssistantBlocks(assistant, message?.content ?? data?.content);
      stampThinkingMs(assistant, thinkingStartedAt, event.time);
      if (assistant.content) {
        out.push(assistant);
        assistant = null;
        thinkingStartedAt = undefined;
      }
      continue;
    }

    if (event.type === 'assistant/chunk') {
      const key = stepKey(event);
      const chunk = data?.chunk as { type?: string; text?: string; block?: unknown } | undefined;
      const skipText = Boolean(key && skipChunks.has(key));
      if (skipText && chunk?.type !== 'reasoning-delta') continue;
      if (!assistant) assistant = newAssistant(event);
      assistant.latestEventSeq = event.seq;
      if (chunk?.type === 'text-delta') {
        const text = chunkText(asRecord(chunk));
        if (text && !skipText) assistant.content += text;
      }
      if (chunk?.type === 'reasoning-delta') {
        const text = chunkText(asRecord(chunk));
        if (text) {
          if (thinkingStartedAt == null) thinkingStartedAt = event.time;
          assistant.thinkingStartedAt = thinkingStartedAt;
          assistant.thinking = (assistant.thinking ?? '') + text;
        }
      }
      continue;
    }

    if (event.type === 'tool/call') {
      if (!assistant) assistant = newAssistant(event);
      assistant.latestEventSeq = event.seq;
      const node: ToolNode = {
        type: 'bash',
        title: toolName(data),
        status: 'running',
        callId: callIdOf(data),
        eventSeq: event.seq,
        detail: toolDetail(data),
      };
      assistant.toolNodes = [...(assistant.toolNodes ?? []), node];
      continue;
    }

    if (event.type === 'tool/result') {
      if (!assistant) continue;
      const nodes = assistant.toolNodes;
      if (!nodes?.length) continue;
      assistant.latestEventSeq = event.seq;
      const id = callIdOf(data);
      let marked = false;
      assistant.toolNodes = nodes.map((node) => {
        const output = toolOutput(data);
        if (id && node.callId === id) return { ...node, status: 'done' as const, output: output || node.output };
        if (!id && !marked && node.status === 'running') {
          marked = true;
          return { ...node, status: 'done' as const, output: output || node.output };
        }
        return node;
      });
      continue;
    }

    if (event.type === 'turn/end') {
      if (assistant && keepAssistant(assistant)) {
        stampThinkingMs(assistant, thinkingStartedAt, event.time);
        out.push(assistant);
      }
      assistant = null;
      thinkingStartedAt = undefined;
    }
  }

  if (assistant && keepAssistant(assistant)) {
    stampThinkingMs(assistant, thinkingStartedAt, events[events.length - 1]?.time);
    out.push(assistant);
  }
  return out;
}

export function ledgerSummary(event: SessionEvent): string | null {
  if (event.type === 'assistant/chunk') return null;
  const data = event.data;
  if (event.type === 'user/message') {
    const text = textFromBlocks(data?.content);
    if (isCompactCheckpoint(data, text)) return 'compacted-summary';
    if (isNoiseUserText(text)) return null;
    if (text) return text.slice(0, 120);
    if (imageCountFromBlocks(data?.content) > 0) return 'image';
    return null;
  }
  if (event.type.startsWith('compaction/')) return event.type;
  if (event.type === 'assistant/message') {
    const message = data?.message as { content?: unknown } | undefined;
    const text = textFromBlocks(message?.content ?? data?.content);
    return text ? text.slice(0, 120) : 'assistant/message';
  }
  if (event.type === 'tool/call') return toolName(data);
  if (event.type === 'tool/result') return toolName(data);
  return event.type;
}

export function toLedgerEvent(event: SessionEvent): { seq: number; type: string; time: number; summary: string } | null {
  const summary = ledgerSummary(event);
  if (!summary) return null;
  const compact =
    event.type === 'user/message' && isCompactCheckpoint(event.data, textFromBlocks(event.data?.content));
  return {
    seq: event.seq,
    type: compact ? 'compaction/checkpoint' : event.type,
    time: event.time,
    summary,
  };
}
export type LiveStep =
  | { kind: 'thinking'; startedAt: number }
  | { kind: 'tool'; name: string; callId?: string; startedAt: number };

export function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const minutes = Math.floor(sec / 60);
  const rem = sec % 60;
  if (minutes < 60) return rem ? `${minutes}m${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  return restMin ? `${hours}h${restMin}m` : `${hours}h`;
}

export function liveStepLabel(step: LiveStep | null, lang: 'zh' | 'en', now = Date.now()): string | null {
  if (!step) return null;
  const clock = formatElapsed(now - step.startedAt);
  if (step.kind === 'thinking') return lang === 'zh' ? `思考中 · ${clock}` : `Thinking · ${clock}`;
  return lang === 'zh' ? `${step.name} · 运行中 · ${clock}` : `${step.name} · running · ${clock}`;
}

export function applyLiveStep(prev: LiveStep | null, event: SessionEvent): LiveStep | null {
  const now = Date.now();
  if (event.type === 'assistant/chunk') {
    const chunk = event.data?.chunk as { type?: string } | undefined;
    if (chunk?.type === 'reasoning-delta' || chunk?.type === 'block-start') {
      if (prev?.kind === 'tool') return prev;
      if (prev?.kind === 'thinking') return prev;
      return { kind: 'thinking', startedAt: now };
    }
    if (chunk?.type === 'text-delta') {
      if (prev?.kind === 'tool') return prev;
      return null;
    }
    return prev;
  }
  if (event.type === 'tool/call') {
    return { kind: 'tool', name: toolName(event.data), callId: callIdOf(event.data), startedAt: now };
  }
  if (event.type === 'tool/result') {
    const id = callIdOf(event.data);
    if (prev?.kind === 'tool' && id && prev.callId && prev.callId !== id) return prev;
    return null;
  }
  if (event.type === 'turn/end' || event.type === 'assistant/message') return null;
  return prev;
}

export function mergeLive(prev: ChatMessage[], event: SessionEvent): ChatMessage[] {
  if (event.type === 'user/message') {
    const [msg] = foldSessionEvents([event]);
    return msg ? [...prev, msg] : prev;
  }
  if (event.type === 'turn/end') return prev;

  const last = prev[prev.length - 1];
  const assistant: ChatMessage =
    last?.role === 'assistant'
      ? { ...last, toolNodes: last.toolNodes ? [...last.toolNodes] : undefined }
      : {
          id: `e-${event.seq}`,
          role: 'assistant',
          latestEventSeq: event.seq,
          content: '',
          timestamp: '',
        };

  if (event.type === 'assistant/chunk') {
    assistant.latestEventSeq = event.seq;
    const chunk = asRecord(event.data?.chunk);
    const text = chunkText(chunk);
    if (chunk?.type === 'text-delta' && text) {
      assistant.content += text;
      stampThinkingMs(assistant, assistant.thinkingStartedAt, event.time);
    }
    if (chunk?.type === 'reasoning-delta' && text) {
      if (assistant.thinkingStartedAt == null) assistant.thinkingStartedAt = event.time;
      assistant.thinking = `${assistant.thinking ?? ''}${text}`;
    }
  } else if (event.type === 'assistant/message') {
    assistant.latestEventSeq = event.seq;
    const message = event.data?.message as { content?: unknown } | undefined;
    applyAssistantBlocks(assistant, message?.content ?? event.data?.content);
    stampThinkingMs(assistant, assistant.thinkingStartedAt, event.time);
  } else if (event.type === 'tool/call') {
    assistant.latestEventSeq = event.seq;
    const node: ToolNode = {
      type: 'bash',
      title: toolName(event.data),
      status: 'running',
      callId: callIdOf(event.data),
      eventSeq: event.seq,
      detail: toolDetail(event.data),
    };
    assistant.toolNodes = [...(assistant.toolNodes ?? []), node];
  } else if (event.type === 'tool/result') {
    const id = callIdOf(event.data);
    if (!assistant.toolNodes?.length) return prev;
    assistant.latestEventSeq = event.seq;
    const output = toolOutput(event.data);
    let marked = false;
    assistant.toolNodes = assistant.toolNodes.map((node) => {
      if (id && node.callId === id) return { ...node, status: 'done' as const, output: output || node.output };
      if (!id && !marked && node.status === 'running') {
        marked = true;
        return { ...node, status: 'done' as const, output: output || node.output };
      }
      return node;
    });
  } else {
    return prev;
  }

  if (last?.role === 'assistant') return [...prev.slice(0, -1), assistant];
  return [...prev, assistant];
}
