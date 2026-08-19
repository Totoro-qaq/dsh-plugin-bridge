/**
 * 迁移编排：取材 → 压缩工人 → 目标会话。
 *
 * 只依赖注入进来的 `Rpc`，不碰 process / argv / 文件系统，所以可以对着一个
 * 假的 RPC（见 test/migrate.test.mjs）跑完整条链路而不烧任何 token。
 * CLI（`cli.ts`）与客户端 GUI 都消费这里的函数，保证「被验证的」和
 * 「被交付的」是同一条代码路径。
 */
import { buildBridgeInstruction, buildBridgeKickoff, buildBridgeSource, detectLang, } from './compression.js';
import { foldSessionEvents } from './fold.js';
import { RpcError, sleep } from './rpc.js';
/** 工人会话优先使用的 preset（工具越少越省，也不会误动工作区）。 */
const WORKER_PRESET_PREFERENCE = ['minimal', 'standard'];
/** 每页拉多少条消息、最多翻几页。 */
const HISTORY_PAGE_MESSAGES = 60;
const HISTORY_MAX_PAGES = 4;
/* ---------------------------------------------------------------- 基础查询 */
/**
 * 列出全部会话。
 *
 * `session.list` 的 v1 一次返回全部，`cursor` 是预留位；这里仍按 cursor 取完，
 * 免得上游哪天真的分页之后这里悄悄只看第一页。
 */
export async function listSessions(rpc) {
    const rows = [];
    let cursor;
    for (let page = 0; page < 20; page += 1) {
        const res = await rpc('session.list', cursor === undefined ? {} : { cursor });
        rows.push(...(res.items ?? []));
        if (!res.nextCursor)
            break;
        cursor = res.nextCursor;
    }
    return rows;
}
export async function findSession(rpc, sessionId) {
    return (await listSessions(rpc)).find((row) => row.sessionId === sessionId);
}
/** 找出会话所属工作区；找不到就返回 undefined（调用方退回用 cwd 建会话）。 */
export async function findWorkspaceId(rpc, sessionId) {
    const res = await rpc('workspace.list', {});
    return res.items?.find((ws) => ws.sessionIds?.includes(sessionId))?.workspaceId;
}
/** 可作为迁移目标的 preset（去掉 broken 的）。 */
export async function listPresets(rpc) {
    const res = await rpc('agentPreset.list', {});
    return (res.presets ?? []).filter((preset) => preset.broken === undefined);
}
/** 新会话的落点：优先同工作区，否则同 cwd，再否则交给 host 默认。 */
async function placement(rpc, source, sessionId) {
    const workspaceId = await findWorkspaceId(rpc, sessionId).catch(() => undefined);
    if (workspaceId)
        return { workspaceId };
    if (source?.cwd)
        return { cwd: source.cwd };
    return {};
}
/**
 * 选压缩工人的模型。
 *
 * 不写死任何 provider/model：先读源会话的模型目录，再按档位在**同一 provider**
 * 里挑。挑不到就退回源会话当前模型——档位是省钱偏好，不该成为换 provider 的人
 * 装不上的理由。
 */
export async function resolveWorkerModel(rpc, sessionId, tier, override = {}) {
    if (override.provider && override.model) {
        return { provider: override.provider, model: override.model, reason: 'configured' };
    }
    const models = await rpc('session.models', { sessionId });
    const current = models.current;
    const fallback = {
        provider: override.provider ?? current?.provider ?? '',
        model: override.model ?? current?.model ?? '',
        reason: 'fallback-current',
    };
    if (tier === 'current')
        return { ...fallback, reason: 'follow-session' };
    const group = models.groups?.find((g) => g.id === current?.provider) ?? models.groups?.[0];
    const ids = (group?.models ?? []).map((m) => m.id);
    const pattern = tier === 'flash'
        ? /flash|mini|lite|small|haiku|turbo/i
        : /pro|max|opus|large|reasoner|thinking/i;
    const hit = ids.find((id) => pattern.test(id));
    if (group && hit)
        return { provider: group.id, model: hit, reason: `tier:${tier}` };
    return fallback;
}
/** 压缩工人用哪个 preset：优先 minimal，其次 standard，再否则 host 默认。 */
export async function resolveWorkerPreset(rpc) {
    const presets = await listPresets(rpc).catch(() => []);
    for (const wanted of WORKER_PRESET_PREFERENCE) {
        if (presets.some((preset) => preset.id === wanted))
            return wanted;
    }
    return presets.find((preset) => preset.isDefault)?.id;
}
/**
 * 等一个会话回到空闲。
 *
 * 旧实现是「先 sleep 2s，再看 running 是不是 false」——host 排队稍慢一点，
 * 第一次轮询就会把「还没开始」误判成「已经跑完」，取到的是上一轮的回答。
 * 这里先等它真的 running 起来（有宽限期），再等它落回 false。
 */
