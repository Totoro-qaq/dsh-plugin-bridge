/**
 * 消息与事件的最小结构契约。
 *
 * 这份形状同时被三方消费：`fold.ts`（把 session.history 事件折叠成消息）、
 * `compression.ts`（取材）、以及复用同一语义的客户端（WebUI / 桌面 GUI）。
 * 此前 eval 侧另存了一份同名副本并使用了更宽的字段，导致 `eval/` 无法通过
 * 类型检查；现在只保留这一份，字段以折叠器实际写入的为准。
 */
/** 一次工具调用在折叠结果里的痕迹。 */
export interface ToolNode {
    /** 展示分类，折叠器统一写 'bash'（保留字段以兼容客户端渲染）。 */
    type?: string;
    /** 工具名。 */
    title: string;
    /** 运行状态；`tool/result` 到达后转为 done。 */
    status?: 'running' | 'done';
    /** 与 `tool/result` 配对用的调用 id。 */
    callId?: string;
    /** 产生该节点的事件 seq。 */
    eventSeq?: number;
    /** 调用入参摘要（命令 / 路径 / 查询串），不含 stdout。 */
    detail?: string;
    /** 工具输出（取材阶段一律不使用）。 */
    output?: string;
}
/** 折叠后的一条会话消息。 */
export interface ChatMessage {
    /** 稳定 id，形如 `e-<seq>`。 */
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    /** 'compaction' 表示这是一次上下文压缩检查点。 */
    kind?: string;
    toolNodes?: ToolNode[];
    /** 推理内容（取材阶段一律不使用）。 */
    thinking?: string;
    thinkingMs?: number;
    thinkingStartedAt?: number;
    /** 该消息携带的图片数量。 */
    imageCount?: number;
    /** 该消息已合并的最新事件 seq。 */
    latestEventSeq?: number;
    /** 本地化时刻，仅用于展示。 */
    timestamp?: string;
}
/** session.history 的一条原始事件（宽松，运行时再判 type）。 */
export interface SessionEvent {
    type?: string;
    seq?: number;
    time?: number;
    data?: Record<string, unknown>;
    [key: string]: unknown;
}
