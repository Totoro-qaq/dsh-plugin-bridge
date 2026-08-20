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
/** 主迁移链路必需的方法名（测试与 doctor 用）；不含 rc.8 可选图片读取。 */
export declare const SUPPORTED_METHODS: readonly string[];
/** 一个方法在当前 host 上是否可达。 */
export interface MethodProbe {
    method: string;
    available: boolean;
}
/**
 * 探测这套 host 的网关面是否还是本插件预期的形状。
 *
 * 上游是 developer preview，README 明说会有破坏性变更。与其等用户报「插件用不了」，
 * 不如让 `/bridge --doctor` 直接把缺了哪个方法说出来。只读方法表，不发起任何调用。
 */
export declare function probeApiProxy(apiProxy: Partial<ApiProxyLike> | undefined): MethodProbe[];
/**
 * 建一个直连 `ctx.apiProxy` 的 Rpc。
 * @param apiProxy - host 上的网关服务。
 * @param signal - 派发方的取消信号（命令处理器拿到的那个）。
 */
export declare function createApiProxyRpc(apiProxy: ApiProxyLike, signal?: AbortSignal): Rpc;
export {};
