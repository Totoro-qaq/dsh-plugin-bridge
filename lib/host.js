/**
 * Bridge 的宿主端口。
 *
 * 迁移核心只依赖这些语义能力；DSH HTTP、进程内 apiProxy，以及未来可能出现的
 * dsh-std participant 都应在 adapter 中实现本接口。RPC 方法名与产品对象形状不应
 * 再进入 migrate.ts。
 */
import { RpcError } from './rpc.js';
export const REQUIRED_BRIDGE_CAPABILITIES = Object.freeze([
    'session.list',
    'session.create',
    'session.history',
    'session.models',
    'session.selectModel',
    'session.prompt',
    'session.cancel',
    'session.rename',
    'workspace.list',
    'workspace.archiveSession',
    'agentPreset.list',
    'goal.create',
    'goal.pause',
]);
export const OPTIONAL_BRIDGE_CAPABILITIES = Object.freeze([
    'session.attachment',
    'goal.clear',
]);
const REQUIRED_ACCESSORS = {
    'session.list': host => host.sessions.list,
    'session.create': host => host.sessions.create,
    'session.history': host => host.sessions.history,
    'session.models': host => host.sessions.models,
    'session.selectModel': host => host.sessions.selectModel,
    'session.prompt': host => host.sessions.prompt,
    'session.cancel': host => host.sessions.cancel,
    'session.rename': host => host.sessions.rename,
    'workspace.list': host => host.workspaces.list,
    'workspace.archiveSession': host => host.workspaces.archiveSession,
    'agentPreset.list': host => host.presets.list,
    'goal.create': host => host.goals.create,
    'goal.pause': host => host.goals.pause,
};
/** 只检查端口形状，不执行任何宿主操作。 */
export function probeBridgeHost(host) {
    return REQUIRED_BRIDGE_CAPABILITIES.map(method => ({
        method,
        available: host !== undefined && typeof REQUIRED_ACCESSORS[method](host) === 'function',
    }));
}
/**
 * 把现有 DSH 字符串 RPC 包成语义端口。
 *
 * 这是兼容 adapter，不是迁移核心的一部分；未来的 dsh-std adapter 可以直接实现
 * BridgeHost，而不需要复刻这些 DSH 路由名。
 */
export function createBridgeHostFromRpc(rpc, descriptor = { id: 'dsh-rpc', transport: 'rpc' }) {
    const host = {
        descriptor: Object.freeze({ ...descriptor }),
        sessions: Object.freeze({
            list: (input = {}) => rpc('session.list', input),
            create: input => rpc('session.create', input),
            history: (input, options) => rpc('session.history', input, options?.timeoutMs),
            models: input => rpc('session.models', input),
            selectModel: input => rpc('session.selectModel', input),
            prompt: input => rpc('session.prompt', input),
            cancel: input => rpc('session.cancel', input),
            rename: input => rpc('session.rename', input),
            attachment: input => rpc('session.attachment', input),
        }),
        workspaces: Object.freeze({
            list: () => rpc('workspace.list', {}),
            archiveSession: input => rpc('workspace.archiveSession', input),
        }),
        presets: Object.freeze({
            list: () => rpc('agentPreset.list', {}),
        }),
        goals: Object.freeze({
            create: input => rpc('goal.create', input),
            pause: input => rpc('goal.pause', input),
            clear: input => rpc('goal.clear', input),
        }),
    };
    return Object.freeze(host);
}
/** 将兼容输入规范化为 BridgeHost；核心入口统一调用此函数。 */
export function asBridgeHost(input) {
    if (typeof input === 'function')
        return createBridgeHostFromRpc(input);
    if (input && typeof input === 'object' && typeof input.sessions?.list === 'function')
        return input;
    throw new RpcError('bridge.host', 'invalid-adapter', '宿主 adapter 没有实现 BridgeHost。');
}
/** 对缺失的可选能力给出与 RPC 错误一致的可分类失败。 */
export function missingHostCapability(capability) {
    return new RpcError('bridge.host', 'unavailable', `宿主 adapter 没有提供 ${capability}`);
}
