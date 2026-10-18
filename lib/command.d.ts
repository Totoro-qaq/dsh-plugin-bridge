import { type SummaryClaim, type SummaryClaimDenied } from './summary-file.ts';
import { type InjectMode, type Lang, type ModelTier } from './migrate.ts';
import { type BridgeHost, type BridgeHostProbe } from './host.ts';
import { type Rpc } from './rpc.ts';
import type { PlanApprovalBridge } from './approved-plan.ts';
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
    /** Only Bridge-owned summary workers, excluded from the optional model entry. */
    workerSessionIds?: Set<string>;
    /** Optional native review observer; ordinary migration does not depend on plan mode. */
    planApprovals?: PlanApprovalBridge;
    /** 按本次调用的取消信号取得宿主端口。新 adapter 应实现这个入口。 */
    hostFor?: (signal?: AbortSignal) => BridgeHost;
    /** @deprecated 0.2.x 兼容入口；会自动包装成 BridgeHost。 */
    rpcFor?: (signal?: AbortSignal) => Rpc;
    /** 自检：这套 host adapter 是否提供 Bridge 所需的能力。 */
    probe?: () => BridgeHostProbe[];
    config: BridgeCommandConfig;
    /** 摘要落盘，返回路径；给「改完再执行」这条路用。失败应抛出，命令会写成警告而不是假装没有文件。 */
    writeSummary?: (sessionId: string, summary: string) => string | undefined;
    readSummary?: (path: string) => string;
    /** 删掉本命令创建的临时摘要。只在预览被用掉、过期或被挤掉时调用。 */
    removeSummary?: (path: string) => void;
    /**
     * 迁移开始前认领摘要文件。缺省在系统临时目录里留一条记录，
     * 另一个进程或另一条命令实例由此看到正在交接、已经送达或没有送达。
     */
    claimSummary?: (file: string) => SummaryClaim | SummaryClaimDenied;
    /** 没有原生卡片的客户端靠它看到阶段进度。失败不能影响迁移。 */
    onProgress?: (message: string) => void;
    /** 长预览的进度间隔（毫秒）。默认 15 秒；测试可调小。0 表示不发心跳。 */
    progressHeartbeatMs?: number;
    now?: () => number;
    /** 轮询压缩工人的间隔（毫秒），默认 750；测试里调小。 */
    pollMs?: number;
}
interface ParsedInput {
    approvePlan64?: string;
    approvedPlanId?: string;
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
    error?: BridgeParseError;
}
/** 参数错误用稳定代码保存，真正给用户看的句子在命令语言里现拼。 */
export type BridgeParseError = {
    code: 'extra-argument';
    token: string;
} | {
    code: 'approve-plan64-missing';
} | {
    code: 'approved-plan-invalid';
} | {
    code: 'tier';
} | {
    code: 'lang';
} | {
    code: 'inject';
} | {
    code: 'goal-rounds';
} | {
    code: 'file-missing';
} | {
    code: 'summary64-missing';
} | {
    code: 'preview-id';
} | {
    code: 'unknown-option';
    key: string;
};
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
