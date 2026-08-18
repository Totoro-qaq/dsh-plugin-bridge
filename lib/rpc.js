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
    method;
    code;
    details;
    constructor(method, code, message, details) {
        super(`${method} 失败（${code}）：${message}`);
        this.name = 'RpcError';
        this.method = method;
        this.code = code;
        this.details = details;
    }
}
/**
 * 解析 API 根。优先级：显式参数 > `DSH_API` > `DSH_WEB_URL`（模型 shell 环境里
 * 由 web bundle 注入的本机 GUI 地址）> 回环默认值。
 */
export function resolveApiBase(explicit, env = process.env) {
    // 环境变量被设成空串是常态（脚本里 `DSH_API=` 之类），空串要当作没设。
    const nonEmpty = (value) => {
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
export function createRpc(options) {
    const api = options.api.replace(/\/$/, '');
    const defaultTimeout = options.timeoutMs ?? 30_000;
    const prefix = options.prefix ?? 'bridge';
    const doFetch = options.fetchImpl ?? fetch;
    let seq = 0;
    return async function rpc(method, payload = {}, timeoutMs) {
        seq += 1;
        const rpcId = `${prefix}-${seq}`;
        let res;
        try {
            res = await doFetch(`${api}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
                signal: AbortSignal.timeout(timeoutMs ?? defaultTimeout),
            });
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new RpcError(method, 'unreachable', `连不上 dsh 网关 ${api}（${reason}）。dsh web 在跑吗？可用 --api 指定地址。`);
        }
        if (!res.ok) {
            throw new RpcError(method, `http-${res.status}`, `${api}/${method} 返回 HTTP ${res.status}`);
        }
        const envelope = await res.json();
        if (envelope.rpcId !== rpcId) {
            throw new RpcError(method, 'rpc-id-mismatch', `响应 rpcId 与请求不匹配（${String(envelope.rpcId)}）`);
        }
        if (!envelope.result?.ok) {
            const err = envelope.result?.error;
            throw new RpcError(method, err?.code ?? 'unknown', err?.message ?? '（网关未给出说明）', err?.details);
        }
        return envelope.result.value;
    };
}
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
