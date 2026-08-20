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
import { RpcError, type Rpc } from './rpc.ts';

/** 一个 unary 网关方法：`(request, signal) => 信封`。 */
type UnaryMethod = (
  request: { rpcId: string; payload: unknown },
  signal?: AbortSignal,
) => Promise<{ result?: RpcResult }> | { result?: RpcResult };

interface RpcResult {
  ok?: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
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

/** RPC 方法名 → `ctx.apiProxy` 上的位置。 */
const ROUTES: Record<string, [keyof ApiProxyLike, string]> = {
  'session.list': ['sessions', 'list'],
  'session.create': ['sessions', 'create'],
  'session.history': ['sessions', 'history'],
  'session.models': ['sessions', 'models'],
  'session.selectModel': ['sessions', 'selectModel'],
  'session.prompt': ['sessions', 'prompt'],
  'session.cancel': ['sessions', 'cancel'],
  'session.rename': ['sessions', 'rename'],
  // rc.8 optional surface: rc.6/rc.7 没有图片时仍保持完整兼容。
  'session.attachment': ['sessions', 'attachment'],
  'workspace.list': ['workspace', 'list'],
  'workspace.archiveSession': ['workspace', 'archiveSession'],
  'agentPreset.list': ['agentPresets', 'list'],
  'goal.create': ['goals', 'create'],
  'goal.pause': ['goals', 'pause'],
};

/** 主迁移链路必需的方法名（测试与 doctor 用）；不含 rc.8 可选图片读取。 */
export const SUPPORTED_METHODS: readonly string[] = Object.keys(ROUTES).filter((method) => method !== 'session.attachment');

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
export function probeApiProxy(apiProxy: Partial<ApiProxyLike> | undefined): MethodProbe[] {
  return SUPPORTED_METHODS.map((method) => {
    const route = ROUTES[method];
    const domain = route?.[0];
    const key = route?.[1];
    const fn = domain && key ? (apiProxy as ApiProxyLike | undefined)?.[domain]?.[key] : undefined;
    return { method, available: typeof fn === 'function' };
  });
}

/**
 * 建一个直连 `ctx.apiProxy` 的 Rpc。
 * @param apiProxy - host 上的网关服务。
 * @param signal - 派发方的取消信号（命令处理器拿到的那个）。
 */
export function createApiProxyRpc(apiProxy: ApiProxyLike, signal?: AbortSignal): Rpc {
  let seq = 0;
  return async function rpc<T>(method: string, payload: unknown = {}): Promise<T> {
    const route = ROUTES[method];
    if (!route) throw new RpcError(method, 'unsupported', `进程内网关适配器没有映射 ${method}`);
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
    return result.value as T;
  };
}
