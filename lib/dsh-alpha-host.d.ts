import { type ApiProxyLike } from './api-rpc.ts';
import { type BridgeHost, type BridgeHostProbe } from './host.ts';
import type { SessionEvent } from './types.ts';
type UnknownRecord = Record<string, unknown>;
/** `0.2.2-alpha.2` 的 `events` / 废弃 `page` 请求。只读普通会话，不激活 Agent。 */
interface AlphaEventPageRequest {
    address: {
        kind: 'session';
        sessionId: string;
    };
    beforeSeq?: number;
    maxMessages?: number;
}
/** 宿主已经按消息窗口切好的一页。`records` 是 `{ event }` 信封。 */
interface AlphaEventPage {
    records?: readonly {
        event?: SessionEvent;
    }[];
    hasMore?: boolean;
}
interface AlphaSessionController {
    list(request: {
        cursor?: string;
    }, signal: AbortSignal): Promise<{
        items?: unknown[];
    }>;
    create(request: UnknownRecord): Promise<UnknownRecord>;
    /** 0.2.1 及更早的 typed controller 一次返回整段快照。0.2.2-alpha.2 已删除。 */
    inspect?(sessionId: string, signal?: AbortSignal): Promise<{
        meta: UnknownRecord;
        events: SessionEvent[];
    }>;
    /** 0.2.2-alpha.2 的冷历史页。没有 `inspect` 时使用。 */
    events?(request: AlphaEventPageRequest, signal: AbortSignal): Promise<AlphaEventPage>;
    /** `events` 的废弃别名，签名相同，只在 `events` 也不存在时使用。 */
    page?(request: AlphaEventPageRequest, signal: AbortSignal): Promise<AlphaEventPage>;
    modelCatalog(): Promise<UnknownRecord>;
    selectModel(request: UnknownRecord): Promise<unknown>;
    prompt(request: UnknownRecord, signal: AbortSignal): Promise<unknown>;
    cancel(request: {
        sessionId: string;
    }): unknown;
    rename(request: UnknownRecord): Promise<unknown>;
    attachment?(request: UnknownRecord): Promise<unknown>;
    resolveAgent(sessionId: string): Promise<{
        agent?: unknown;
        error?: AlphaFailure;
    }>;
}
interface AlphaFailure {
    code?: string;
    message?: string;
    details?: unknown;
}
interface AlphaServices {
    apiProxy?: ApiProxyLike;
    sessionController?: Partial<AlphaSessionController>;
    workspaceRegistry?: {
        list?: () => unknown[];
    };
    workspaceController?: {
        archiveSession?: (request: {
            sessionId: string;
            stopActivity?: boolean;
        }) => Promise<unknown>;
    };
    agentPresets?: {
        remoteExportList?: () => Promise<{
            presets?: unknown[];
        }>;
    };
    goals?: {
        remoteExportCreate?: (agent: unknown, request: UnknownRecord) => unknown;
        pause?: (agent: unknown, ref: UnknownRecord) => unknown;
        clear?: (agent: unknown, ref: UnknownRecord) => unknown;
    };
}
type ContextLike = AlphaServices & {
    get?: (name: string) => unknown;
};
/** Probe the real alpha services instead of the adapter's always-present closures. */
export declare function probeDshAlphaHost(input: ContextLike): BridgeHostProbe[];
/** Create the semantic BridgeHost over DSH typed Host controllers. */
export declare function createDshAlphaHost(input: ContextLike, signal?: AbortSignal): BridgeHost;
/** Prefer the stable rc.2 path when present; otherwise use alpha controllers. */
export declare function resolveDshHost(input: ContextLike, signal?: AbortSignal): BridgeHost;
/** Probe the active generation using its native surface. */
export declare function probeDshHost(input: ContextLike): BridgeHostProbe[];
export {};
