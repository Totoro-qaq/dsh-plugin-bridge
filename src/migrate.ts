/**
 * 迁移编排：取材 → 压缩工人 → 目标会话。
 *
 * 只依赖注入进来的 `Rpc`，不碰 process / argv / 文件系统，所以可以对着一个
 * 假的 RPC（见 test/migrate.test.mjs）跑完整条链路而不烧任何 token。
 * CLI（`cli.ts`）与客户端 GUI 都消费这里的函数，保证「被验证的」和
 * 「被交付的」是同一条代码路径。
 */
import {
  buildBridgeInstruction,
  buildBridgeKickoff,
  buildBridgeSource,
  appendVisualEvidence,
  collectVisualEvidence,
  detectLang,
  type BridgeSource,
} from './compression.ts';
import { foldSessionEvents } from './fold.ts';
import { RpcError, sleep, type Rpc } from './rpc.ts';
import type { ChatMessage, ImageAttachmentRef, SessionEvent } from './types.ts';

export type ModelTier = 'flash' | 'current' | 'pro';
export type InjectMode = 'goal' | 'prompt' | 'both';
export type Lang = 'zh' | 'en' | 'auto';

export interface SessionRow {
  sessionId: string;
  running?: boolean;
  blank?: boolean;
  cwd?: string;
  agentPreset?: string;
  parentSessionId?: string;
  projections?: { values?: Record<string, unknown> };
}

export interface PresetRow {
  id: string;
  trust?: 'system' | 'user';
  isDefault?: boolean;
  name?: string;
  description?: string;
  broken?: string;
}

export interface ModelRoute {
  provider: string;
  model: string;
  /** 为什么选中它：configured / follow-session / tier:<tier> / fallback-current。 */
  reason: string;
}

export interface ModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

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
export async function listSessions(rpc: Rpc): Promise<SessionRow[]> {
  const rows: SessionRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const res = await rpc<{ items?: SessionRow[]; nextCursor?: string }>(
      'session.list',
      cursor === undefined ? {} : { cursor },
    );
    rows.push(...(res.items ?? []));
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return rows;
}

export async function findSession(rpc: Rpc, sessionId: string): Promise<SessionRow | undefined> {
  return (await listSessions(rpc)).find((row) => row.sessionId === sessionId);
}

/** 找出会话所属工作区；找不到就返回 undefined（调用方退回用 cwd 建会话）。 */
export async function findWorkspaceId(rpc: Rpc, sessionId: string): Promise<string | undefined> {
  const res = await rpc<{ items?: { workspaceId: string; sessionIds?: string[] }[] }>('workspace.list', {});
  return res.items?.find((ws) => ws.sessionIds?.includes(sessionId))?.workspaceId;
}

/** 可作为迁移目标的 preset（去掉 broken 的）。 */
export async function listPresets(rpc: Rpc): Promise<PresetRow[]> {
  const res = await rpc<{ presets?: PresetRow[] }>('agentPreset.list', {});
  return (res.presets ?? []).filter((preset) => preset.broken === undefined);
}

/** 新会话的落点：优先同工作区，否则同 cwd，再否则交给 host 默认。 */
async function placement(rpc: Rpc, source: SessionRow | undefined, sessionId: string): Promise<Record<string, string>> {
  const workspaceId = await findWorkspaceId(rpc, sessionId).catch(() => undefined);
  if (workspaceId) return { workspaceId };
  if (source?.cwd) return { cwd: source.cwd };
  return {};
}

/**
 * 选压缩工人的模型。
 *
 * 不写死任何 provider/model：先读源会话的模型目录，再按档位在**同一 provider**
 * 里挑。挑不到就退回源会话当前模型——档位是省钱偏好，不该成为换 provider 的人
 * 装不上的理由。
 */
