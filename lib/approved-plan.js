/** Native plan-review handoff. Approval belongs to one live review, never to model prose. */
import { createHash, randomUUID } from 'node:crypto';
import { MAX_APPROVED_PLAN_CHARS } from './client-contract.js';
import { executeMigration, findSession, foldedHistory, listPresets, resolvePresetTarget } from './migrate.js';
const APPROVAL_TTL_MS = 30 * 60_000;
const MAX_APPROVALS = 64;
const MAX_PAYLOAD_CHARS = 1_024_000;
const object = (value) => value !== null && typeof value === 'object' ? value : undefined;
const nativeKey = (sourceId, callId) => JSON.stringify([sourceId, callId]);
function decodePayload(encoded) {
    if (encoded.length > MAX_PAYLOAD_CHARS || !/^[A-Za-z0-9+/_-]+={0,2}$/u.test(encoded)) {
        throw new Error('Invalid approved-plan payload.');
    }
    const bytes = Buffer.from(encoded, 'base64url');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes))
        throw new Error('Invalid approved-plan UTF-8.');
    const value = object(JSON.parse(text));
    if (!value || Object.keys(value).some(key => key !== 'callId' && key !== 'plan')
        || typeof value.callId !== 'string' || !/^[^\s]{1,512}$/u.test(value.callId)
        || typeof value.plan !== 'string' || !value.plan.trim() || value.plan.length > MAX_APPROVED_PLAN_CHARS) {
        throw new Error('Invalid approved-plan document or review identity.');
    }
    return { callId: value.callId, plan: value.plan };
}
function reviewedPlan(request) {
    if (request.signal?.aborted || request.questions?.length !== 1)
        return undefined;
    const question = object(request.questions[0]);
    const intent = object(question?.intent);
    if (intent?.kind !== 'plan-review' || typeof intent.callId !== 'string' || !intent.callId
        || typeof intent.approve !== 'string' || typeof question?.detail !== 'string'
        || !question.detail.trim() || question.detail.length > MAX_APPROVED_PLAN_CHARS
        || question.multiSelect === true || !Array.isArray(question.options)
        || !question.options.some(option => object(option)?.label === intent.approve))
        return undefined;
    return { callId: intent.callId, plan: question.detail };
}
/** Observe the public question waterfall without answering ordinary reviews or changing their options. */
export function createPlanApprovalBridge(deps) {
    const reviews = new Map();
    const approved = new Map();
    const now = deps.now ?? Date.now;
    let disposed = false;
    const prune = () => {
        for (const [id, record] of approved) {
            if (!record.inFlight && now() - record.at >= APPROVAL_TTL_MS) {
                approved.delete(id);
                reviews.delete(nativeKey(record.sourceId, record.callId));
            }
        }
        for (const [id, record] of approved) {
            if (approved.size <= MAX_APPROVALS)
                break;
            if (!record.inFlight) {
                approved.delete(id);
                reviews.delete(nativeKey(record.sourceId, record.callId));
            }
        }
    };
    const failure = (lang, en, zh) => ({ kind: 'error', text: lang === 'en' ? en : zh });
    const userState = async (host, sourceId) => {
        const users = (await foldedHistory(host, sourceId)).filter(message => message.role === 'user').map(message => message.content);
        return {
            fingerprint: createHash('sha256').update(JSON.stringify(users)).digest('hex'),
            context: users.join('\n\n').slice(-Math.min(deps.config.sourceCharBudget, 12_000)),
        };
    };
    const run = async (record, host, source, lang) => {
        try {
            const state = await userState(host, record.sourceId);
            if (record.userFingerprint !== undefined && record.userFingerprint !== state.fingerprint) {
                return failure(lang, 'The source user requests changed. Review a new plan before executing.', '原会话的用户要求已变更，请重新评审计划后执行。');
            }
            record.userFingerprint ??= state.fingerprint;
            record.sourceContext ??= state.context;
            if (!record.sourceStopped) {
                // Cancellation ends the source's blocking exit_plan_mode call while leaving plan/mode active.
                // The observer refuses a concurrent native Approve answer once this record is claimed.
                await host.sessions.cancel({ sessionId: record.sourceId });
                record.sourceStopped = true;
            }
            const preset = record.preset;
            const heading = /^#{1,6}\s+(.+)$/mu.exec(record.plan)?.[1]?.trim().slice(0, 160)
                ?? (lang === 'en' ? 'Approved plan' : '已批准计划');
            const title = `${heading} → ${preset}`;
            const result = await executeMigration(host, {
                sessionId: record.sourceId, sourceSession: source, to: preset, summary: record.plan,
                executionKind: 'approved-plan', sourceContext: record.sourceContext,
                lang, autoContinue: true, inject: deps.config.inject, goalRounds: deps.config.goalRounds, title,
            });
            const lines = lang === 'en' ? [
                `Created a new session in the ${result.agentPreset} preset for the approved plan.`,
                `Target session: ${title} · ${result.sessionId}`,
                result.kickoffSent ? 'The complete approved plan is being executed in the new session; the handoff goal stays paused.'
                    : 'The target exists but automatic execution could not be confirmed. Open it and inspect the warnings.',
                'The original planning turn was stopped; the source session remains in plan mode for reference.',
            ] : [
                `已在 ${result.agentPreset} 模式下建好新会话，执行已批准的完整计划。`,
                `目标会话：${title} · ${result.sessionId}`,
                result.kickoffSent ? '完整计划已逐字交接，新会话开始执行；交接目标保持暂停。'
                    : '执行会话已创建，但无法确认自动执行已启动；请打开目标并检查警告。',
                '原规划轮次已停止，原会话仍保留在计划模式，供查阅和继续规划。',
            ];
            for (const warning of result.warnings)
                lines.push(`⚠ ${warning}`);
            record.result = { kind: 'success', text: lines.join('\n') };
            return record.result;
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            if (!record.sourceStopped && record.live) {
                record.claimed = false;
                if (record.approvalId)
                    approved.delete(record.approvalId);
                delete record.approvalId;
                return failure(lang, `Could not stop the planning turn: ${detail}`, `无法停止原规划轮次：${detail}`);
            }
            const retry = `/bridge --approved-plan ${record.approvalId ?? ''} --lang ${lang}`;
            return failure(lang, `Could not create the execution session: ${detail}\nRetry the approved plan: ${retry}`, `执行会话创建失败：${detail}\n重试已批准计划：${retry}`);
        }
    };
    return {
        observe: async (request, next) => {
            const plan = disposed ? undefined : reviewedPlan(request);
            const sourceId = request.agent?.session?.id ?? request.agent?.session?.header?.id;
            if (!plan || !sourceId)
                return next();
            const key = nativeKey(sourceId, plan.callId);
            // A second answerer request must not replace a claim in progress.
            if (reviews.has(key))
                return next();
            const record = { ...plan, sourceId, live: true, claimed: false, sourceStopped: false, at: now() };
            reviews.set(key, record);
            try {
                const answer = await next();
                if (record.claimed)
                    throw new Error('Bridge owns this plan approval; execution belongs to a new session.');
                return answer;
            }
            finally {
                record.live = false;
                if (!record.claimed && reviews.get(key) === record)
                    reviews.delete(key);
            }
        },
        execute: async (input) => {
            const lang = input.lang;
            if (disposed)
                return failure(lang, 'Bridge plan approval is unavailable after unload.', 'Bridge 已卸载，无法接收计划批准。');
            prune();
            let record;
            try {
                if (input.approvePlan64 !== undefined) {
                    const plan = decodePayload(input.approvePlan64);
                    record = reviews.get(nativeKey(input.sessionId, plan.callId));
                    if (!record || record.plan !== plan.plan || (!record.live && !record.claimed)) {
                        return failure(lang, 'This exact plan is no longer awaiting approval. Reopen a current plan review.', '这份计划已不在等待批准，或内容已变更；请重新打开当前计划评审。');
                    }
                }
                else if (input.approvedPlanId !== undefined) {
                    record = approved.get(input.approvedPlanId);
                    if (!record || record.sourceId !== input.sessionId)
                        return failure(lang, 'No approved plan is bound to this session; review it again.', '当前会话没有这份有效的批准记录，请重新评审计划。');
                }
                if (!record)
                    return failure(lang, 'No plan approval was supplied.', '没有收到计划批准。');
                if (record.result)
                    return record.result;
                if (record.inFlight)
                    return record.inFlight;
                const host = deps.hostFor(input.signal);
                const source = await findSession(host, input.sessionId);
                if (!source)
                    return failure(lang, 'The source session is unavailable.', '读不到原计划会话。');
                const presets = await listPresets(host);
                const requested = input.preset ?? record.preset ?? source.agentPreset;
                if (!requested)
                    return failure(lang, 'Choose an execution preset.', '请指定新执行会话的模式。');
                const preset = resolvePresetTarget(requested, presets);
                if (!presets.some(p => p.id === preset))
                    return failure(lang, `No usable execution preset named ${preset}.`, `没有可用的执行模式 ${preset}。`);
                // An asynchronous source/preset lookup can race another approval or the native decision.
                if (record.result)
                    return record.result;
                if (record.inFlight)
                    return record.inFlight;
                if (!record.live && !record.claimed)
                    return failure(lang, 'The plan review already settled.', '这份计划评审已经结束。');
                record.preset = preset;
                record.claimed = true;
                record.approvalId ??= randomUUID();
                record.at = now();
                approved.set(record.approvalId, record);
                const selected = record;
                const operation = run(selected, host, source, lang);
                selected.inFlight = operation;
                try {
                    return await operation;
                }
                finally {
                    delete selected.inFlight;
                }
            }
            catch (error) {
                return failure(lang, `Invalid plan approval: ${error instanceof Error ? error.message : String(error)}`, `计划批准无效：${error instanceof Error ? error.message : String(error)}`);
            }
        },
        dispose: () => { disposed = true; reviews.clear(); approved.clear(); },
    };
}