export async function waitIdle(rpc, sessionId, options = {}) {
    const pollMs = options.pollMs ?? 2000;
    const deadline = Date.now() + (options.timeoutMs ?? 360_000);
    const startBy = Date.now() + (options.startGraceMs ?? 25_000);
    let started = false;
    while (Date.now() < deadline) {
        await sleep(pollMs);
        const row = await findSession(rpc, sessionId).catch(() => undefined);
        if (row?.running) {
            started = true;
            continue;
        }
        if (started)
            return { idle: true, started: true };
        if (Date.now() > startBy)
            return { idle: true, started: false };
    }
    return { idle: false, started };
}
/** 拉取并折叠会话历史（按需翻页）。 */
export async function foldedHistory(rpc, sessionId, options = {}) {
    const pageMessages = options.pageMessages ?? HISTORY_PAGE_MESSAGES;
    const maxPages = options.maxPages ?? HISTORY_MAX_PAGES;
    let events = [];
    let beforeSeq;
    for (let page = 0; page < maxPages; page += 1) {
        const res = await rpc('session.history', { sessionId, maxMessages: pageMessages, ...(beforeSeq === undefined ? {} : { beforeSeq }) }, 60_000);
        const chunk = (res.events ?? []).map((entry) => entry.event);
        if (!chunk.length)
            break;
        events = [...chunk, ...events];
        if (!res.hasMore)
            break;
        const first = chunk[0]?.seq;
        if (typeof first !== 'number')
            break;
        beforeSeq = first;
    }
    return foldSessionEvents(events);
}
/** 会话里最后一条非空 assistant 文本。 */
export async function lastAssistantText(rpc, sessionId) {
    const messages = await foldedHistory(rpc, sessionId, { pageMessages: 20, maxPages: 1 });
    return [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content.trim() ?? '';
}
/** 生成交接摘要：取材 → 起临时工人 → 收摘要 → 归档工人。 */
export async function previewMigration(rpc, options) {
    const progress = options.onProgress ?? (() => { });
    const sourceSession = await findSession(rpc, options.sessionId);
    progress('拉取并折叠会话历史…');
    const messages = await foldedHistory(rpc, options.sessionId);
    const source = buildBridgeSource(messages, { sourceCharBudget: options.sourceCharBudget });
    if (!source.text.trim()) {
        throw new RpcError('bridge.preview', 'empty-source', '这个会话还没有可迁移的内容（取材为空）。直接开一个新会话更省事。');
    }
    const lang = options.lang && options.lang !== 'auto' ? options.lang : detectLang(source.text);
    const tier = options.tier ?? 'pro';
    const route = await resolveWorkerModel(rpc, options.sessionId, tier, options);
    if (options.dryRun) {
        return { summary: '', source, lang, worker: { ...route }, capped: false, sourceSession };
    }
    const preset = await resolveWorkerPreset(rpc);
    const where = await placement(rpc, sourceSession, options.sessionId);
    progress(`起压缩工人（${preset ?? '默认 preset'} / ${route.model || '会话默认模型'}）…`);
    const worker = await rpc('session.create', {
        ...where,
        ...(preset === undefined ? {} : { agentPreset: preset }),
    });
    let capped = false;
    try {
        if (route.provider && route.model) {
            await rpc('session.selectModel', { sessionId: worker.sessionId, provider: route.provider, model: route.model })
                .catch((error) => {
                // 选模型失败不该让整次迁移失败：工人用会话默认模型照样能写摘要。
                progress(`选模型失败，改用默认模型（${error instanceof Error ? error.message : String(error)}）`);
            });
        }
        const instruction = buildBridgeInstruction(lang, { summaryCharBudget: options.summaryCharBudget });
        await rpc('session.prompt', {
            sessionId: worker.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: `${instruction}${source.text}` }],
        });
        progress('等待摘要…');
        const settled = await waitIdle(rpc, worker.sessionId, {
            timeoutMs: options.workerTimeoutMs ?? 360_000,
            ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs, startGraceMs: options.pollMs * 6 }),
        });
        if (!settled.idle) {
            capped = true;
            await rpc('session.cancel', { sessionId: worker.sessionId }).catch(() => undefined);
            await sleep(2500);
        }
        const summary = await lastAssistantText(rpc, worker.sessionId);
        if (!summary) {
            throw new RpcError('bridge.preview', 'worker-empty', '压缩工人没有产出摘要（可能是模型不可用或被取消）。');
        }
        return {
            summary,
            source,
            lang,
            worker: { sessionId: worker.sessionId, ...route, preset },
            capped,
            sourceSession,
        };
    }
    finally {
        // 工人是一次性的：无论成败都归档，不在侧栏留垃圾。
        await rpc('workspace.archiveSession', { sessionId: worker.sessionId }).catch(() => undefined);
    }
}
/**
 * 建目标会话并交接。
 *
 * 注入方式说明：`goal.create` 本身**不会**把目标注入模型上下文（上游
 * `dsh-goal` README：「Goal mutations do not inject model context」），
 * 摘要能被模型看见依赖 goal-round-driver 把它渲染成 `<goal_round>` 提示，
 * 或模型主动调 `get_goal`。所以默认把摘要同时放进首轮提示：任何组装下都成立。
 */
