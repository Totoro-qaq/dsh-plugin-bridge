/**
 * Bridge 跨模式迁移：从折叠后的会话消息取材，构建交接摘要的压缩输入。
 * 纯函数，无 RPC 依赖，便于测试。设计原则见 docs/plan.md：
 * 迁状态不迁痕迹；用户意图优先；工具只留名字与路径；总字符有硬预算。
 */
import type { ChatMessage } from './types.ts';
/** 摘要正文的硬预算（字符）。默认 2400 字符 ≈ 900 tokens。 */
export declare const SUMMARY_CHAR_BUDGET = 2400;
/** 压缩输入（喂给工人模型的取材）总字符预算，≈30K tokens 内。 */
export declare const SOURCE_CHAR_BUDGET = 60000;
export interface BridgeSource {
    /** 拼接好的压缩输入文本。 */
    text: string;
    /** 实际纳入的用户消息条数。 */
    userMessagesUsed: number;
    /** 会话里的用户消息总条数。 */
    userMessagesTotal: number;
    /** 是否命中并复用了最近一次 compaction 摘要。 */
    reusedCompaction: boolean;
    /** 取材是否因预算被截断。 */
    truncated: boolean;
    /**
     * 因预算被丢弃或裁剪的分区名（`compaction` / `users` / `recent`）。
     * 调用方（GUI 预览弹窗、CLI）应当把它显示出来：静默丢弃是上一版最大的问题。
     */
    dropped: string[];
}
export interface BridgeSourceOptions {
    /** 覆盖取材总字符预算（默认 SOURCE_CHAR_BUDGET）。 */
    sourceCharBudget?: number;
}
/** 从折叠消息构建压缩输入。messages 按时间正序。 */
export declare function buildBridgeSource(messages: ChatMessage[], options?: BridgeSourceOptions): BridgeSource;
export interface BridgeInstructionOptions {
    /** 摘要正文字符预算，默认 SUMMARY_CHAR_BUDGET。 */
    summaryCharBudget?: number;
}
/** 摘要预算（字符）换算成写进指令的 token 上限。 */
export declare function summaryTokenBudget(summaryCharBudget?: number): number;
/** 压缩指令：让工人模型输出固定 schema 的交接摘要。 */
export declare function buildBridgeInstruction(lang: 'zh' | 'en', options?: BridgeInstructionOptions): string;
/** 注入新会话首轮的交接指令（goal 之后的第一条 prompt）。 */
export declare function buildBridgeKickoff(lang: 'zh' | 'en', autoContinue?: boolean): string;
/** 成本预估（粗）：按取材字符数估输入 tokens，中英混合按 ~2 字符/token。 */
export declare function estimateSummaryTokens(sourceChars: number, options?: BridgeInstructionOptions): {
    input: number;
    output: number;
};
/**
 * 取材语言判定：CJK 字符占比超过 15% 视为中文。
 * 用于 `--lang auto`：摘要语言应该跟着会话内容走，而不是跟着部署默认走。
 */
export declare function detectLang(text: string): 'zh' | 'en';
