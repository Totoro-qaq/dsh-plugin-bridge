/**
 * 迁移编排：取材 → 压缩工人 → 目标会话。
 *
 * 只依赖注入进来的 `Rpc`，不碰 process / argv / 文件系统，所以可以对着一个
 * 假的 RPC（见 test/migrate.test.mjs）跑完整条链路而不烧任何 token。
 * CLI（`cli.ts`）与客户端 GUI 都消费这里的函数，保证「被验证的」和
 * 「被交付的」是同一条代码路径。
 */
import { type BridgeSource } from './compression.ts';
import { type Rpc } from './rpc.ts';
import type { ChatMessage } from './types.ts';
export type ModelTier = 'flash' | 'current' | 'pro';
export type InjectMode = 'goal' | 'prompt' | 'both';
export type Lang = 'zh' | 'en' | 'auto';
export interface SessionRow {
    sessionId: string;
    running?: boolean;
    blank?: boolean;
    cwd?: string;
    agentPreset?: string;
    parentSessionId?: string;
    projections?: {
        values?: Record<string, unknown>;
    };
}
export interface PresetRow {
    id: string;
    trust?: 'system' | 'user';
    isDefault?: boolean;
    name?: string;
    description?: string;
    broken?: string;
}
export interface ModelRoute {
    provider: string;
    model: string;
    /** 为什么选中它：configured / follow-session / tier:<tier> / fallback-current。 */
    reason: string;
}
/**
 * 列出全部会话。
 *
 * `session.list` 的 v1 一次返回全部，`cursor` 是预留位；这里仍按 cursor 取完，
 * 免得上游哪天真的分页之后这里悄悄只看第一页。
 */
export declare function listSessions(rpc: Rpc): Promise<SessionRow[]>;
export declare function findSession(rpc: Rpc, sessionId: string): Promise<SessionRow | undefined>;
/** 找出会话所属工作区；找不到就返回 undefined（调用方退回用 cwd 建会话）。 */
export declare function findWorkspaceId(rpc: Rpc, sessionId: string): Promise<string | undefined>;
/** 可作为迁移目标的 preset（去掉 broken 的）。 */
export declare function listPresets(rpc: Rpc): Promise<PresetRow[]>;
/**
 * 选压缩工人的模型。
 *
 * 不写死任何 provider/model：先读源会话的模型目录，再按档位在**同一 provider**
 * 里挑。挑不到就退回源会话当前模型——档位是省钱偏好，不该成为换 provider 的人
 * 装不上的理由。
 */
export declare function resolveWorkerModel(rpc: Rpc, sessionId: string, tier: ModelTier, override?: {
    provider?: string;
    model?: string;
}): Promise<ModelRoute>;
/** 压缩工人用哪个 preset：优先 minimal，其次 standard，再否则 host 默认。 */
export declare function resolveWorkerPreset(rpc: Rpc): Promise<string | undefined>;
export interface WaitOptions {
    timeoutMs?: number;
    /** 等「开始跑」的宽限期；超过还没 running 就当它已经跑完了。 */
    startGraceMs?: number;
    pollMs?: number;
}
/**
 * 等一个会话回到空闲。
 *
 * 旧实现是「先 sleep 2s，再看 running 是不是 false」——host 排队稍慢一点，
 * 第一次轮询就会把「还没开始」误判成「已经跑完」，取到的是上一轮的回答。
 * 这里先等它真的 running 起来（有宽限期），再等它落回 false。
 */
export declare function waitIdle(rpc: Rpc, sessionId: string, options?: WaitOptions): Promise<{
    idle: boolean;
    started: boolean;
}>;
/** 拉取并折叠会话历史（按需翻页）。 */
export declare function foldedHistory(rpc: Rpc, sessionId: string, options?: {
    pageMessages?: number;
    maxPages?: number;
}): Promise<ChatMessage[]>;
/** 会话里最后一条非空 assistant 文本。 */
export declare function lastAssistantText(rpc: Rpc, sessionId: string): Promise<string>;
export interface PreviewOptions {
    sessionId: string;
    tier?: ModelTier;
    provider?: string;
    model?: string;
    sourceCharBudget?: number;
    summaryCharBudget?: number;
    lang?: Lang;
    workerTimeoutMs?: number;
    /** 轮询空闲的间隔，测试里调小。 */
    pollMs?: number;
    /** 只取材、不真的调模型（自检用）。 */
    dryRun?: boolean;
    onProgress?: (message: string) => void;
}
export interface PreviewResult {
    summary: string;
    source: BridgeSource;
    lang: 'zh' | 'en';
    worker: {
        sessionId?: string;
        provider: string;
        model: string;
        reason: string;
        preset?: string;
    };
    /** 工人会话是否被限速取消（摘要按已产出文本计）。 */
    capped: boolean;
    sourceSession: SessionRow | undefined;
}
/** 生成交接摘要：取材 → 起临时工人 → 收摘要 → 归档工人。 */
export declare function previewMigration(rpc: Rpc, options: PreviewOptions): Promise<PreviewResult>;
export interface MigrateOptions {
    sessionId: string;
    to: string;
    summary: string;
    lang?: 'zh' | 'en';
    /**
     * goal 的自主轮次上限。
     *
     * 上游 `goal.create` 的部署默认是 **256**，而 `dsh-goal-round-driver` 会在
     * agent 空闲时把目标渲染成 `<goal_round>` 提示反复跑。也就是说不显式设这个值，
     * 一次「迁移」就等于给新会话开了最多 256 轮的自主循环。交接只需要一轮。
     */
    goalRounds?: number;
    /** 摘要注入方式，默认 both（挂 goal + 首轮提示里也带全文）。 */
    inject?: InjectMode;
    /** 是否发首轮交接指令。 */
    kickoff?: boolean;
    /** 是否在同一轮复述后继续工作。goal 始终先暂停，避免 round driver 另起一轮。 */
    autoContinue?: boolean;
    /** 给新会话起个能看出来源的标题。 */
    title?: string;
    onProgress?: (message: string) => void;
}
export interface MigrateResult {
    sessionId: string;
    agentPreset: string;
    goalCreated: boolean;
    goalPaused: boolean;
    kickoffSent: boolean;
    titled: boolean;
    warnings: string[];
}
/**
 * 建目标会话并交接。
 *
 * 注入方式说明：`goal.create` 本身**不会**把目标注入模型上下文（上游
 * `dsh-goal` README：「Goal mutations do not inject model context」），
 * 摘要能被模型看见依赖 goal-round-driver 把它渲染成 `<goal_round>` 提示，
 * 或模型主动调 `get_goal`。所以默认把摘要同时放进首轮提示：任何组装下都成立。
 */
export declare function executeMigration(rpc: Rpc, options: MigrateOptions): Promise<MigrateResult>;
/** 默认标题：让新会话在侧栏里一眼看得出来源。 */
export declare function migratedTitle(sourceTitle: string | undefined, to: string): string;
/** 从 session.list 行里尽力取出标题（projection 形状随部署而异）。 */
export declare function titleOf(row: SessionRow | undefined): string | undefined;
