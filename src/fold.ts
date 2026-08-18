/**
 * 把 `session.history` 的原始事件折叠成会话消息。
 *
 * 迁移链路上的第一步：取材、摘要、注入全都建立在折叠结果上，折叠漏一种事件
 * 就等于摘要少一段事实，而且不会报错。所以这份折叠器是产品代码（`src/`）而不是
 * 评测脚本的附属物，并有独立测试覆盖。
 *
 * 只保留迁移需要的部分：用户消息、助手结论、工具痕迹、compaction 检查点。
 * 实时渲染相关的增量合并（mergeLive / liveStep / ledger）属于 GUI，不在此处。
 */
import type { ChatMessage, SessionEvent, ToolNode } from './types.ts';

/** 上游 compaction 检查点的消息 provenance 标记（后端无关）。 */
const COMPACT_CHECKPOINT_PLUGIN = 'compact';
/** 上游 `frameSummary` 包裹摘要用的标签。 */
const SUMMARY_OPEN_TAG = '<compacted-summary>';
const SUMMARY_CLOSE_TAG = '</compacted-summary>';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

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
  // 线性扫描替代懒惰量词正则（CodeQL js/polynomial-redos）：
  // /<think>([\s\S]*?)<\/think>/ 在大量未闭合 <think> 的输入上会回溯成多项式时间。
  const parts: string[] = [];
  const visibleParts: string[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  while (cursor <= text.length) {
    const open = lower.indexOf('<think>', cursor);
    if (open === -1) {
      visibleParts.push(text.slice(cursor));
      break;
    }
    visibleParts.push(text.slice(cursor, open));
    const close = lower.indexOf('</think>', open + 7);
    if (close === -1) {
      // 未闭合的标签按原文保留（与原正则不匹配时的行为一致）
      visibleParts.push(text.slice(open));
      break;
    }
    const trimmed = text.slice(open + 7, close).trim();
    if (trimmed) parts.push(trimmed);
    cursor = close + 8;
  }
  return { text: visibleParts.join('').trim(), thinking: parts.join('\n\n') };
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

function formatTime(ms: number | undefined): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** host 注入的运行时上下文块：对交接摘要没有价值，且体量不小。 */
function isNoiseUserText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith('<system-reminder>') || trimmed.startsWith('<system-notification>')) return true;
  if (/^<\/?runtime-context\b/i.test(trimmed) || /<\/runtime-context>/i.test(trimmed)) return true;
  if (/^Current runtime context\b/i.test(trimmed)) return true;
  if (trimmed.includes('supersedes earlier runtime-context')) return true;
  if (/^Current DSH file policy:/im.test(trimmed) && /Approval policy:/i.test(trimmed)) return true;
  return false;
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

/** 工具调用的入参摘要：命令 / 路径 / 查询串，取第一个有值的。 */
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

/** 工具输出（折叠保留，取材不使用）。 */
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

/**
 * 是否是 compaction 检查点消息。
 *
 * 上游把这个判据专门导出成 `isCompactCheckpointSource`
 * （`@deepseek-ai/dsh-compaction/checkpoint`，一个不依赖 cordis 的纯谓词出口，
 * 就是给客户端/wire 程序用的）。这里保持同一语义：认 provenance 标记，
 * 文本标签只作为兜底。
 */
export function isCompactCheckpoint(data: Record<string, unknown> | undefined, text = ''): boolean {
  const source = asRecord(data?.source);
  if (source?.kind === 'plugin' && source.plugin === COMPACT_CHECKPOINT_PLUGIN) return true;
  return text.includes(SUMMARY_OPEN_TAG);
}

/**
 * 取出检查点里真正的摘要正文。
 *
 * 上游 `frameSummary()` 拼出的形状是
 * `CHECKPOINT_PREAMBLE + "\n\n<compacted-summary>" + 摘要 + "</compacted-summary>"`，
 * 而 preamble 是一句面向模型的指令（"把它当既有背景，别提这个 checkpoint，
 * 直接继续"）。只去标签会把这句指令一起喂给压缩工人，所以这里连 preamble 一起剥掉；
 * 找不到标签时退回原文。
 */
export function stripCompactTags(text: string): string {
  const open = text.indexOf(SUMMARY_OPEN_TAG);
  const close = text.lastIndexOf(SUMMARY_CLOSE_TAG);
  if (open >= 0) {
    const start = open + SUMMARY_OPEN_TAG.length;
    const end = close > start ? close : text.length;
    return text.slice(start, end).trim();
  }
  return text.replace(/<\/?compacted-summary>/g, '').trim();
}

