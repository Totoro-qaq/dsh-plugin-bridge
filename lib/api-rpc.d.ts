/**
 * 把 host 进程内的 `ctx.apiProxy` 适配成 `Rpc`。
 *
 * 网关不只是一个 HTTP 端点：`@deepseek-ai/dsh-host-apiproxy` 把整套 ApiProxy
 * 作为 cordis 服务提供为 `ctx.apiProxy`（web bundle 的 `api-gateway` 行挂载），
 * 方法签名就是 `(request, signal) => RpcResponse`。所以插件在进程内就能完成
 * 迁移——不需要端口、不需要 `DSH_WEB_URL`、不需要 bash、也不依赖模型愿不愿意
 * 帮忙调用。
 *
 * `migrate.ts` 只认注入进来的 `Rpc`，于是同一套编排在三个地方复用：
 * `/bridge` 命令（这里）、CLI（走 HTTP）、评测 harness。
 */
import { type Rpc } from './rpc.ts';
/** 一个 unary 网关方法：`(request, signal) => 信封`。 */
type UnaryMethod = (request: {
    rpcId: string;
    payload: unknown;
}, signal?: AbortSignal) => Promise<{
    result?: RpcResult;
}> | {
    result?: RpcResult;
};
interface RpcResult {
    ok?: boolean;
    value?: unknown;
    error?: {
        code?: string;
        message?: string;
        details?: unknown;
    };
}
/**
 * `ctx.apiProxy` 的结构化最小契约。
 *
 * 故意不 import `@deepseek-ai/dsh-host-apiproxy` 的类型：那会多一个 peer 依赖，
 * 而这里只用到十来个方法。结构化声明也让上游加字段不至于把我们编译挂掉。
 */
export interface ApiProxyLike {
    sessions: Record<string, UnaryMethod>;
    workspace: Record<string, UnaryMethod>;
    goals: Record<string, UnaryMethod>;
    agentPresets: Record<string, UnaryMethod>;
}
/** 本适配器支持的方法名（测试与自检用）。 */
export declare const SUPPORTED_METHODS: readonly string[];
/**
 * 建一个直连 `ctx.apiProxy` 的 Rpc。
 * @param apiProxy - host 上的网关服务。
 * @param signal - 派发方的取消信号（命令处理器拿到的那个）。
 */
export declare function createApiProxyRpc(apiProxy: ApiProxyLike, signal?: AbortSignal): Rpc;
export {};
