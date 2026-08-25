import { type InjectMode, type Lang, type ModelTier } from './migrate.ts';
import { type BridgeHost, type BridgeHostProbe } from './host.ts';
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
    /** 按本次调用的取消信号取得宿主端口。新 adapter 应实现这个入口。 */
    hostFor?: (signal?: AbortSignal) => BridgeHost;
    /** @deprecated 0.2.x 兼容入口；会自动包装成 BridgeHost。 */
    rpcFor?: (signal?: AbortSignal) => Rpc;
    /** 自检：这套 host adapter 是否提供 Bridge 所需的能力。 */
    probe?: () => BridgeHostProbe[];
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
    summary64?: string;
    previewId?: string;
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
    recordInput: false;
    handler: (invocation: BridgeInvocation) => Promise<BridgeResult>;
};
export {};
