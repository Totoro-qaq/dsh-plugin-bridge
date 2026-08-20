/**
 * `/bridge` —— 人发起的跨 preset 迁移命令。
 *
 * 这是本插件的主入口，形状对齐上游 `dsh-plan-mode` 的 `/plan`：命令由 UI 直接
 * 派发给注册表，**不经过模型**，命令结果也不进模型历史。于是
 *
 *   - 不需要模型「愿意」加载什么东西，也不需要 bash 或环境变量；
 *   - `minimal` 这种没有 skill 工具的 preset 照样能发起迁移；
 *   - 结果文本只给人看，原会话的上下文一个字都不动。
 *
 * 上游 `session.prompt` 的契约保证了这一点：「A prompt whose content is exactly
 * one text block starting with '/' is a slash command: the host executes it
 * through the command registry (mode-agnostic) and it is never sent to the
 * model.」——所以在官方 WebUI 的输入框里打 `/bridge code` 就能用。
 */
import { executeMigration, findSession, listPresets, migratedTitle, previewMigration, titleOf, } from './migrate.js';
import { RpcError } from './rpc.js';
/** 暂存有效期：超过就要求重新预览，免得拿一份很旧的摘要迁过去。 */
const PENDING_TTL_MS = 30 * 60_000;
/** `<preset> [--go] [--tier x] [--lang l] [--inject m] [--goal-rounds n] [--file p]` */
export function parseBridgeInput(rawInput) {
    const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
    const out = { go: false, help: false, doctor: false };
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!token.startsWith('--')) {
            if (out.preset === undefined)
                out.preset = token;
            else
                return { ...out, error: `多余的参数 "${token}"` };
            continue;
        }
        const eq = token.indexOf('=');
        const key = eq > 0 ? token.slice(2, eq) : token.slice(2);
        const inlineValue = eq > 0 ? token.slice(eq + 1) : undefined;
        const take = () => {
            if (inlineValue !== undefined)
                return inlineValue;
            const next = tokens[i + 1];
            if (next === undefined || next.startsWith('--'))
                return undefined;
            i += 1;
            return next;
        };
        switch (key) {
            case 'go':
                out.go = true;
                break;
            case 'help':
                out.help = true;
                break;
            case 'doctor':
                out.doctor = true;
                break;
            case 'tier': {
                const value = take();
                if (value !== 'flash' && value !== 'current' && value !== 'pro') {
                    return { ...out, error: `--tier 只能是 flash / current / pro` };
                }
                out.tier = value;
                break;
            }
            case 'lang': {
                const value = take();
                if (value !== 'zh' && value !== 'en' && value !== 'auto')
                    return { ...out, error: '--lang 只能是 zh / en / auto' };
                out.lang = value;
                break;
            }
            case 'inject': {
                const value = take();
                if (value !== 'goal' && value !== 'prompt' && value !== 'both')
                    return { ...out, error: '--inject 只能是 goal / prompt / both' };
                out.inject = value;
                break;
            }
            case 'goal-rounds': {
                const value = Number(take());
                if (!Number.isFinite(value) || value < 1)
                    return { ...out, error: '--goal-rounds 需要一个 ≥1 的数字' };
                out.goalRounds = value;
                break;
            }
            case 'file': {
                const value = take();
                if (!value)
                    return { ...out, error: '--file 需要一个路径' };
                out.file = value;
                break;
            }
            default:
                return { ...out, error: `不认识的参数 --${key}` };
        }
    }
    return out;
}
function usage(presets, current) {
    const targets = presets.filter((p) => p.id !== current).map((p) => p.id);
    return [
        '用法：',
        '  /bridge <模式>          生成交接摘要给你过目（不改动任何会话）',
        '  /bridge <模式> --go     确认后执行迁移',
        '',
        `可迁入：${targets.length ? targets.join(' · ') : '（这套部署没有其他 preset）'}`,
        ...(current ? [`当前：${current}`] : []),
        '',
        '可选：--tier flash|current|pro · --lang zh|en|auto · --goal-rounds N · --file <改过的摘要文件>',
        '排查：/bridge --doctor',
    ].join('\n');
}
/** 建一个 `/bridge` 命令定义。返回值形状对齐上游 `CommandDefinition`。 */
export function createBridgeCommand(deps) {
    const pending = new Map();
    const now = deps.now ?? (() => Date.now());
    return {
        name: 'bridge',
        description: '把这个会话迁移到另一个工具模式（preset），原会话保持不动',
        input: { hint: '<preset> [--go] | --doctor' },
        handler: async (invocation) => {
            const sessionId = invocation.agent?.session?.id ?? invocation.agent?.session?.header?.id;
            if (!sessionId)
                return { kind: 'error', text: '取不到当前会话身份，无法迁移。' };
            const parsed = parseBridgeInput(invocation.rawInput ?? '');
            if (parsed.error)
                return { kind: 'error', text: `${parsed.error}\n\n${''}用 /bridge 看用法。` };
            const rpc = deps.rpcFor(invocation.signal);
            const config = deps.config;
            let presets;
            let current;
            try {
                presets = await listPresets(rpc);
                current = (await findSession(rpc, sessionId))?.agentPreset;
            }
            catch (error) {
                return { kind: 'error', text: describe(error) };
            }
            if (parsed.doctor) {
                const probes = deps.probe?.() ?? [];
                const missing = probes.filter((probe) => !probe.available).map((probe) => probe.method);
                const lines = [
                    `网关：进程内 ctx.apiProxy · ${probes.length - missing.length}/${probes.length} 个方法可用`,
                    `当前模式：${current ?? '（读不到）'}`,
                    `可迁入：${presets.filter((p) => p.id !== current).map((p) => p.id).join(' · ') || '（无）'}`,
                    `配置：档位 ${config.modelTier} · 取材 ${config.sourceCharBudget} 字符 · 摘要 ${config.summaryCharBudget} 字符`
                        + ` · goal ${config.goalRounds} 轮 · 注入 ${config.inject}`,
                ];
                if (missing.length) {
                    lines.push('');
                    lines.push(`⚠ 缺少：${missing.join(', ')}`);
                    lines.push('这套 host 的网关面和插件预期的不一致（上游是 developer preview，接口会变）。');
                    lines.push('请到 https://github.com/Totoro-qaq/dsh-plugin-bridge/issues 报一下你的 dsh 版本。');
                    return { kind: 'error', text: lines.join('\n') };
                }
                return { kind: 'success', text: lines.join('\n') };
            }
            if (parsed.help || !parsed.preset)
                return { kind: 'success', text: usage(presets, current) };
            const target = parsed.preset;
            if (!presets.some((p) => p.id === target)) {
                return {
                    kind: 'error',
                    text: `没有叫 "${target}" 的模式（或者它当前是坏的）。\n\n${usage(presets, current)}`,
                };
            }
            if (target === current)
                return { kind: 'error', text: `这个会话已经在 ${target} 模式了。` };
            /* ---------------- 执行 ---------------- */
            if (parsed.go) {
                let summary;
                let source = '暂存的预览';
                if (parsed.file) {
                    try {
                        summary = deps.readSummary?.(parsed.file);
                        source = parsed.file;
                    }
                    catch (error) {
                        return { kind: 'error', text: `读不到 ${parsed.file}：${describe(error)}` };
                    }
                }
                else {
                    const stashed = pending.get(sessionId);
                    if (stashed && stashed.preset === target && now() - stashed.at < PENDING_TTL_MS)
                        summary = stashed.summary;
                }
                if (!summary?.trim()) {
                    return {
                        kind: 'error',
                        text: `没有可用的摘要（预览可能已过期）。先跑 /bridge ${target} 看一眼，确认后再 --go。`,
                    };
                }
                try {
                    const row = await findSession(rpc, sessionId).catch(() => undefined);
                    const result = await executeMigration(rpc, {
                        sessionId,
                        to: target,
                        summary,
                        goalRounds: parsed.goalRounds ?? config.goalRounds,
                        inject: parsed.inject ?? config.inject,
                        title: migratedTitle(titleOf(row), target),
                        ...(parsed.lang && parsed.lang !== 'auto' ? { lang: parsed.lang } : {}),
                    });
                    pending.delete(sessionId);
                    const lines = [
                        `已在 ${result.agentPreset} 模式下建好新会话，摘要来自${source}。`,
                        '原会话原封不动，随时点回来；新会话不满意就归档。',
                    ];
                    for (const warning of result.warnings)
                        lines.push(`⚠ ${warning}`);
                    return { kind: 'success', text: lines.join('\n') };
                }
                catch (error) {
                    return { kind: 'error', text: describe(error) };
                }
            }
            /* ---------------- 预览 ---------------- */
            const startedAt = now();
            try {
                const preview = await previewMigration(rpc, {
                    sessionId,
                    tier: parsed.tier ?? config.modelTier,
                    sourceCharBudget: config.sourceCharBudget,
                    summaryCharBudget: config.summaryCharBudget,
                    lang: parsed.lang ?? config.lang,
                    workerTimeoutMs: config.previewTimeoutMs,
                    pollMs: 750,
                    ...(config.workerProvider ? { provider: config.workerProvider } : {}),
                    ...(config.workerModel ? { model: config.workerModel } : {}),
                });
                const file = deps.writeSummary?.(sessionId, preview.summary);
                pending.set(sessionId, { preset: target, summary: preview.summary, at: now(), ...(file ? { file } : {}) });
                const s = preview.source;
                const lines = [
                    `─── 交接摘要 · ${current ?? '当前模式'} → ${target}（请过目，重点看数字与路径）───`,
                    preview.summary,
                    '───────────────────────────────────────────',
                    `取材 ${s.text.length} 字符 · 用户消息 ${s.userMessagesUsed}/${s.userMessagesTotal} 条`
                        + `${s.reusedCompaction ? ' · 复用了 compaction 底稿' : ''}`
                        + ` · 压缩模型 ${preview.worker.model || '（会话默认）'} · 用时 ${Math.round((now() - startedAt) / 1000)}s`,
                ];
                if (s.truncated)
                    lines.push(`⚠ 取材因预算被裁剪（${s.dropped.join(' / ')}），摘要是基于被裁过的历史写的`);
                if (preview.capped)
                    lines.push('⚠ 压缩工人超时被取消，摘要按已产出文本计');
                lines.push('');
                lines.push(`没问题就执行：/bridge ${target} --go`);
                if (file)
                    lines.push(`要改：编辑 ${file} 之后 /bridge ${target} --go --file ${file}`);
                return { kind: 'success', text: lines.join('\n') };
            }
            catch (error) {
                return { kind: 'error', text: describe(error) };
            }
        },
    };
}
function describe(error) {
    if (error instanceof RpcError)
        return error.message;
    return error instanceof Error ? error.message : String(error);
}
