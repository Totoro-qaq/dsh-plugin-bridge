/**
 * dsh 网关 RPC 的最小客户端。
 *
 * 线协议见上游 `packages/host/apiproxy/src/fetch/handler.ts`：
 * `POST /api/<method>`，`Content-Type: application/json`（非 JSON 会被 415 挡掉，
 * 这是跨站写入围栏），请求体是 `client-request` 信封，响应体是 `server-response`。
 * 回环无鉴权。
 */
/** 一次 RPC 的业务错误（网关返回 `result.ok === false`）。 */
export declare class RpcError extends Error {
    readonly method: string;
    readonly code: string;
    readonly details: unknown;
    constructor(method: string, code: string, message: string, details?: unknown);
}
export interface RpcOptions {
    /** API 根，形如 `http://127.0.0.1:3080/api`。 */
    api: string;
    /** 单次请求超时，默认 30s。 */
    timeoutMs?: number;
    /** rpcId 前缀，便于在 host 日志里认领。 */
    prefix?: string;
    /** 注入 fetch，测试用。 */
    fetchImpl?: typeof fetch;
}
export type Rpc = <T = unknown>(method: string, payload?: unknown, timeoutMs?: number) => Promise<T>;
/**
 * 解析 API 根。优先级：显式参数 > `DSH_API` > `DSH_WEB_URL`（模型 shell 环境里
 * 由 web bundle 注入的本机 GUI 地址）> 回环默认值。
 */
export declare function resolveApiBase(explicit?: string, env?: NodeJS.ProcessEnv): string;
/** 建一个 RPC 调用器。 */
export declare function createRpc(options: RpcOptions): Rpc;
export declare const sleep: (ms: number) => Promise<void>;