/** `turn:step`，两者都在 payload 上时才有值。 */
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
  const call = asRecord(data.call);
  if (typeof call?.name === 'string' && call.name) return call.name;
  return 'tool';
}

function callIdOf(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  if (typeof data.callId === 'string' && data.callId) return data.callId;
  const message = asRecord(data.message);
  if (typeof message?.callId === 'string' && message.callId) return message.callId;
  return undefined;
}

/** 已被 `assistant/message` 终结的 step：其 text chunk 不再重复累加。 */
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
    id: `e-${event.seq ?? 0}`,
    role: 'assistant',
    latestEventSeq: event.seq ?? 0,
    content: '',
    timestamp: formatTime(event.time),
  };
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

/** 把一页 history（或实时 mux 事件）折叠成会话消息，按时间正序。 */
export function foldSessionEvents(events: SessionEvent[]): ChatMessage[] {
  const skipChunks = finalizedSteps(events);
  const out: ChatMessage[] = [];
  let assistant: ChatMessage | null = null;
  let thinkingStartedAt: number | undefined;

  const flush = (endedAt: number | undefined): void => {
    if (assistant && keepAssistant(assistant)) {
      stampThinkingMs(assistant, thinkingStartedAt, endedAt);
      out.push(assistant);
    }
    assistant = null;
    thinkingStartedAt = undefined;
  };

  for (const event of events) {
    const data = event.data;

    if (event.type === 'user/message') {
      flush(event.time);
      const text = textFromBlocks(data?.content);
      const imageCount = imageCountFromBlocks(data?.content);
      if (isCompactCheckpoint(data, text)) {
        out.push({
          id: `e-${event.seq ?? 0}`,
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
        id: `e-${event.seq ?? 0}`,
        role: 'user',
        content: text,
        imageCount,
        timestamp: formatTime(event.time),
      });
      continue;
    }

    if (event.type === 'assistant/message') {
      if (!assistant) assistant = newAssistant(event);
      assistant.latestEventSeq = event.seq ?? assistant.latestEventSeq;
      const message = asRecord(data?.message);
      applyAssistantBlocks(assistant, message?.content ?? data?.content);
      stampThinkingMs(assistant, thinkingStartedAt, event.time);
      if (assistant.content) flush(event.time);
      continue;
    }

    if (event.type === 'assistant/chunk') {
      const key = stepKey(event);
      const chunk = asRecord(data?.chunk);
      const skipText = Boolean(key && skipChunks.has(key));
      if (skipText && chunk?.type !== 'reasoning-delta') continue;
      if (!assistant) assistant = newAssistant(event);
      assistant.latestEventSeq = event.seq ?? assistant.latestEventSeq;
      const text = typeof chunk?.text === 'string' ? chunk.text
        : typeof chunk?.delta === 'string' ? chunk.delta
          : blockBody(asRecord(chunk?.block) ?? {});
      if (chunk?.type === 'text-delta' && text && !skipText) assistant.content += text;
      if (chunk?.type === 'reasoning-delta' && text) {
        if (thinkingStartedAt == null) thinkingStartedAt = event.time;
        assistant.thinkingStartedAt = thinkingStartedAt;
        assistant.thinking = (assistant.thinking ?? '') + text;
      }
      continue;
    }

    if (event.type === 'tool/call') {
      if (!assistant) assistant = newAssistant(event);
      assistant.latestEventSeq = event.seq ?? assistant.latestEventSeq;
      const node: ToolNode = {
        type: 'bash',
        title: toolName(data),
        status: 'running',
        callId: callIdOf(data),
        eventSeq: event.seq ?? 0,
        detail: toolDetail(data),
      };
      assistant.toolNodes = [...(assistant.toolNodes ?? []), node];
      continue;
    }

    if (event.type === 'tool/result') {
      if (!assistant?.toolNodes?.length) continue;
      assistant.latestEventSeq = event.seq ?? assistant.latestEventSeq;
      const id = callIdOf(data);
      const output = toolOutput(data);
      let marked = false;
      assistant.toolNodes = assistant.toolNodes.map((node) => {
        if (id && node.callId === id) return { ...node, status: 'done' as const, output: output || node.output };
        if (!id && !marked && node.status === 'running') {
          marked = true;
          return { ...node, status: 'done' as const, output: output || node.output };
        }
        return node;
      });
      continue;
    }

    if (event.type === 'turn/end') flush(event.time);
  }

  flush(events[events.length - 1]?.time);
  return out;
}
