/**
 * dsh 网关 RPC 的最小客户端。
 *
 * 线协议见上游 `packages/host/apiproxy/src/fetch/handler.ts`：
 * `POST /api/<method>`，`Content-Type: application/json`（非 JSON 会被 415 挡掉，
 * 这是跨站写入围栏），请求体是 `client-request` 信封，响应体是 `server-response`。
 * 回环无鉴权。
 */

/** 一次 RPC 的业务错误（网关返回 `result.ok === false`）。 */
export class RpcError extends Error {
  readonly method: string;
  readonly code: string;
  readonly details: unknown;

  constructor(method: string, code: string, message: string, details?: unknown) {
    super(`${method} 失败（${code}）：${message}`);
    this.name = 'RpcError';
    this.method = method;
    this.code = code;
    this.details = details;
  }
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
export function resolveApiBase(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  // 环境变量被设成空串是常态（脚本里 `DSH_API=` 之类），空串要当作没设。
  const nonEmpty = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  const webUrl = nonEmpty(env.DSH_WEB_URL);
  const raw = nonEmpty(explicit)
    ?? nonEmpty(env.DSH_API)
    ?? (webUrl ? `${webUrl.replace(/\/$/, '')}/api` : undefined)
    ?? 'http://127.0.0.1:3080/api';
  return raw.replace(/\/$/, '');
}

/** 建一个 RPC 调用器。 */
export function createRpc(options: RpcOptions): Rpc {
  const api = options.api.replace(/\/$/, '');
  const defaultTimeout = options.timeoutMs ?? 30_000;
  const prefix = options.prefix ?? 'bridge';
  const doFetch = options.fetchImpl ?? fetch;
  let seq = 0;

  return async function rpc<T>(method: string, payload: unknown = {}, timeoutMs?: number): Promise<T> {
    seq += 1;
    const rpcId = `${prefix}-${seq}`;
    let res: Response;
    try {
      res = await doFetch(`${api}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: AbortSignal.timeout(timeoutMs ?? defaultTimeout),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RpcError(method, 'unreachable', `连不上 dsh 网关 ${api}（${reason}）。dsh web 在跑吗？可用 --api 指定地址。`);
    }
    if (!res.ok) {
      throw new RpcError(method, `http-${res.status}`, `${api}/${method} 返回 HTTP ${res.status}`);
    }
    const envelope = await res.json() as {
      rpcId?: string;
      result?: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string; details?: unknown } };
    };
    if (envelope.rpcId !== rpcId) {
      throw new RpcError(method, 'rpc-id-mismatch', `响应 rpcId 与请求不匹配（${String(envelope.rpcId)}）`);
    }
    if (!envelope.result?.ok) {
      const err = envelope.result?.error;
      throw new RpcError(method, err?.code ?? 'unknown', err?.message ?? '（网关未给出说明）', err?.details);
    }
    return envelope.result.value as T;
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