export async function executeMigration(rpc, options) {
    const progress = options.onProgress ?? (() => { });
    const warnings = [];
    const inject = options.inject ?? 'both';
    const lang = options.lang ?? detectLang(options.summary);
    const summary = options.summary.trim();
    if (!summary)
        throw new RpcError('bridge.migrate', 'empty-summary', '摘要为空，拒绝迁移。');
    const sourceSession = await findSession(rpc, options.sessionId);
    const where = await placement(rpc, sourceSession, options.sessionId);
    progress(`在 ${options.to} 模式下新建会话…`);
    const created = await rpc('session.create', {
        ...where,
        agentPreset: options.to,
    });
    let titled = false;
    if (options.title) {
        try {
            await rpc('session.rename', { sessionId: created.sessionId, title: options.title });
            titled = true;
        }
        catch (error) {
            warnings.push(`改标题失败（不影响迁移）：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    let goalCreated = false;
    if (inject === 'goal' || inject === 'both') {
        try {
            await rpc('goal.create', {
                sessionId: created.sessionId,
                objective: summary,
                maxGoalRounds: options.goalRounds ?? 1,
            });
            goalCreated = true;
        }
        catch (error) {
            // 没挂 goal 服务的部署也应该能迁移：摘要还会走首轮提示。
            warnings.push(`挂载会话目标失败，摘要改由首轮提示携带：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (options.kickoff !== false) {
        const carriesSummary = inject === 'prompt' || inject === 'both' || !goalCreated;
        const text = carriesSummary
            ? `${handoffPreamble(lang)}\n\n${summary}\n\n${buildBridgeKickoff(lang)}`
            : buildBridgeKickoff(lang);
        progress('发送首轮交接指令…');
        await rpc('session.prompt', {
            sessionId: created.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text }],
        });
    }
    return {
        sessionId: created.sessionId,
        agentPreset: created.agentPreset ?? options.to,
        goalCreated,
        titled,
        warnings,
    };
}
function handoffPreamble(lang) {
    return lang === 'en'
        ? 'Handoff summary from a previous session that ran under a different tool preset:'
        : '以下是上个会话（另一套工具模式）留下的交接摘要：';
}
/** 默认标题：让新会话在侧栏里一眼看得出来源。 */
export function migratedTitle(sourceTitle, to) {
    const base = (sourceTitle ?? '').trim();
    return base ? `${base} → ${to}` : `迁移到 ${to}`;
}
/** 从 session.list 行里尽力取出标题（projection 形状随部署而异）。 */
export function titleOf(row) {
    const value = row?.projections?.values?.['title'];
    if (typeof value === 'string' && value.trim())
        return value.trim();
    if (value && typeof value === 'object' && 'title' in value) {
        const nested = value.title;
        if (typeof nested === 'string' && nested.trim())
            return nested.trim();
    }
    return undefined;
}