export async function resolveWorkerModel(
  rpc: Rpc,
  sessionId: string,
  tier: ModelTier,
  override: { provider?: string; model?: string } = {},
): Promise<ModelRoute> {
  if (override.provider && override.model) {
    return { provider: override.provider, model: override.model, reason: 'configured' };
  }
  const models = await rpc<{
    current?: { provider?: string; model?: string };
    groups?: { id: string; models?: { id: string }[] }[];
  }>('session.models', { sessionId });
  const current = models.current;
  const fallback: ModelRoute = {
    provider: override.provider ?? current?.provider ?? '',
    model: override.model ?? current?.model ?? '',
    reason: 'fallback-current',
  };
  if (tier === 'current') return { ...fallback, reason: 'follow-session' };
  const group = models.groups?.find((g) => g.id === current?.provider) ?? models.groups?.[0];
  const ids = (group?.models ?? []).map((m) => m.id);
  const pattern = tier === 'flash'
    ? /flash|mini|lite|small|haiku|turbo/i
    : /pro|max|opus|large|reasoner|thinking/i;
  const hit = ids.find((id) => pattern.test(id));
  if (group && hit) return { provider: group.id, model: hit, reason: `tier:${tier}` };
  return fallback;
}

/** 压缩工人用哪个 preset：优先 minimal，其次 standard，再否则 host 默认。 */
export async function resolveWorkerPreset(rpc: Rpc): Promise<string | undefined> {
  const presets = await listPresets(rpc).catch(() => [] as PresetRow[]);
  for (const wanted of WORKER_PRESET_PREFERENCE) {
    if (presets.some((preset) => preset.id === wanted)) return wanted;
  }
  return presets.find((preset) => preset.isDefault)?.id;
}

export interface WaitOptions {
  timeoutMs?: number;
  /** 等待新 `turn/start` 的宽限期；超过仍未出现就按未启动处理。 */
  startGraceMs?: number;
  pollMs?: number;
  /** 只观察这个事件序号之后的新一轮；worker 新建后通常为 0。 */
  afterSeq?: number;
}

/**
 * 等一个会话的新一轮写入 `turn/end`。
 *
 * `session.list` 是全局列表，拿它每两秒轮询一个 worker 会把会话总量放大成
 * O(会话数 × 轮询次数)。`session.history` 则只读目标会话；用 prompt 前的事件
 * 水位隔开旧轮次后，`turn/start` / `turn/end` 也比易过期的 running 快照更可靠。
 */
export async function waitIdle(
  rpc: Rpc,
  sessionId: string,
  options: WaitOptions = {},
): Promise<{ idle: boolean; started: boolean }> {
  const pollMs = options.pollMs ?? 2000;
  const deadline = Date.now() + (options.timeoutMs ?? 360_000);
  const startBy = Date.now() + (options.startGraceMs ?? 25_000);
  const afterSeq = options.afterSeq ?? 0;
  let started = false;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const events = await tailSessionEvents(rpc, sessionId).catch(() => [] as SessionEvent[]);
    const fresh = events.filter((event) => typeof event.seq === 'number' && event.seq > afterSeq);
    if (fresh.some((event) => event.type === 'turn/start')) started = true;
    if (fresh.some((event) => event.type === 'turn/end')) return { idle: true, started: true };
    if (!started && Date.now() > startBy) return { idle: true, started: false };
  }
  return { idle: false, started };
}

/** 读取单个会话的尾页；不触发全局 session.list 扫描。 */
async function tailSessionEvents(rpc: Rpc, sessionId: string): Promise<SessionEvent[]> {
  const res = await rpc<{ events?: { event: SessionEvent }[] }>(
    'session.history',
    { sessionId, maxMessages: 2 },
    60_000,
  );
  return (res.events ?? []).map((entry) => entry.event);
}

async function latestSessionSeq(rpc: Rpc, sessionId: string): Promise<number> {
  const events = await tailSessionEvents(rpc, sessionId);
  return events.reduce((max, event) => (
    typeof event.seq === 'number' && event.seq > max ? event.seq : max
  ), 0);
}

