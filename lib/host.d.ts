/**
 * Bridge 的宿主端口。
 *
 * 迁移核心只依赖这些语义能力；DSH HTTP、进程内 apiProxy，以及未来可能出现的
 * dsh-std participant 都应在 adapter 中实现本接口。RPC 方法名与产品对象形状不应
 * 再进入 migrate.ts。
 */
import { RpcError, type Rpc } from './rpc.ts';
import type { ImageAttachmentRef, SessionEvent } from './types.ts';
export interface BridgeHostDescriptor {
    /** adapter 的稳定标识，例如 dsh-api-proxy、dsh-http-api 或 dsh-std。 */
    id: string;
    version?: string;
    transport?: string;
}
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
export interface ModelSelection {
    provider: string;
    model: string;
    reasoningEffort?: string;
}
export interface SessionModels {
    current?: Partial<ModelSelection>;
    groups?: {
        id: string;
        models?: {
            id: string;
        }[];
    }[];
    [key: string]: unknown;
}
export type PromptContent = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    mediaType: ImageAttachmentRef['mediaType'];
    data: string;
    name?: string;
};
export interface BridgeHost {
    readonly descriptor: BridgeHostDescriptor;
    readonly sessions: {
        list(input?: {
            cursor?: string;
        }): Promise<{
            items?: SessionRow[];
            nextCursor?: string;
        }>;
        create(input: {
            workspaceId?: string;
            cwd?: string;
            agentPreset?: string;
        }): Promise<{
            sessionId: string;
            agentPreset?: string;
        }>;
        history(input: {
            sessionId: string;
            maxMessages?: number;
            beforeSeq?: number;
        }, options?: {
            timeoutMs?: number;
        }): Promise<{
            events?: {
                event: SessionEvent;
            }[];
            hasMore?: boolean;
        }>;
        models(input: {
            sessionId: string;
        }): Promise<SessionModels>;
        selectModel(input: {
            sessionId: string;
        } & ModelSelection): Promise<unknown>;
        prompt(input: {
            sessionId: string;
            mode: 'queue';
            content: readonly PromptContent[];
        }): Promise<unknown>;
        cancel(input: {
            sessionId: string;
        }): Promise<unknown>;
        rename(input: {
            sessionId: string;
            title: string;
        }): Promise<unknown>;
        attachment?(input: {
            sessionId: string;
            attachmentId: string;
        }): Promise<{
            attachment?: ImageAttachmentRef;
            data?: string;
        }>;
    };
    readonly workspaces: {
        list(): Promise<{
            items?: {
                workspaceId: string;
                sessionIds?: string[];
            }[];
        }>;
        archiveSession(input: {
            sessionId: string;
        }): Promise<unknown>;
    };
    readonly presets: {
        list(): Promise<{
            presets?: PresetRow[];
        }>;
    };
    readonly goals: {
        create(input: {
            sessionId: string;
            objective: string;
            maxGoalRounds: number;
        }): Promise<{
            ref: {
                id: string;
                revision: number;
            };
        }>;
        pause(input: {
            sessionId: string;
            ref: {
                id: string;
                revision: number;
            };
        }): Promise<unknown>;
        clear?(input: {
            sessionId: string;
            ref: {
                id: string;
                revision: number;
            };
        }): Promise<unknown>;
    };
}
/** 0.2.x 兼容入口：现有调用者仍可传入旧的字符串 Rpc。 */
export type BridgeHostInput = BridgeHost | Rpc;
export declare const REQUIRED_BRIDGE_CAPABILITIES: readonly ["session.list", "session.create", "session.history", "session.models", "session.selectModel", "session.prompt", "session.cancel", "session.rename", "workspace.list", "workspace.archiveSession", "agentPreset.list", "goal.create", "goal.pause"];
export declare const OPTIONAL_BRIDGE_CAPABILITIES: readonly ["session.attachment", "goal.clear"];
export interface BridgeHostProbe {
    method: string;
    available: boolean;
}
/** 只检查端口形状，不执行任何宿主操作。 */
export declare function probeBridgeHost(host: BridgeHost | undefined): BridgeHostProbe[];
/**
 * 把现有 DSH 字符串 RPC 包成语义端口。
 *
 * 这是兼容 adapter，不是迁移核心的一部分；未来的 dsh-std adapter 可以直接实现
 * BridgeHost，而不需要复刻这些 DSH 路由名。
 */
export declare function createBridgeHostFromRpc(rpc: Rpc, descriptor?: BridgeHostDescriptor): BridgeHost;
/** 将兼容输入规范化为 BridgeHost；核心入口统一调用此函数。 */
export declare function asBridgeHost(input: BridgeHostInput): BridgeHost;
/** 对缺失的可选能力给出与 RPC 错误一致的可分类失败。 */
export declare function missingHostCapability(capability: string): RpcError;
