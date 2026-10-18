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
 * 当前官方 WebUI 通过公开的 commands Remote 提交命令，输入触发器负责把
 * `/bridge` 及参数交给该入口；Bridge 卡片同样调用 commands.execute。
 * 早期宿主曾在 session.prompt 中识别斜杠命令，但这不是新版宿主的保证，
 * 也不能用裸 session.prompt 代替命令派发，否则可能把命令文本发给模型。
 */
import { randomUUID } from 'node:crypto';
import { clearInterval, setInterval } from 'node:timers';
import { estimateSummaryTokens } from './compression.js';
import { claimSummaryFile, claimWarning, sameSummaryPath, summaryPathKey } from './summary-file.js';
import { executeMigration, findSession, listPresets, resolvePresetTarget, migratedTitle, previewMigration, titleOf, } from './migrate.js';
import { asBridgeHost, missingHostCapability } from './host.js';
import { RpcError } from './rpc.js';
import { MAX_EDITED_SUMMARY_CHARS } from './client-contract.js';
/** 暂存有效期：超过就要求重新预览，免得拿一份很旧的摘要迁过去。 */
const PENDING_TTL_MS = 30 * 60_000;
/** 每个会话同时保留的待确认预览上限；超出时挤掉最旧的一份。 */
const MAX_PENDING_PER_SESSION = 8;
/** 本进程记住的已送达路径上限。超了就忘掉最旧的一条；磁盘记录仍在保留期内有效。 */
const DELIVERED_MEMORY_LIMIT = 64;
/** WebUI 完成回放的上限。超了就丢掉最旧的一条，旧卡片不再重放第一次的结果。 */
const COMPLETED_WEB_UI_LIMIT = 32;
/** 摘要工人等待期间，给没有原生卡片的客户端补一条带耗时的进度。 */
const DEFAULT_PROGRESS_HEARTBEAT_MS = 15_000;
/** `<preset> [--go] [--continue] [--tier x] [--lang l] [--inject m] [--goal-rounds n] [--file p]` */
export function parseBridgeInput(rawInput) {
    const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
    const out = { go: false, help: false, doctor: false, autoContinue: false };
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!token.startsWith('--')) {
            if (out.preset === undefined)
                out.preset = token;
            else
                return { ...out, error: { code: 'extra-argument', token } };
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
            case 'continue':
                out.autoContinue = true;
                break;
            case 'approve-plan64': {
                const value = take();
                if (!value)
                    return { ...out, error: { code: 'approve-plan64-missing' } };
                out.approvePlan64 = value;
                break;
            }
            case 'approved-plan': {
                const value = take();
                if (!value || !/^[A-Za-z0-9-]{8,}$/u.test(value))
                    return { ...out, error: { code: 'approved-plan-invalid' } };
                out.approvedPlanId = value;
                break;
            }
            case 'tier': {
                const value = take();
                if (value !== 'flash' && value !== 'current' && value !== 'pro') {
                    return { ...out, error: { code: 'tier' } };
                }
                out.tier = value;
                break;
            }
            case 'lang': {
                const value = take();
                if (value !== 'zh' && value !== 'en' && value !== 'auto')
                    return { ...out, error: { code: 'lang' } };
                out.lang = value;
                break;
            }
            case 'inject': {
                const value = take();
                if (value !== 'goal' && value !== 'prompt' && value !== 'both')
                    return { ...out, error: { code: 'inject' } };
                out.inject = value;
                break;
            }
            case 'goal-rounds': {
                const value = Number(take());
                if (!Number.isFinite(value) || value < 1)
                    return { ...out, error: { code: 'goal-rounds' } };
                out.goalRounds = value;
                break;
            }
            case 'file': {
                const value = take();
                if (!value)
                    return { ...out, error: { code: 'file-missing' } };
                out.file = value;
                break;
            }
            case 'summary64': {
                const value = take();
                if (!value)
                    return { ...out, error: { code: 'summary64-missing' } };
                out.summary64 = value;
                break;
            }
            case 'preview-id': {
                const value = take();
                if (!value || !/^[A-Za-z0-9-]{8,}$/u.test(value))
                    return { ...out, error: { code: 'preview-id' } };
                out.previewId = value;
                break;
            }
            default:
                return { ...out, error: { code: 'unknown-option', key } };
        }
    }
    return out;
}
function displayLang(lang) {
    return lang === 'en' ? 'en' : 'zh';
}
/**
 * `--lang` 可能写在出错的参数后面。先扫一遍，让错误句子跟用户明确指定的语言走；
 * 没写或写错时再退回配置。同一条命令里写了多次时，后出现的有效值覆盖前面的，
 * 与 `parseBridgeInput` 一致。`auto` 与命令其余文案一样显示中文。
 */