/** 拉取并折叠会话历史（按需翻页）。 */
export async function foldedHistory(
  rpc: Rpc,
  sessionId: string,
  options: { pageMessages?: number; maxPages?: number } = {},
): Promise<ChatMessage[]> {
  const pageMessages = options.pageMessages ?? HISTORY_PAGE_MESSAGES;
  const maxPages = options.maxPages ?? HISTORY_MAX_PAGES;
  let events: SessionEvent[] = [];
  let beforeSeq: number | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const res = await rpc<{ events?: { event: SessionEvent }[]; hasMore?: boolean }>(
      'session.history',
      { sessionId, maxMessages: pageMessages, ...(beforeSeq === undefined ? {} : { beforeSeq }) },
      60_000,
    );
    const chunk = (res.events ?? []).map((entry) => entry.event);
    if (!chunk.length) break;
    events = [...chunk, ...events];
    if (!res.hasMore) break;
    const first = chunk[0]?.seq;
    if (typeof first !== 'number') break;
    beforeSeq = first;
  }
  return foldSessionEvents(events);
}

/** 会话里最后一条非空 assistant 文本。 */
export async function lastAssistantText(rpc: Rpc, sessionId: string): Promise<string> {
  const messages = await foldedHistory(rpc, sessionId, { pageMessages: 20, maxPages: 1 });
  return [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())?.content.trim() ?? '';
}

/* ------------------------------------------------------------------ 预览 */

export interface PreviewOptions {
  sessionId: string;
  /** 同一命令已经读取过的源会话行，避免重复扫描全局列表。 */
  sourceSession?: SessionRow;
  tier?: ModelTier;
  provider?: string;
  model?: string;
  sourceCharBudget?: number;
  summaryCharBudget?: number;
  lang?: Lang;
  workerTimeoutMs?: number;
  /** 轮询空闲的间隔，测试里调小。 */
  pollMs?: number;
  /** 只取材、不真的调模型（自检用）。 */
  dryRun?: boolean;
  onProgress?: (message: string) => void;
}

export interface PreviewResult {
  summary: string;
  source: BridgeSource;
  lang: 'zh' | 'en';
  worker: { sessionId?: string; provider: string; model: string; reason: string; preset?: string };
  /** 工人会话是否被限速取消（摘要按已产出文本计）。 */
  capped: boolean;
  sourceSession: SessionRow | undefined;
}

