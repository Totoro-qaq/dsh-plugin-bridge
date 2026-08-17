/** 消息与事件的最小结构契约（与参考客户端同形，便于双向同步）。 */
export interface ToolNode {
    title: string;
    detail?: string;
}
export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    kind?: string;
    toolNodes?: ToolNode[];
}
/** eval 侧折叠所需的最小事件形状（宽松，运行时再判 type）。 */
export type SessionEvent = Record<string, unknown>;
