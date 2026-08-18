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
import type { ChatMessage, SessionEvent } from './types.ts';
/** 工具调用的入参摘要：命令 / 路径 / 查询串，取第一个有值的。 */
export declare function toolDetail(data: Record<string, unknown> | undefined): string;
/** 工具输出（折叠保留，取材不使用）。 */
export declare function toolOutput(data: Record<string, unknown> | undefined): string;
/**
 * 是否是 compaction 检查点消息。
 *
 * 上游把这个判据专门导出成 `isCompactCheckpointSource`
 * （`@deepseek-ai/dsh-compaction/checkpoint`，一个不依赖 cordis 的纯谓词出口，
 * 就是给客户端/wire 程序用的）。这里保持同一语义：认 provenance 标记，
 * 文本标签只作为兜底。
 */
export declare function isCompactCheckpoint(data: Record<string, unknown> | undefined, text?: string): boolean;
/**
 * 取出检查点里真正的摘要正文。
 *
 * 上游 `frameSummary()` 拼出的形状是
 * `CHECKPOINT_PREAMBLE + "\n\n<compacted-summary>" + 摘要 + "</compacted-summary>"`，
 * 而 preamble 是一句面向模型的指令（"把它当既有背景，别提这个 checkpoint，
 * 直接继续"）。只去标签会把这句指令一起喂给压缩工人，所以这里连 preamble 一起剥掉；
 * 找不到标签时退回原文。
 */
export declare function stripCompactTags(text: string): string;
/** `turn:step`，两者都在 payload 上时才有值。 */
export declare function stepKey(event: SessionEvent): string | null;
export declare function toolName(data: Record<string, unknown> | undefined): string;
/** 把一页 history（或实时 mux 事件）折叠成会话消息，按时间正序。 */
export declare function foldSessionEvents(events: SessionEvent[]): ChatMessage[];