function explicitDisplayLang(rawInput) {
    const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
    let found;
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        const inline = token.startsWith('--lang=') ? token.slice('--lang='.length) : undefined;
        const value = inline ?? (token === '--lang' ? tokens[i + 1] : undefined);
        if (token !== '--lang' && !token.startsWith('--lang='))
            continue;
        if (value === 'en')
            found = 'en';
        else if (value === 'zh' || value === 'auto')
            found = 'zh';
    }
    return found;
}
function parseErrorText(error, lang) {
    const en = lang === 'en';
    const detail = (() => {
        switch (error.code) {
            case 'extra-argument':
                return en ? `Unexpected argument "${error.token}".` : `多余的参数 "${error.token}"。`;
            case 'approve-plan64-missing':
                return en ? '--approve-plan64 needs the complete plan-approval payload.' : '--approve-plan64 需要完整计划批准载荷。';
            case 'approved-plan-invalid':
                return en ? '--approved-plan is not a valid approval record.' : '--approved-plan 批准记录无效。';
            case 'tier':
                return en ? '--tier must be flash, current, or pro.' : '--tier 只能是 flash / current / pro。';
            case 'lang':
                return en ? '--lang must be zh, en, or auto.' : '--lang 只能是 zh / en / auto。';
            case 'inject':
                return en ? '--inject must be goal, prompt, or both.' : '--inject 只能是 goal / prompt / both。';
            case 'goal-rounds':
                return en ? '--goal-rounds needs a number greater than or equal to 1.' : '--goal-rounds 需要一个 ≥1 的数字。';
            case 'file-missing':
                return en ? '--file needs a path.' : '--file 需要一个路径。';
            case 'summary64-missing':
                return en ? '--summary64 needs the summary payload produced by the WebUI.' : '--summary64 需要 WebUI 生成的摘要载荷。';
            case 'preview-id':
                return en ? '--preview-id is invalid.' : '--preview-id 无效。';
            case 'unknown-option':
                return en ? `Unknown option --${error.key}.` : `不认识的参数 --${error.key}。`;
            default: {
                const unreachable = error;
                return String(unreachable);
            }
        }
    })();
    return en ? `${detail}\n\nUse /bridge to see the available syntax.` : `${detail}\n\n用 /bridge 看用法。`;
}
function usage(presets, current, lang) {
    const targets = presets.filter((p) => p.id !== current).map((p) => p.id);
    if (lang === 'en') {
        return [
            'Usage:',
            '  /bridge <preset>          Preview a handoff without changing either session',
            '  /bridge <preset> --go     Migrate after review; the new session restates and waits',
            '  /bridge <preset> --go --continue  Restate and continue in the same model request',
            '',
            `Available: ${targets.length ? targets.join(' · ') : '(no other presets in this deployment)'}`,
            ...(current ? [`Current: ${current}`] : []),
            '',
            'Options: --continue · --tier flash|current|pro · --lang zh|en|auto · --goal-rounds N · --file <edited-summary>',
            'Check: /bridge --doctor',
        ].join('\n');
    }
    return [
        '用法：',
        '  /bridge <模式>          生成交接摘要给你过目（不改动任何会话）',
        '  /bridge <模式> --go     确认后迁移；新会话复述理解后暂停',
        '  /bridge <模式> --go --continue  同一轮复述并继续下一步',
        '',
        `可迁入：${targets.length ? targets.join(' · ') : '（这套部署没有其他 preset）'}`,
        ...(current ? [`当前：${current}`] : []),
        '',
        '可选：--continue · --tier flash|current|pro · --lang zh|en|auto · --goal-rounds N · --file <改过的摘要文件>',
        '排查：/bridge --doctor',
    ].join('\n');
}
function commandMetadata(lang) {
    if (lang === 'en') {
        return {
            description: 'Migrate this session to another tool preset while keeping the original untouched',
            hint: '<preset> [--go] [--continue] | --doctor',
        };
    }
    if (lang === 'zh') {
        return {
            description: '把这个会话迁移到另一工具 preset，原会话保持不动',
            hint: '<模式> [--go] [--continue] | --doctor',
        };
    }
    return {
        description: 'Migrate across tool presets; keep the original untouched · 跨 preset 迁移会话，原会话保持不动',
        hint: '<preset/模式> [--go] [--continue] | --doctor',
    };
}
function resolveCommandHost(deps, signal) {
    if (deps.hostFor)
        return deps.hostFor(signal);
    if (deps.rpcFor)
        return asBridgeHost(deps.rpcFor(signal));
    throw missingHostCapability('BridgeHost');
}
/** 建一个 `/bridge` 命令定义。返回值形状对齐上游 `CommandDefinition`。 */
export function createBridgeCommand(deps) {
    // Keyed by preview ID: a newer preview (for example from the WebUI target
    // picker) must not silently void an older card that is still on screen.
    const pending = new Map();
    const completedWebUi = new Map();
    const inFlightWebUi = new Set();
    const previewingSessions = new Set();
    const now = deps.now ?? (() => Date.now());
    const metadata = commandMetadata(deps.config.lang);
    const livePending = (entry, sessionId, target) => entry && !entry.retainFile && entry.sessionId === sessionId && entry.preset === target && now() - entry.at < PENDING_TTL_MS ? entry : undefined;
    const newestPending = (sessionId, target) => {
        let newest;
        for (const entry of pending.values()) {
            if (entry.retainFile || entry.skipAutomatic)
                continue;
            if (livePending(entry, sessionId, target) && (!newest || entry.at >= newest.at))
                newest = entry;
        }
        return newest;
    };
    /**
     * `--file` 对上的那一份预览，包括已过期但这次还在读的。对不上就没有，不借用别的预览。
     * 认领看文件，不看这次要迁去的模式：同一份摘要不能先迁到 A 再被 B 的手打 `--go` 迁一次。
     */
    const pendingForFile = (file, sessionId) => {
        let found;
        for (const entry of pending.values()) {
            if (entry.sessionId !== sessionId || !entry.file)
                continue;
            if (!sameSummaryPath(entry.file, file))
                continue;
            if (!found || entry.at >= found.at)
                found = entry;
        }
        return found;
    };
    const dropSummaryFile = (file) => {
        if (!file)
            return;
        try {
            deps.removeSummary?.(file);
        }
        catch { /* 清理失败不能让迁移失败 */ }
    };
    /**
     * 正在读取的摘要按真实路径计数。一次调用结束只减一，
     * 另一路还拿着同一份文件时不能把保护摘掉。
     */
    const inUseSummaryCounts = new Map();
    /** 送达时还有人拿着文件，就等最后一次放开再删。 */
    const retireFiles = new Map();
    const holdSummary = (file) => {
        const key = summaryPathKey(file);
        inUseSummaryCounts.set(key, (inUseSummaryCounts.get(key) ?? 0) + 1);
        return key;
    };
    const releaseSummary = (key) => {
        if (!key)
            return;
        const left = (inUseSummaryCounts.get(key) ?? 1) - 1;
        if (left > 0)
            inUseSummaryCounts.set(key, left);
        else {
            inUseSummaryCounts.delete(key);
            const file = retireFiles.get(key);
            if (file) {
                retireFiles.delete(key);
                dropSummaryFile(file);
            }
        }
    };
    /**
     * 本进程里正在迁移的摘要文件，按真实路径记。手打 --go、--file 和 WebUI 共用，
     * 与跨进程记录无关：记录过期被别人接手，本进程也不会再迁同一份文件。
     */
    const migratingFiles = new Set();
    const deliveredFiles = new Map();
    const fileKeyOf = (file) => summaryPathKey(file);
    const pruneDeliveredMemory = () => {
        for (const [key, at] of deliveredFiles) {
            if (now() - at >= PENDING_TTL_MS)
                deliveredFiles.delete(key);
        }
        while (deliveredFiles.size > DELIVERED_MEMORY_LIMIT) {
            const oldest = deliveredFiles.keys().next().value;
            if (oldest === undefined)
                break;
            deliveredFiles.delete(oldest);
        }
    };
    const pruneCompletedWebUi = () => {
        for (const [key, completed] of completedWebUi) {
            if (now() - completed.at >= PENDING_TTL_MS)
                completedWebUi.delete(key);
        }
        while (completedWebUi.size > COMPLETED_WEB_UI_LIMIT) {
            let oldestKey;
            let oldestAt = Infinity;
            for (const [key, completed] of completedWebUi) {
                if (completed.at < oldestAt) {
                    oldestAt = completed.at;
                    oldestKey = key;
                }
            }
            if (oldestKey === undefined)
                break;
            completedWebUi.delete(oldestKey);
        }
    };
    /** 同步领走一份预览。领走之后、下一次 await 之前，别人就看不到它。 */
    const claimPending = (entry) => {
        if (!entry || !pending.has(entry.id))
            return undefined;
        pending.delete(entry.id);
        return entry;
    };
    const restorePending = (entry) => {
        if (entry && !pending.has(entry.id))
            pending.set(entry.id, entry);
    };
    const fileInFlight = (file) => migratingFiles.has(fileKeyOf(file));
    const fileDelivered = (file) => {
        pruneDeliveredMemory();
        const at = deliveredFiles.get(fileKeyOf(file));
        return at !== undefined && now() - at < PENDING_TTL_MS;
    };
    const rememberDeliveredFile = (file) => {
        const key = fileKeyOf(file);
        deliveredFiles.delete(key);
        deliveredFiles.set(key, now());
        pruneDeliveredMemory();
    };
    const retireSummaryFile = (file) => {
        if (!file)
            return;
        const key = fileKeyOf(file);
        if ((inUseSummaryCounts.get(key) ?? 0) > 0) {
            retireFiles.set(key, file);
            return;
        }
        dropSummaryFile(file);
    };
    const completeDelivery = (entry) => {
        if (!entry)
            return;
        if (entry.file)
            rememberDeliveredFile(entry.file);
        pending.delete(entry.id);
        retireSummaryFile(entry.file);
    };
    /** 这份目标的一份预览已经被确认领走。其余同目标预览不再自动迁。显式预览卡仍可确认。 */
    const skipOlderAutomatic = (sessionId, target) => {
        for (const entry of pending.values()) {
            if (entry.sessionId === sessionId && entry.preset === target)
                entry.skipAutomatic = true;
        }
    };
    const evictionBlocked = (entry) => {
        if (entry.retainFile)
            return true;
        const key = entry.file ? fileKeyOf(entry.file) : undefined;
        return Boolean(key && inUseSummaryCounts.has(key));
    };
    /** 丢掉一份不再保留的预览。正在用或标记保留的文件留在原地，记录也不挤掉。 */
    const evictPending = (entry) => {
        if (evictionBlocked(entry))
            return false;
        pending.delete(entry.id);
        dropSummaryFile(entry.file);
        return true;
    };
    /**
     * 过期预览不再能被自动确认。正在用 `--file` 读取的那一份保留记录和文件：
     * 送达之后再删；这次失败则留到下一次不再使用它的清扫。
     */
    const sweepExpired = (preserveFile) => {
        const preserveKey = preserveFile ? summaryPathKey(preserveFile) : undefined;
        for (const entry of [...pending.values()]) {
            if (now() - entry.at < PENDING_TTL_MS)
                continue;
            const key = entry.file ? summaryPathKey(entry.file) : undefined;
            if (key && (key === preserveKey || inUseSummaryCounts.has(key)))
                continue;
            pending.delete(entry.id);
            dropSummaryFile(entry.file);
        }
    };
    const stashPending = (entry) => {
        sweepExpired();
        pending.set(entry.id, entry);
        const own = [...pending.values()].filter((old) => old.sessionId === entry.sessionId).sort((a, b) => a.at - b.at);
        let overflow = own.length - MAX_PENDING_PER_SESSION;
        for (const old of own) {
            if (overflow <= 0)
                break;
            if (old.id === entry.id)
                continue;
            if (!evictPending(old))
                continue;
            overflow -= 1;
        }
    };
    return {
        name: 'bridge',
        description: metadata.description,
        input: { hint: metadata.hint },
        // Native WebUI confirmation carries the edited summary in --summary64.
        // The outcome remains durable, but the raw command payload must not become log content.
        recordInput: false,
        handler: async (invocation) => {
            pruneCompletedWebUi();
            const rawInput = invocation.rawInput ?? '';
            const parsed = parseBridgeInput(rawInput);
            const initialLang = explicitDisplayLang(rawInput) ?? displayLang(parsed.lang ?? deps.config.lang);
            // 第一次 await（拉 preset / 会话）之前就占住文件，避免这段时间里的清扫把过期摘要删掉。
            const heldSummary = parsed.file ? holdSummary(parsed.file) : undefined;
            try {
                sweepExpired(parsed.file);
                if (parsed.error)
                    return { kind: 'error', text: parseErrorText(parsed.error, initialLang) };
                const sessionId = invocation.agent?.session?.id ?? invocation.agent?.session?.header?.id;
                if (!sessionId) {
                    return {
                        kind: 'error',
                        text: initialLang === 'en'
                            ? 'The current session identity is unavailable, so this session cannot be migrated.'
                            : '取不到当前会话身份，无法迁移。',
                    };
                }
                const reportProgress = (message) => {
                    try {
                        deps.onProgress?.(message);
                    }
                    catch { /* 进度通知失败不能让迁移失败 */ }
                };
                let host;
                try {
                    host = resolveCommandHost(deps, invocation.signal);
                }
                catch (error) {
                    return { kind: 'error', text: describe(error) };
                }
                const config = deps.config;
                if (parsed.approvePlan64 || parsed.approvedPlanId) {
                    if (!deps.planApprovals)
                        return { kind: 'error', text: initialLang === 'en'
                                ? 'This Bridge host cannot hand off native plan approvals.' : '当前 Bridge 宿主没有提供原生计划批准交接。' };
                    if (parsed.go || parsed.autoContinue || parsed.file || parsed.summary64 || parsed.doctor || parsed.help
                        || (parsed.approvePlan64 && parsed.approvedPlanId))
                        return { kind: 'error', text: initialLang === 'en'
                                ? 'Plan approval cannot be combined with another Bridge action.' : '计划批准不能与其他 Bridge 操作混用。' };
                    return deps.planApprovals.execute({ sessionId, lang: initialLang,
                        ...(parsed.preset ? { preset: parsed.preset } : {}),
                        ...(parsed.approvePlan64 ? { approvePlan64: parsed.approvePlan64 } : {}),
                        ...(parsed.approvedPlanId ? { approvedPlanId: parsed.approvedPlanId } : {}),
                        ...(invocation.signal ? { signal: invocation.signal } : {}),
                    });
                }
                let presets;
                let sourceSession;
                let current;
                try {
                    presets = await listPresets(host);
                    sourceSession = await findSession(host, sessionId);
                    current = sourceSession?.agentPreset;
                }
                catch (error) {
                    return { kind: 'error', text: describe(error) };
                }
                if (parsed.doctor) {
                    const probes = deps.probe?.() ?? [];
                    const missing = probes.filter((probe) => !probe.available).map((probe) => probe.method);
                    const available = presets.filter((p) => p.id !== current).map((p) => p.id).join(' · ');
                    const lines = initialLang === 'en'
                        ? [
                            `Adapter: ${host.descriptor.id} · ${probes.length - missing.length}/${probes.length} methods available`,
                            `Current preset: ${current ?? '(unavailable)'}`,
                            `Available targets: ${available || '(none)'}`,
                            `Config: tier ${config.modelTier} · source ${config.sourceCharBudget} chars · summary ${config.summaryCharBudget} chars`
                                + ` · goal ${config.goalRounds} rounds · injection ${config.inject}`,
                        ]
                        : [
                            `适配器：${host.descriptor.id} · ${probes.length - missing.length}/${probes.length} 个方法可用`,
                            `当前模式：${current ?? '（读不到）'}`,
                            `可迁入：${available || '（无）'}`,
                            `配置：档位 ${config.modelTier} · 取材 ${config.sourceCharBudget} 字符 · 摘要 ${config.summaryCharBudget} 字符`
                                + ` · goal ${config.goalRounds} 轮 · 注入 ${config.inject}`,
                        ];
                    if (missing.length) {
                        lines.push('');
                        if (initialLang === 'en') {
                            lines.push(`⚠ Missing: ${missing.join(', ')}`);
                            lines.push('This host gateway does not match the plugin contract; the upstream API is still a developer preview.');
                            lines.push('Report your dsh version at https://github.com/Totoro-qaq/dsh-plugin-bridge/issues.');
                        }
                        else {
                            lines.push(`⚠ 缺少：${missing.join(', ')}`);
                            lines.push('这套 host 的网关面和插件预期的不一致（上游是 developer preview，接口会变）。');
                            lines.push('请到 https://github.com/Totoro-qaq/dsh-plugin-bridge/issues 报一下你的 dsh 版本。');
                        }
                        return { kind: 'error', text: lines.join('\n') };
                    }
                    return { kind: 'success', text: lines.join('\n') };
                }
                if (parsed.help || !parsed.preset)
                    return { kind: 'success', text: usage(presets, current, initialLang) };
                const target = resolvePresetTarget(parsed.preset, presets);
                if (!presets.some((p) => p.id === target)) {
                    return {
                        kind: 'error',
                        text: initialLang === 'en'
                            ? `No usable preset named "${target}".\n\n${usage(presets, current, initialLang)}`
                            : `没有叫 "${target}" 的模式（或者它当前是坏的）。\n\n${usage(presets, current, initialLang)}`,
                    };
                }
                if (target === current) {
                    return { kind: 'error', text: initialLang === 'en' ? `This session already uses the ${target} preset.` : `这个会话已经在 ${target} 模式了。` };
                }
                /* ---------------- 执行 ---------------- */
                if (parsed.go) {
                    let summary;
                    let pendingLang;
                    let webUiConfirmationKey;
                    let consumedPending;
                    // The typed or file-based --go uses up this preview on success, so it cannot migrate twice.
                    let usedPending;
                    if (parsed.summary64) {
                        if (!parsed.previewId) {
                            return { kind: 'error', text: initialLang === 'en' ? 'The WebUI handoff has no preview ID; generate a new preview.' : 'WebUI 编辑稿缺少预览 ID，请重新生成预览。' };
                        }
                        webUiConfirmationKey = `${sessionId}:${parsed.previewId}`;
                        const completed = completedWebUi.get(webUiConfirmationKey);
                        if (completed && completed.preset === target && completed.previewId === parsed.previewId
                            && completed.payload === parsed.summary64 && now() - completed.at < PENDING_TTL_MS)
                            return completed.result;
                        if (inFlightWebUi.has(webUiConfirmationKey)) {
                            return { kind: 'error', text: initialLang === 'en' ? 'This WebUI confirmation is already running.' : '这次 WebUI 确认正在执行，请勿重复提交。' };
                        }
                        const stored = pending.get(parsed.previewId);
                        if (stored?.retainFile && stored.sessionId === sessionId && stored.preset === target) {
                            return {
                                kind: 'error',
                                text: initialLang === 'en'
                                    ? 'This preview was already used for a handoff that did not fully start. Open that target session instead of confirming a different edit.'
                                    : '这份预览已经用于一次没有完整送达的交接。请打开已创建的目标会话，不要换一份编辑稿再次确认。',
                            };
                        }
                        const bound = livePending(stored, sessionId, target);
                        if (!bound) {
                            return {
                                kind: 'error',
                                text: initialLang === 'en'
                                    ? `No valid preview is bound to this WebUI edit. Run /bridge ${target} again, review it, then confirm.`
                                    : `这份 WebUI 编辑稿没有绑定有效预览。请重新运行 /bridge ${target}，校对后再确认。`,
                            };
                        }
                        pendingLang = bound.lang;
                        try {
                            if (!/^[A-Za-z0-9_-]+$/u.test(parsed.summary64))
                                throw new Error('invalid base64url');
                            summary = Buffer.from(parsed.summary64, 'base64url').toString('utf8');
                            const canonical = Buffer.from(summary, 'utf8').toString('base64url');
                            if (canonical !== parsed.summary64 || !summary.trim())
                                throw new Error('invalid base64url');
                            if (summary.length > MAX_EDITED_SUMMARY_CHARS) {
                                return {
                                    kind: 'error',
                                    text: initialLang === 'en'
                                        ? `The edited WebUI handoff is too long (maximum ${MAX_EDITED_SUMMARY_CHARS} characters).`
                                        : `WebUI 编辑后的摘要过长（上限 ${MAX_EDITED_SUMMARY_CHARS} 字符）。`,
                                };
                            }
                        }
                        catch {
                            return {
                                kind: 'error',
                                text: initialLang === 'en' ? 'The edited WebUI handoff payload is invalid.' : 'WebUI 编辑后的摘要载荷无效。',
                            };
                        }
                        if (bound.file && fileDelivered(bound.file))
                            return claimDenied('delivered', initialLang);
                        // 和手打 --go、--file 共用同一次认领，下一次 await 之前别人就迁不了这份预览。
                        consumedPending = claimPending(bound);
                        if (!consumedPending)
                            return claimDenied('busy', initialLang);
                        inFlightWebUi.add(webUiConfirmationKey);
                    }
                    else if (parsed.file) {
                        if (fileDelivered(parsed.file))
                            return claimDenied('delivered', initialLang);
                        if (fileInFlight(parsed.file))
                            return claimDenied('busy', initialLang);
                        try {
                            summary = deps.readSummary?.(parsed.file);
                        }
                        catch (error) {
                            return { kind: 'error', text: initialLang === 'en' ? `Cannot read ${parsed.file}: ${describe(error)}` : `读不到 ${parsed.file}：${describe(error)}` };
                        }
                        const matched = pendingForFile(parsed.file, sessionId);
                        if (matched?.retainFile)
                            return claimDenied('held', initialLang);
                        usedPending = claimPending(matched);
                        if (matched && !usedPending)
                            return claimDenied('busy', initialLang);
                    }
                    else {
                        const candidate = newestPending(sessionId, target);
                        if (candidate?.file && fileDelivered(candidate.file))
                            return claimDenied('delivered', initialLang);
                        usedPending = claimPending(candidate);
                        if (usedPending) {
                            summary = usedPending.summary;
                            pendingLang = usedPending.lang;
                        }
                    }
                    const runLang = parsed.lang === 'en' || parsed.lang === 'zh' ? parsed.lang : pendingLang ?? initialLang;
                    const source = parsed.summary64
                        ? (runLang === 'en' ? 'the edited WebUI preview' : 'WebUI 里编辑后的预览')
                        : parsed.file ?? (runLang === 'en' ? 'the reviewed preview' : '暂存的预览');
                    if (!summary?.trim()) {
                        restorePending(consumedPending ?? usedPending);
                        if (webUiConfirmationKey)
                            inFlightWebUi.delete(webUiConfirmationKey);
                        return {
                            kind: 'error',
                            text: runLang === 'en'
                                ? `No usable handoff is available; the preview may have expired. Run /bridge ${target}, review it, then add --go.`
                                : `没有可用的摘要（预览可能已过期）。先跑 /bridge ${target} 看一眼，确认后再 --go。`,
                        };
                    }
                    const fileToLock = (usedPending ?? consumedPending)?.file ?? parsed.file;
                    const lockKey = fileToLock ? fileKeyOf(fileToLock) : undefined;
                    let diskClaim;
                    if (fileToLock && lockKey) {
                        const locked = migratingFiles.has(lockKey) ? 'busy' : (deps.claimSummary ?? claimSummaryFile)(fileToLock);
                        if (typeof locked === 'string') {
                            restorePending(consumedPending ?? usedPending);
                            if (webUiConfirmationKey)
                                inFlightWebUi.delete(webUiConfirmationKey);
                            return claimDenied(locked, runLang);
                        }
                        diskClaim = locked;
                        migratingFiles.add(lockKey);
                    }
                    // 认领到手之后、下一次 await 之前标记其余预览。认领失败不会走到这里。
                    if (usedPending || consumedPending)
                        skipOlderAutomatic(sessionId, target);
                    try {
                        const sourceTitle = titleOf(sourceSession);
                        const targetTitle = sourceTitle ? migratedTitle(sourceTitle, target) : (runLang === 'en' ? `Migrated to ${target}` : migratedTitle(sourceTitle, target));
                        const result = await executeMigration(host, {
                            sessionId,
                            sourceSession,
                            to: target,
                            summary,
                            goalRounds: parsed.goalRounds ?? config.goalRounds,
                            inject: parsed.inject ?? config.inject,
                            title: targetTitle,
                            autoContinue: parsed.autoContinue,
                            lang: runLang,
                            onProgress: reportProgress,
                        });
                        const kept = result.kickoffSent ? diskClaim?.complete() : diskClaim?.seal();
                        if (diskClaim?.interrupted)
                            result.warnings.push(claimWarning('interrupted', runLang));
                        if (kept === false)
                            result.warnings.push(claimWarning('lost', runLang));
                        if (result.kickoffSent) {
                            const delivered = usedPending ?? consumedPending;
                            if (delivered)
                                completeDelivery(delivered);
                            else if (parsed.file)
                                rememberDeliveredFile(parsed.file);
                        }
                        else {
                            const undelivered = usedPending ?? consumedPending;
                            if (undelivered) {
                                undelivered.retainFile = true;
                                pending.set(undelivered.id, undelivered);
                            }
                        }
                        const lines = runLang === 'en'
                            ? [
                                `Created a new session in the ${result.agentPreset} preset from ${source}.`,
                                `Target session: ${targetTitle} · ${result.sessionId}`,
                                result.kickoffSent
                                    ? (parsed.autoContinue
                                        ? 'The handoff goal is paused; the new session will restate and continue in the same request without an extra goal round.'
                                        : 'The new session will only restate the handoff, then wait for your confirmation.')
                                    : 'The new session did not start automatically; inspect the warnings below before continuing manually.',
                                'The source session is untouched and remains available; archive the target if the handoff is unsatisfactory.',
                            ]
                            : [
                                `已在 ${result.agentPreset} 模式下建好新会话，摘要来自${source}。`,
                                `目标会话：${targetTitle} · ${result.sessionId}`,
                                result.kickoffSent
                                    ? (parsed.autoContinue
                                        ? '交接目标已暂停；新会话会在同一轮复述理解并继续下一步，不触发额外 goal 轮次。'
                                        : '新会话只会复述理解，然后暂停等待你确认。')
                                    : '新会话没有自动启动；请按下面的警告检查后手动继续。',
                                '原会话原封不动，随时点回来；新会话不满意就归档。',
                            ];
                        if (result.imagesSent) {
                            lines.push(runLang === 'en'
                                ? `Images: ${result.imagesSent} unresolved source image(s) were attached to the vision target kickoff.`
                                : `图片：${result.imagesSent} 张尚未解析的原图已随 kickoff 搬到视觉目标。`);
                        }
                        for (const warning of result.warnings)
                            lines.push(`⚠ ${warning}`);
                        const commandResult = { kind: 'success', text: lines.join('\n') };
                        if (parsed.summary64 && parsed.previewId && webUiConfirmationKey) {
                            completedWebUi.set(webUiConfirmationKey, {
                                previewId: parsed.previewId,
                                preset: target,
                                payload: parsed.summary64,
                                at: now(),
                                result: commandResult,
                            });
                            inFlightWebUi.delete(webUiConfirmationKey);
                        }
                        return commandResult;
                    }
                    catch (error) {
                        diskClaim?.release();
                        if (webUiConfirmationKey)
                            inFlightWebUi.delete(webUiConfirmationKey);
                        // 没送达就不删文件。放置失败、创建失败和其他错误都把预览放回去，方便重试。
                        restorePending(consumedPending ?? usedPending);
                        return { kind: 'error', text: describe(error) };
                    }
                    finally {
                        if (lockKey)
                            migratingFiles.delete(lockKey);
                    }
                }
                /* ---------------- 预览 ---------------- */
                if (previewingSessions.has(sessionId))
                    return {
                        kind: 'error',
                        text: initialLang === 'en'
                            ? 'A Bridge preview is already being prepared for this session. Wait for it to finish.'
                            : '当前会话正在生成 Bridge 预览，请等待本次生成完成。',
                    };
                previewingSessions.add(sessionId);
                const startedAt = now();
                let stage = initialLang === 'en' ? 'Preparing the handoff…' : '正在准备交接…';
                const beatEvery = deps.progressHeartbeatMs ?? DEFAULT_PROGRESS_HEARTBEAT_MS;
                let heartbeat;
                if (deps.onProgress && beatEvery > 0) {
                    const wallStart = Date.now();
                    heartbeat = setInterval(() => {
                        const elapsed = Math.round((Date.now() - wallStart) / 1000);
                        reportProgress(initialLang === 'en'
                            ? `Still working: ${stage} (${elapsed}s)`
                            : `仍在进行：${stage}（${elapsed}s）`);
                    }, beatEvery);
                    heartbeat.unref();
                }
                try {
                    const preview = await previewMigration(host, {
                        ...(invocation.signal ? { signal: invocation.signal } : {}),
                        cleanupHostFor: signal => resolveCommandHost(deps, signal),
                        ...(deps.workerSessionIds ? { workerSessionIds: deps.workerSessionIds } : {}),
                        sessionId,
                        sourceSession,
                        tier: parsed.tier ?? config.modelTier,
                        sourceCharBudget: config.sourceCharBudget,
                        summaryCharBudget: config.summaryCharBudget,
                        lang: parsed.lang ?? config.lang,
                        workerTimeoutMs: config.previewTimeoutMs,
                        pollMs: deps.pollMs ?? 750,
                        ...(config.workerProvider ? { provider: config.workerProvider } : {}),
                        ...(config.workerModel ? { model: config.workerModel } : {}),
                        onProgress: (message) => {
                            stage = message;
                            reportProgress(message);
                        },
                    });
                    // A Host adapter may settle despite caller cancellation. Do not publish
                    // or retain a late preview that a later confirmation could consume.
                    invocation.signal?.throwIfAborted();
                    const previewId = randomUUID();
                    let file;
                    let summaryFileError;
                    if (deps.writeSummary) {
                        try {
                            file = deps.writeSummary(sessionId, preview.summary);
                            if (!file)
                                summaryFileError = '';
                        }
                        catch (error) {
                            summaryFileError = describe(error).replace(/\s+/gu, ' ').slice(0, 300);
                        }
                    }
                    stashPending({
                        id: previewId,
                        sessionId,
                        preset: target,
                        summary: preview.summary,
                        lang: preview.lang,
                        at: now(),
                        ...(file ? { file } : {}),
                    });
                    pruneCompletedWebUi();
                    const s = preview.source;
                    const outputLang = preview.lang;
                    const summaryBudget = estimateSummaryTokens(s.text.length, {
                        summaryCharBudget: config.summaryCharBudget,
                    }).output;
                    // 输出上限就是写进压缩指令的 token 预算，可以核对。输入侧是字符粗估，不当成费用展示。
                    const budgetSuffix = Number.isFinite(summaryBudget)
                        ? (outputLang === 'en' ? ` · summary budget ≤${summaryBudget} tokens` : ` · 摘要预算 ≤${summaryBudget} tokens`)
                        : '';
                    const lines = outputLang === 'en'
                        ? [
                            `─── Handoff · ${current ?? 'current preset'} → ${target} (review numbers and paths) ───`,
                            preview.summary,
                            '───────────────────────────────────────────',
                            `Source ${s.text.length} chars · user messages ${s.userMessagesUsed}/${s.userMessagesTotal}`
                                + `${s.reusedCompaction ? ' · reused compaction' : ''}`
                                + ` · worker ${preview.worker.model || '(session default)'} · ${Math.round((now() - startedAt) / 1000)}s`
                                + budgetSuffix,
                            `Preview ID: ${previewId}`,
                        ]
                        : [
                            `─── 交接摘要 · ${current ?? '当前模式'} → ${target}（请过目，重点看数字与路径）───`,
                            preview.summary,
                            '───────────────────────────────────────────',
                            `取材 ${s.text.length} 字符 · 用户消息 ${s.userMessagesUsed}/${s.userMessagesTotal} 条`
                                + `${s.reusedCompaction ? ' · 复用了 compaction 底稿' : ''}`
                                + ` · 压缩模型 ${preview.worker.model || '（会话默认）'} · 用时 ${Math.round((now() - startedAt) / 1000)}s`
                                + budgetSuffix,
                            `预览 ID：${previewId}`,
                        ];
                    if (s.visualEvidence.images) {
                        lines.push(outputLang === 'en'
                            ? `Images ${s.visualEvidence.images} / ${s.visualEvidence.imageMessages} messages`
                                + ` · represented ${s.visualEvidence.represented} · unresolved ${s.visualEvidence.unresolved}`
                            : `图片 ${s.visualEvidence.images} 张 / ${s.visualEvidence.imageMessages} 条消息`
                                + ` · 有关联原文 ${s.visualEvidence.represented} 条 · 未解析 ${s.visualEvidence.unresolved} 条`);
                    }
                    if (s.truncated) {
                        lines.push(outputLang === 'en'
                            ? `⚠ Source material was truncated by budget (${s.dropped.join(' / ')}); this handoff reflects the bounded history.`
                            : `⚠ 取材因预算被裁剪（${s.dropped.join(' / ')}），摘要是基于被裁过的历史写的`);
                    }
                    if (preview.capped)
                        lines.push(outputLang === 'en' ? '⚠ The summary worker timed out; the handoff uses the text produced before cancellation.' : '⚠ 压缩工人超时被取消，摘要按已产出文本计');
                    lines.push('');
                    lines.push(outputLang === 'en' ? `Review and run: /bridge ${target} --go` : `没问题就执行：/bridge ${target} --go`);
                    if (file) {
                        lines.push(outputLang === 'en'
                            ? `Edit first: update ${file}, then run /bridge ${target} --go --file ${file}`
                            : `要改：编辑 ${file} 之后 /bridge ${target} --go --file ${file}`);
                    }
                    else if (summaryFileError !== undefined) {
                        const reason = summaryFileError || (outputLang === 'en' ? 'no path was returned' : '没有返回路径');
                        lines.push(outputLang === 'en'
                            ? `⚠ The summary file was not saved (${reason}). Next: review the summary above and run /bridge ${target} --go; if this view cannot edit it, copy the summary into a file and run /bridge ${target} --go --file <path>.`
                            : `⚠ 摘要文件没有保存（${reason}）。下一步：核对上面的摘要后执行 /bridge ${target} --go；如果当前界面不能编辑，把摘要复制到文件再执行 /bridge ${target} --go --file <路径>。`);
                    }
                    return { kind: 'success', text: lines.join('\n') };
                }
                catch (error) {
                    const text = previewFailureText(error, initialLang, target) ?? describe(error);
                    const cleanup = error instanceof RpcError ? error.details?.cleanupFailure : undefined;
                    return { kind: 'error', text: cleanup
                            ? `${text}\n${initialLang === 'en' ? 'Worker cleanup also failed' : '工人清理也未完成'}: ${cleanup.message}`
                            : text };
                }
                finally {
                    previewingSessions.delete(sessionId);
                    if (heartbeat)
                        clearInterval(heartbeat);
                }
            }
            finally {
                releaseSummary(heldSummary);
            }
        },
    };
}
function claimDenied(status, lang) {
    if (status === 'delivered') {
        return {
            kind: 'error',
            text: lang === 'en'
                ? 'This preview was already handed off. Open that target session instead of migrating the same file again.'
                : '这份预览已经交接过了。请打开目标会话，不要用同一份文件再迁一次。',
        };
    }
    if (status === 'held') {
        return {
            kind: 'error',
            text: lang === 'en'
                ? 'This preview was already used for a handoff that did not fully start. Open that target session instead of migrating the same file again.'
                : '这份预览已经用于一次没有完整送达的交接。请打开已创建的目标会话，不要用同一份文件再迁一次。',
        };
    }
    if (status === 'busy') {
        return {
            kind: 'error',
            text: lang === 'en'
                ? 'This preview is already being migrated. Wait for that handoff to finish.'
                : '这份预览正在交接，请等它结束。',
        };
    }
    return {
        kind: 'error',
        text: lang === 'en'
            ? 'This summary file could not be locked. Try again in a moment.'
            : '暂时无法锁定这份摘要，请稍后再试。',
    };
}
/** Turn a worker failure from `previewMigration` into the host's reason plus one concrete next step. */
function previewFailureText(error, lang, target) {
    if (!(error instanceof RpcError) || error.method !== 'bridge.preview')
        return undefined;
    const details = (error.details ?? {});
    const end = details.turnEnd;
    const seconds = Math.round((details.waitedMs ?? 0) / 1000);
    const rerun = `/bridge ${target}`;
    const en = lang === 'en';
    switch (error.code) {
        case 'worker-failed': {
            const code = end?.code ?? 'UNKNOWN';
            const next = code === 'MISSING_CREDENTIAL'
                ? (en ? `Next: enter the API key on the Models page of the WebUI settings, then run ${rerun} again.` : `下一步：在 WebUI 设置的「模型」页填入 API 密钥，再重新运行 ${rerun}。`)
                : code === 'INVALID_CREDENTIAL'
                    ? (en ? `Next: correct the API key on the Models page of the WebUI settings, then run ${rerun} again.` : `下一步：在 WebUI 设置的「模型」页改正 API 密钥，再重新运行 ${rerun}。`)
                    : (en ? `Next: resolve the host error above, then run ${rerun} again.` : `下一步：处理上面的宿主错误后，重新运行 ${rerun}。`);
            return [
                en ? `Preview failed: the summary worker's model request failed (${code}).` : `预览失败：压缩工人请求模型出错（${code}）。`,
                ...(end?.message ? [en ? `Host message: ${end.message}` : `宿主原因：${end.message}`] : []),
                next,
            ].join('\n');
        }
        case 'worker-timeout':
            return en
                ? `Preview failed: the summary worker did not finish within ${seconds} s and was cancelled.\n`
                    + `Next: run ${rerun} again. For very long sessions, restart dsh web with a larger DSH_BRIDGE_PREVIEW_TIMEOUT (milliseconds).`
                : `预览失败：压缩工人 ${seconds} 秒内没写完，已取消。\n`
                    + `下一步：重新运行 ${rerun}。会话特别长时，可以带上更大的 DSH_BRIDGE_PREVIEW_TIMEOUT（毫秒）重启 dsh web。`;
        case 'worker-not-started':
            return en
                ? `Preview failed: the summary worker did not start within ${seconds} s; the host may still be starting or busy.\nNext: wait a moment, then run ${rerun} again.`
                : `预览失败：压缩工人 ${seconds} 秒内没有开始运行，宿主可能还在启动或忙。\n下一步：稍等片刻，再重新运行 ${rerun}。`;
        case 'worker-aborted':
            return en
                ? `Preview failed: the summary worker's turn was cancelled (${end?.cause ?? end?.kind ?? 'unknown'}).\nNext: run ${rerun} again.`
                : `预览失败：压缩工人这一轮被取消了（${end?.cause ?? end?.kind ?? '原因未知'}）。\n下一步：重新运行 ${rerun}。`;
        case 'worker-empty':
            return en
                ? `Preview failed: the summary worker finished without writing a handoff${end ? ` (turn ended: ${end.kind})` : ''}.\n`
                    + `Next: run ${rerun} again; if it keeps happening, try another worker model with ${rerun} --tier pro.`
                : `预览失败：压缩工人跑完了，但没有写出交接摘要${end ? `（本轮结束原因：${end.kind}）` : ''}。\n`
                    + `下一步：重新运行 ${rerun}；反复出现时，换个压缩模型试试：${rerun} --tier pro。`;
        default:
            return undefined;
    }
}
function describe(error) {
    if (error instanceof RpcError)
        return error.message;
    return error instanceof Error ? error.message : String(error);
}
