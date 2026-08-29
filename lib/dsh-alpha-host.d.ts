import { type ApiProxyLike } from './api-rpc.ts';
import { type BridgeHost, type BridgeHostProbe } from './host.ts';
import type { SessionEvent } from './types.ts';
type UnknownRecord = Record<string, unknown>;
interface AlphaSessionController {
    list(request: {
        cursor?: string;
    }, signal: AbortSignal): Promise<{
        items?: unknown[];
    }>;
    create(request: UnknownRecord): Promise<UnknownRecord>;
    inspect(sessionId: string, signal?: AbortSignal): Promise<{
        meta: UnknownRecord;
        events: SessionEvent[];
    }>;
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
/** Create the semantic BridgeHost over DSH v0.1.2 typed Host controllers. */
export declare function createDshAlphaHost(input: ContextLike, signal?: AbortSignal): BridgeHost;
/** Prefer the stable rc.2 path when present; otherwise use alpha controllers. */
export declare function resolveDshHost(input: ContextLike, signal?: AbortSignal): BridgeHost;
/** Probe the active generation using its native surface. */
export declare function probeDshHost(input: ContextLike): BridgeHostProbe[];
export {};
