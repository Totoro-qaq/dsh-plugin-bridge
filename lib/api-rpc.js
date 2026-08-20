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
import { RpcError } from './rpc.js';
/** RPC 方法名 → `ctx.apiProxy` 上的位置。 */
const ROUTES = {
    'session.list': ['sessions', 'list'],
    'session.create': ['sessions', 'create'],
    'session.history': ['sessions', 'history'],
    'session.models': ['sessions', 'models'],
    'session.selectModel': ['sessions', 'selectModel'],
    'session.prompt': ['sessions', 'prompt'],
    'session.cancel': ['sessions', 'cancel'],
    'session.rename': ['sessions', 'rename'],
    'workspace.list': ['workspace', 'list'],
    'workspace.archiveSession': ['workspace', 'archiveSession'],
    'agentPreset.list': ['agentPresets', 'list'],
    'goal.create': ['goals', 'create'],
    'goal.pause': ['goals', 'pause'],
};
/** 本适配器支持的方法名（测试与自检用）。 */
export const SUPPORTED_METHODS = Object.keys(ROUTES);
/**
 * 探测这套 host 的网关面是否还是本插件预期的形状。
 *
 * 上游是 developer preview，README 明说会有破坏性变更。与其等用户报「插件用不了」，
 * 不如让 `/bridge --doctor` 直接把缺了哪个方法说出来。只读方法表，不发起任何调用。
 */
export function probeApiProxy(apiProxy) {
    return SUPPORTED_METHODS.map((method) => {
        const route = ROUTES[method];
        const domain = route?.[0];
        const key = route?.[1];
        const fn = domain && key ? apiProxy?.[domain]?.[key] : undefined;
        return { method, available: typeof fn === 'function' };
    });
}
/**
 * 建一个直连 `ctx.apiProxy` 的 Rpc。
 * @param apiProxy - host 上的网关服务。
 * @param signal - 派发方的取消信号（命令处理器拿到的那个）。
 */
export function createApiProxyRpc(apiProxy, signal) {
    let seq = 0;
    return async function rpc(method, payload = {}) {
        const route = ROUTES[method];
        if (!route)
            throw new RpcError(method, 'unsupported', `进程内网关适配器没有映射 ${method}`);
        const [domain, key] = route;
        const fn = apiProxy[domain]?.[key];
        if (typeof fn !== 'function') {
            throw new RpcError(method, 'unavailable', `这套部署的 apiProxy 上没有 ${domain}.${key}`);
        }
        seq += 1;
        const envelope = await fn({ rpcId: `bridge-cmd-${seq}`, payload }, signal);
        const result = envelope?.result;
        if (!result?.ok) {
            throw new RpcError(method, result?.error?.code ?? 'unknown', result?.error?.message ?? '（网关未给出说明）', result?.error?.details);
        }
        return result.value;
    };
}
