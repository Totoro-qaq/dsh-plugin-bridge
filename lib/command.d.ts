/**
 * `/bridge` —— 人发起的跨 preset 迁移命令。
 *
 * 这是本插件的主入口，形状对齐上游 `dsh-plan-mode` 的 `/plan`：命令由 UI 直接
 * 派发给注册表，**不经过模型**，命令结果也不进模型历史。于是
 *
 *   - 不需要模型「愿意」加载什么东西，也不需要 bash 或环境变量；
 *   - `minimal` 这种没有 skill 工具的 preset 照样能发起迁移；
 *   - 结果文本只给人看，原会话的上下文一个字都不动。
 *
 * 上游 `session.prompt` 的契约保证了这一点：「A prompt whose content is exactly
 * one text block starting with '/' is a slash command: the host executes it
 * through the command registry (mode-agnostic) and it is never sent to the
 * model.」——所以在官方 WebUI 的输入框里打 `/bridge code` 就能用。
 */
import { type InjectMode, type Lang, type ModelTier } from './migrate.ts';
import type { MethodProbe } from './api-rpc.ts';
import { type Rpc } from './rpc.ts';
/** 命令处理器从注册表拿到的东西（结构化声明，不 import 上游类型）。 */
export interface BridgeInvocation {
    agent?: {
        session?: {
            id?: string;
            header?: {
                id?: string;
            };
        };
    };
    rawInput?: string;
    /**
     * rc.8 起注册表会传这个字段（随命令提交的图片块）。`/bridge` 没有声明
     * `input.images`，所以带图片的调用会在进入这里之前就被注册表挡下来；
     * 声明出来只是为了让类型如实反映上游传了什么。
     */
    attachments?: readonly unknown[];
    signal?: AbortSignal;
}
export type BridgeResult = {
    kind: 'success';
    text?: string;
} | {
    kind: 'error';
    text: string;
};
export interface BridgeCommandConfig {
    modelTier: ModelTier;
    sourceCharBudget: number;
    summaryCharBudget: number;
    goalRounds: number;
    inject: InjectMode;
    lang: Lang;
    workerProvider?: string;
    workerModel?: string;
    /** 命令路径下等压缩工人的上限。命令是同步返回的，不能等太久。 */
    previewTimeoutMs: number;
}
export interface BridgeCommandDeps {
    /** 按本次调用的取消信号建一个 Rpc。 */
    rpcFor: (signal?: AbortSignal) => Rpc;
    /** 自检：这套 host 的网关面还是不是插件预期的形状。 */
    probe?: () => MethodProbe[];
    config: BridgeCommandConfig;
    /** 摘要落盘，返回路径；给「改完再执行」这条路用。失败返回 undefined。 */
    writeSummary?: (sessionId: string, summary: string) => string | undefined;
    readSummary?: (path: string) => string;
    now?: () => number;
}
interface ParsedInput {
    preset?: string;
    go: boolean;
    doctor: boolean;
    autoContinue: boolean;
    tier?: ModelTier;
    lang?: Lang;
    inject?: InjectMode;
    goalRounds?: number;
    file?: string;
    help: boolean;
    error?: string;
}
/** `<preset> [--go] [--continue] [--tier x] [--lang l] [--inject m] [--goal-rounds n] [--file p]` */
export declare function parseBridgeInput(rawInput: string): ParsedInput;
/** 建一个 `/bridge` 命令定义。返回值形状对齐上游 `CommandDefinition`。 */
export declare function createBridgeCommand(deps: BridgeCommandDeps): {
    name: string;
    description: string;
    input: {
        hint: string;
    };
    handler: (invocation: BridgeInvocation) => Promise<BridgeResult>;
};
export {};
