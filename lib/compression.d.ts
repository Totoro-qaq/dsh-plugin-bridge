/**
 * Bridge 跨模式迁移：从折叠后的会话消息取材，构建交接摘要的压缩输入。
 * 纯函数，无 RPC 依赖，便于测试。设计原则见 docs/plan.md：
 * 迁状态不迁痕迹；用户意图优先；工具只留名字与路径；总字符有硬预算。
 */
import type { ChatMessage, ImageAttachmentRef } from './types.ts';
/** 摘要正文的硬预算（字符）。默认 2400 字符 ≈ 900 tokens。 */
export declare const SUMMARY_CHAR_BUDGET = 2400;
/** 压缩输入（喂给工人模型的取材）总字符预算，≈30K tokens 内。 */
export declare const SOURCE_CHAR_BUDGET = 60000;
/** 逐字视觉证据独立于摘要预算；只按完整块收录，绝不从中间截断。 */
export declare const VISUAL_EVIDENCE_CHAR_BUDGET = 60000;
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
    /** 图片与同轮助手文本的逐字证据；不会交给摘要模型改写。 */
    visualEvidence: VisualEvidence;
}
export interface VisualEvidenceItem {
    /** 该图片消息在全部用户消息里的 1-based 序号。 */
    userMessage: number;
    imageCount: number;
    /** 原用户文字，逐字保留；图片-only 消息为空。 */
    userText: string;
    /** 下一条用户消息出现前的助手正文，逐字保留；为空表示尚未解析。 */
    assistantText: string;
    /** rc.8 能恢复出的持久化图片引用；旧 host 可能为空。 */
    attachments: ImageAttachmentRef[];
}
export interface VisualEvidence {
    imageMessages: number;
    images: number;
    represented: number;
    unresolved: number;
    /** 完整纳入最终交接的图片消息证据。 */
    included: VisualEvidenceItem[];
    /** 因证据预算未纳入的完整块数；从不截断块内文本。 */
    omitted: number;
    truncated: boolean;
}
export interface BridgeSourceOptions {
    /** 覆盖取材总字符预算（默认 SOURCE_CHAR_BUDGET）。 */
    sourceCharBudget?: number;
    /** 逐字视觉证据字符预算；完整块原子收录，默认 60K。 */
    visualEvidenceCharBudget?: number;
}
/**
 * 把“含图用户消息”与它到下一条用户消息之间的助手正文配对。
 *
 * Bridge 不声称这些正文一定是图片描述，只称为“关联助手响应”；这样即使助手
 * 只是追问，也不会被误标成已经识图。文本由程序直接复制，不经过摘要模型。
 */
export declare function collectVisualEvidence(messages: ChatMessage[], charBudget?: number): VisualEvidence;
/** 把逐字视觉证据作为独立附录拼到模型摘要后；正文不会被二次改写。 */
export declare function appendVisualEvidence(summary: string, evidence: VisualEvidence, lang: 'zh' | 'en'): string;
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