/** 生成交接摘要：取材 → 起临时工人 → 收摘要 → 归档工人。 */
export async function previewMigration(rpc: Rpc, options: PreviewOptions): Promise<PreviewResult> {
  const progress = options.onProgress ?? (() => {});
  const sourceSession = options.sourceSession ?? await findSession(rpc, options.sessionId);

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
  const worker = await rpc<{ sessionId: string }>('session.create', {
    ...where,
    ...(preset === undefined ? {} : { agentPreset: preset }),
  });

  let capped = false;
  try {
    if (route.provider && route.model) {
      await rpc('session.selectModel', { sessionId: worker.sessionId, provider: route.provider, model: route.model })
        .catch((error: unknown) => {
          // 选模型失败不该让整次迁移失败：工人用会话默认模型照样能写摘要。
          progress(`选模型失败，改用默认模型（${error instanceof Error ? error.message : String(error)}）`);
        });
    }
    const instruction = buildBridgeInstruction(lang, { summaryCharBudget: options.summaryCharBudget });
    const workerBaselineSeq = await latestSessionSeq(rpc, worker.sessionId).catch(() => 0);
    await rpc('session.prompt', {
      sessionId: worker.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: `${instruction}${source.text}` }],
    });
    progress('等待摘要…');
    const settled = await waitIdle(rpc, worker.sessionId, {
      timeoutMs: options.workerTimeoutMs ?? 360_000,
      afterSeq: workerBaselineSeq,
      ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs, startGraceMs: options.pollMs * 6 }),
    });
    if (!settled.idle) {
      capped = true;
      await rpc('session.cancel', { sessionId: worker.sessionId }).catch(() => undefined);
      await sleep(2500);
    }
    const workerSummary = await lastAssistantText(rpc, worker.sessionId);
    if (!workerSummary) {
      throw new RpcError('bridge.preview', 'worker-empty', '压缩工人没有产出摘要（可能是模型不可用或被取消）。');
    }
    const summary = appendVisualEvidence(workerSummary, source.visualEvidence, lang);
    return {
      summary,
      source,
      lang,
      worker: { sessionId: worker.sessionId, ...route, preset },
      capped,
      sourceSession,
    };
  } finally {
    // 工人是一次性的：无论成败都归档，不在侧栏留垃圾。
    await rpc('workspace.archiveSession', { sessionId: worker.sessionId }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ 迁移 */

export interface MigrateOptions {
  sessionId: string;
  /** 同一流程已经读取过的源会话行，避免重复扫描全局列表。 */
  sourceSession?: SessionRow;
  to: string;
  summary: string;
  lang?: 'zh' | 'en';
  /**
   * goal 的自主轮次上限。
   *
   * 上游 `goal.create` 的部署默认是 **256**，而 `dsh-goal-round-driver` 会在
   * agent 空闲时把目标渲染成 `<goal_round>` 提示反复跑。也就是说不显式设这个值，
   * 一次「迁移」就等于给新会话开了最多 256 轮的自主循环。交接只需要一轮。
   */
  goalRounds?: number;
  /** 摘要注入方式，默认 both（挂 goal + 首轮提示里也带全文）。 */
  inject?: InjectMode;
  /** 是否发首轮交接指令。 */
  kickoff?: boolean;
  /** 是否在同一轮复述后继续工作。goal 始终先暂停，避免 round driver 另起一轮。 */
  autoContinue?: boolean;
  /** 给新会话起个能看出来源的标题。 */
  title?: string;
  onProgress?: (message: string) => void;
}

export interface MigrateResult {
  sessionId: string;
  agentPreset: string;
  /** 是否在 kickoff 前把源会话的模型选择复制到了目标会话。 */
  modelTransferred: boolean;
  /** 迁移时读到的源会话模型；读取失败时省略并给出 warning。 */
  sourceModel?: ModelSelection;
  goalCreated: boolean;
  goalPaused: boolean;
  kickoffSent: boolean;
  titled: boolean;
  /** 自动策略实际把多少张尚未解析的原图注入了 kickoff。 */
  imagesSent: number;
  warnings: string[];
}

interface PromptImage {
  type: 'image';
  mediaType: ImageAttachmentRef['mediaType'];
  data: string;
  name?: string;
}

/** 找出没有关联助手正文的图片引用；已有逐字视觉证据时默认不重复烧视觉 token。 */
function unresolvedImageRefs(messages: ChatMessage[]): { refs: ImageAttachmentRef[]; missing: number } {
  const evidence = collectVisualEvidence(messages, Number.MAX_SAFE_INTEGER);
  const refs: ImageAttachmentRef[] = [];
  const seen = new Set<string>();
  let missing = 0;
  for (const item of evidence.included) {
    if (item.assistantText) continue;
    missing += Math.max(0, item.imageCount - item.attachments.length);
    for (const ref of item.attachments) {
      if (seen.has(ref.attachmentId)) continue;
      seen.add(ref.attachmentId);
      refs.push(ref);
    }
  }
  return { refs, missing };
}

async function readPromptImages(rpc: Rpc, sourceSessionId: string, refs: ImageAttachmentRef[]): Promise<PromptImage[]> {
  return Promise.all(refs.map(async (ref) => {
    const stored = await rpc<{ attachment?: ImageAttachmentRef; data?: string }>('session.attachment', {
      sessionId: sourceSessionId,
      attachmentId: ref.attachmentId,
    });
    if (!stored.data || typeof stored.data !== 'string') {
      throw new RpcError('session.attachment', 'empty-image', `附件 ${ref.attachmentId} 没有返回图片字节。`);
    }
    const attachment = stored.attachment ?? ref;
    return {
      type: 'image',
      mediaType: attachment.mediaType,
      data: stored.data,
      ...(attachment.name ? { name: attachment.name } : {}),
    };
  }));
}

function imageFallbackAllowed(error: unknown): boolean {
  if (!(error instanceof RpcError)) return false;
  if (error.method === 'session.attachment') return true;
  if (error.method !== 'session.prompt' || error.code !== 'attachment-error') return false;
  const reason = error.details && typeof error.details === 'object' && 'reason' in error.details
    ? String((error.details as { reason?: unknown }).reason)
    : '';
  return reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES'
    || reason.startsWith('IMAGE_')
    || reason.startsWith('ATTACHMENT_');
}

/**
 * 建目标会话并交接。
 *
 * 注入方式说明：`goal.create` 本身**不会**把目标注入模型上下文（上游
 * `dsh-goal` README：「Goal mutations do not inject model context」），
 * 摘要能被模型看见依赖 goal-round-driver 把它渲染成 `<goal_round>` 提示，
 * 或模型主动调 `get_goal`。所以默认把摘要同时放进首轮提示：任何组装下都成立。
 */
export async function executeMigration(rpc: Rpc, options: MigrateOptions): Promise<MigrateResult> {
  const progress = options.onProgress ?? (() => {});
  const warnings: string[] = [];
  const inject = options.inject ?? 'both';
  const lang = options.lang ?? detectLang(options.summary);
  const summary = options.summary.trim();
  if (!summary) throw new RpcError('bridge.migrate', 'empty-summary', '摘要为空，拒绝迁移。');

  const sourceSession = options.sourceSession ?? await findSession(rpc, options.sessionId);
  const where = await placement(rpc, sourceSession, options.sessionId);
  let sourceModel: ModelSelection | undefined;
  try {
    const models = await rpc<{ current?: Partial<ModelSelection> }>('session.models', { sessionId: options.sessionId });
    const current = models.current;
    if (typeof current?.provider === 'string' && current.provider
      && typeof current.model === 'string' && current.model) {
      sourceModel = {
        provider: current.provider,
        model: current.model,
        ...(typeof current.reasoningEffort === 'string' && current.reasoningEffort
          ? { reasoningEffort: current.reasoningEffort }
          : {}),
      };
    }
  } catch (error) {
    warnings.push(`读取源会话模型失败，目标将使用 host 默认模型：${error instanceof Error ? error.message : String(error)}`);
  }

  progress(`在 ${options.to} 模式下新建会话…`);
  const created = await rpc<{ sessionId: string; agentPreset?: string }>('session.create', {
    ...where,
    agentPreset: options.to,
  });

  // rc.2 的 session.selectModel 会同时保存 host 默认模型。预览 worker 通常
  // 选择 pro 档位，因此如果这里依赖新会话默认值，目标会被 worker 悄悄改成
  // pro，视觉源会话也会失去 VLM。显式复制源选择既保持用户模型意图，也让
  // 未解析原图能在 kickoff 前通过目标模型的图片准入。
  let modelTransferred = false;
  if (sourceModel) {
    try {
      await rpc('session.selectModel', { sessionId: created.sessionId, ...sourceModel });
      modelTransferred = true;
    } catch (error) {
      warnings.push(`复制源会话模型失败，目标将使用 host 默认模型：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let titled = false;
  if (options.title) {
    try {
      await rpc('session.rename', { sessionId: created.sessionId, title: options.title });
      titled = true;
    } catch (error) {
      warnings.push(`改标题失败（不影响迁移）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let goalCreated = false;
  let goalPaused = false;
  let safeToKickoff = true;
  let kickoffSent = false;
  let imagesSent = 0;
  if (inject === 'goal' || inject === 'both') {
    try {
      const createdGoal = await rpc<{ ref: { id: string; revision: number } }>('goal.create', {
        sessionId: created.sessionId,
        objective: summary,
        maxGoalRounds: options.goalRounds ?? 1,
      });
      goalCreated = true;
      try {
        await rpc('goal.pause', { sessionId: created.sessionId, ref: createdGoal.ref });
        goalPaused = true;
      } catch (error) {
        // 安全优先：pause 失败时不再发 kickoff。先清除 goal，挡住尚未入队的
        // requestDrive；再 cancel，截住已排队或已开始的 attempt。
        safeToKickoff = false;
        let goalCleared = false;
        try {
          await rpc('goal.clear', { sessionId: created.sessionId, ref: createdGoal.ref });
          goalCleared = true;
        } catch (clearError) {
          warnings.push(`清除未暂停的交接目标失败，已继续取消目标会话；请保持目标会话关闭并手动检查：${clearError instanceof Error ? clearError.message : String(clearError)}`);
        }
        await rpc('session.cancel', { sessionId: created.sessionId }).catch(() => undefined);
        warnings.push(goalCleared
          ? `暂停交接目标失败，已清除目标并取消自动启动；请打开目标会话检查后手动继续：${error instanceof Error ? error.message : String(error)}`
          : `暂停交接目标失败，已取消自动启动但无法确认目标已清除；请打开目标会话检查后手动继续：${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      // 没挂 goal 服务的部署也应该能迁移：摘要还会走首轮提示。
      warnings.push(`挂载会话目标失败，摘要改由首轮提示携带：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (options.kickoff !== false && safeToKickoff) {
    // goal mutation 本身不注入模型上下文，而 Bridge 会在 kickoff 前暂停 goal。
    // 只要要发 kickoff，就必须带摘要；不能用一次看不见摘要的目标请求换取表面省 token。
    const baseText = `${handoffPreamble(lang)}\n\n${summary}\n\n${buildBridgeKickoff(lang, options.autoContinue)}`;
    progress('发送首轮交接指令…');
    let unresolved: { refs: ImageAttachmentRef[]; missing: number } = { refs: [], missing: 0 };
    try {
      unresolved = unresolvedImageRefs(await foldedHistory(rpc, options.sessionId));
    } catch (error) {
      warnings.push(`读取图片状态失败，已按纯文本交接：${error instanceof Error ? error.message : String(error)}`);
    }
    if (unresolved.missing > 0) {
      warnings.push(`有 ${unresolved.missing} 张未解析图片缺少可复用的持久附件引用；目标会话必须回源会话核验。`);
    }

    if (unresolved.refs.length) {
      try {
        const images = await readPromptImages(rpc, options.sessionId, unresolved.refs);
        const transferNote = lang === 'en'
          ? 'Bridge transfer note: the unresolved source images listed above are attached to this kickoff. Inspect them directly; do not infer details that are not visible.'
          : 'Bridge 搬运说明：上文列出的未解析源图片已附在本次 kickoff 中。请直接检查原图，不得推断看不清的细节。';
        await rpc('session.prompt', {
          sessionId: created.sessionId,
          mode: 'queue',
          content: [...images, { type: 'text', text: `${baseText}\n\n${transferNote}` }],
        });
        imagesSent = images.length;
      } catch (error) {
        if (!imageFallbackAllowed(error)) throw error;
        warnings.push(`目标模型或 host 不能接收原图，已使用逐字视觉证据/未解析提示降级：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (imagesSent === 0) {
      await rpc('session.prompt', {
        sessionId: created.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: baseText }],
      });
    }
    kickoffSent = true;
  }

  return {
    sessionId: created.sessionId,
    agentPreset: created.agentPreset ?? options.to,
    modelTransferred,
    ...(sourceModel ? { sourceModel } : {}),
    goalCreated,
    goalPaused,
    kickoffSent,
    titled,
    imagesSent,
    warnings,
  };
}

function handoffPreamble(lang: 'zh' | 'en'): string {
  return lang === 'en'
    ? 'Handoff summary from a previous session that ran under a different tool preset:'
    : '以下是上个会话（另一套工具模式）留下的交接摘要：';
}

/** 默认标题：让新会话在侧栏里一眼看得出来源。 */
export function migratedTitle(sourceTitle: string | undefined, to: string): string {
  const base = (sourceTitle ?? '').trim();
  return base ? `${base} → ${to}` : `迁移到 ${to}`;
}

/** 从 session.list 行里尽力取出标题（projection 形状随部署而异）。 */
export function titleOf(row: SessionRow | undefined): string | undefined {
  const value = row?.projections?.values?.['title'];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && 'title' in value) {
    const nested = (value as { title?: unknown }).title;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return undefined;
}
