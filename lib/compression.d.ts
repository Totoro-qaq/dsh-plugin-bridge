/**
 * Bridge 跨模式迁移：从折叠后的会话消息取材，构建交接摘要的压缩输入。
 * 纯函数，无 RPC 依赖，便于测试。设计原则见 docs/plan.md：
 * 迁状态不迁痕迹；用户消息全文保留；工具只留名字与路径；总字符有硬预算。
 */
import type { ChatMessage } from './types.js';
/** 摘要正文的硬预算（token 量级 ≈ 1K 内，按字符宽估）。 */
export declare const SUMMARY_CHAR_BUDGET = 2400;
/** 压缩输入（喂给工人模型的取材）总字符预算，≈30K tokens 内。 */
export declare const SOURCE_CHAR_BUDGET = 60000;
export interface BridgeSource {
    /** 拼接好的压缩输入文本。 */
    text: string;
    /** 实际纳入的用户消息条数 / 总条数。 */
    userMessagesUsed: number;
    userMessagesTotal: number;
    /** 是否命中并复用了最近一次 compaction 摘要。 */
    reusedCompaction: boolean;
    /** 取材是否因预算被截断。 */
    truncated: boolean;
}
export interface BridgeSourceOptions {
    /** 覆盖取材总字符预算（默认 SOURCE_CHAR_BUDGET，经过 26 组实验验证）。 */
    sourceCharBudget?: number;
}
/** 从折叠消息构建压缩输入。messages 按时间正序。 */
export declare function buildBridgeSource(messages: ChatMessage[], options?: BridgeSourceOptions): BridgeSource;
/** 压缩指令：让工人模型输出固定 schema 的交接摘要。 */
export declare function buildBridgeInstruction(lang: 'zh' | 'en'): string;
/** 注入新会话首轮的交接指令（goal 之后的第一条 prompt）。 */
export declare function buildBridgeKickoff(lang: 'zh' | 'en'): string;
/** 成本预估（粗）：按取材字符数估输入 tokens，中英混合按 ~2 字符/token。 */
export declare function estimateSummaryTokens(sourceChars: number): {
    input: number;
    output: number;
};
