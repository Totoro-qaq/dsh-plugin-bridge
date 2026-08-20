/** 摘要正文的硬预算（字符）。默认 2400 字符 ≈ 900 tokens。 */
export const SUMMARY_CHAR_BUDGET = 2400;
/** 压缩输入（喂给工人模型的取材）总字符预算，≈30K tokens 内。 */
export const SOURCE_CHAR_BUDGET = 60_000;
/** 摘要预算换算成 token 的粗系数（中英混合，~2.67 字符/token）。 */
const SUMMARY_CHARS_PER_TOKEN = SUMMARY_CHAR_BUDGET / 900;
/** 单条 assistant 结论段截断。 */
const ASSISTANT_SNIPPET = 900;
/** 保留完整细节的最近 assistant 消息条数。 */
const RECENT_ASSISTANT_MESSAGES = 6;
/** 逐字视觉证据独立于摘要预算；只按完整块收录，绝不从中间截断。 */
export const VISUAL_EVIDENCE_CHAR_BUDGET = 60_000;
/**
 * 各分区的预算配额。
 *
 * 旧实现是「按顺序装，装不下就从当前分区头部切一刀然后 break」，
 * 于是超预算时活下来的是**最老**的用户消息，而承载「刚完成什么 / 卡在哪」的
 * 最近助手结论段会整段消失——正好和迁移需要的相反。现在改成先按配额分配，
 * 未用尽的额度再按 用户消息 > 最近结论 > compaction 底稿 的优先级回流。
 */
const SECTION_SHARE = { compaction: 0.25, users: 0.45, recent: 0.3 };
const SECTION_HEADERS = {
    compaction: '【早前上下文压缩摘要】',
    users: '【用户消息全文（按时间序）】',
    recent: '【最近助手输出摘要】',
};
function toolLine(node) {
    // 工具只留名字与首个路径样参数，stdout 与代码块一律丢弃。
    const detail = (node.detail ?? '').split('\n')[0] ?? '';
    const pathMatch = /(?:^|\s)((?:\/|~\/|\.\/|[\w.-]+\/)[\w./-]+)/.exec(detail);
    return pathMatch ? `${node.title} ${pathMatch[1]}` : node.title;
}
/**
 * 把“含图用户消息”与它到下一条用户消息之间的助手正文配对。
 *
 * Bridge 不声称这些正文一定是图片描述，只称为“关联助手响应”；这样即使助手
 * 只是追问，也不会被误标成已经识图。文本由程序直接复制，不经过摘要模型。
 */
export function collectVisualEvidence(messages, charBudget = VISUAL_EVIDENCE_CHAR_BUDGET) {
    const candidates = [];
    let userMessage = 0;
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role !== 'user')
            continue;
        userMessage += 1;
        const imageCount = message.imageCount ?? 0;
        if (imageCount <= 0)
            continue;
        const assistant = [];
        for (let next = index + 1; next < messages.length; next += 1) {
            const following = messages[next];
            if (following.role === 'user')
                break;
            if (following.role === 'assistant' && following.kind !== 'compaction' && following.content.trim()) {
                assistant.push(following.content.trim());
            }
        }
        candidates.push({
            userMessage,
            imageCount,
            userText: message.content.trim(),
            assistantText: assistant.join('\n\n'),
            attachments: [...(message.imageAttachments ?? [])],
        });
    }
    const budget = Math.max(0, charBudget);
    const included = [];
    let used = 0;
    // 最新证据优先，但最终仍按时间顺序呈现；整块装不下就省略，不切正文。
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const item = candidates[index];
        const cost = item.userText.length + item.assistantText.length + 240;
        if (used + cost > budget)
            continue;
        included.unshift(item);
        used += cost;
    }
    const omitted = candidates.length - included.length;
    const represented = included.filter((item) => item.assistantText.length > 0).length;
    return {
        imageMessages: candidates.length,
        images: candidates.reduce((sum, item) => sum + item.imageCount, 0),
        represented,
        // 未关联正文与预算整块省略都需要人工核验；每条图片消息只计一次。
        unresolved: candidates.length - represented,
        included,
        omitted,
        truncated: omitted > 0,
    };
}
/** 把逐字视觉证据作为独立附录拼到模型摘要后；正文不会被二次改写。 */
export function appendVisualEvidence(summary, evidence, lang) {
    if (evidence.imageMessages === 0)
        return summary.trim();
    const blocks = [summary.trim()];
    const represented = evidence.included.filter((item) => item.assistantText);
    if (represented.length) {
        blocks.push(lang === 'en'
            ? '## Visual evidence — verbatim, not summarized\nThe associated assistant responses below are copied exactly from the source session. They may be questions or partial analyses; do not claim they prove more than their text says.'
            : '## 视觉证据——原文搬运，未经二次摘要\n以下关联助手响应由程序从源会话逐字复制；它可能是追问或不完整分析，不得声称超出原文的结论。');
        for (const item of represented) {
            const title = lang === 'en'
                ? `### Source user message ${item.userMessage} · ${item.imageCount} image(s)`
                : `### 源用户消息 ${item.userMessage} · ${item.imageCount} 张图片`;
            const pieces = [title];
            if (item.userText) {
                pieces.push(lang === 'en' ? '**User context (verbatim)**' : '**用户文字（原文）**', item.userText);
            }
            pieces.push(lang === 'en' ? '**Associated assistant response (verbatim)**' : '**关联助手响应（原文）**', item.assistantText);
            blocks.push(pieces.join('\n\n'));
        }
    }
    const unresolved = evidence.included.filter((item) => !item.assistantText);
    if (unresolved.length || evidence.omitted) {
        const lines = [lang === 'en' ? '## Unresolved images' : '## 未解析图片'];
        for (const item of unresolved) {
            lines.push(lang === 'en'
                ? `- Source user message ${item.userMessage} contains ${item.imageCount} image(s) with no associated assistant text. Do not infer their contents; reattach or inspect the original session.`
                : `- 源用户消息 ${item.userMessage} 含 ${item.imageCount} 张图片，但没有关联助手正文。不得猜测内容；请重新附图或回源会话检查。`);
        }
        if (evidence.omitted) {
            lines.push(lang === 'en'
                ? `- ${evidence.omitted} older visual-evidence block(s) exceeded the dedicated budget and were omitted whole, never partially truncated. Inspect the original session before relying on them.`
                : `- 另有 ${evidence.omitted} 个较早视觉证据块超出独立预算，已整块省略而非截断。依赖这些图片前必须回源会话核验。`);
        }
        blocks.push(lines.join('\n'));
    }
    return blocks.filter(Boolean).join('\n\n');
}
/** 在给定字符预算内渲染一个分区；预算连表头都放不下时返回 null。 */
function renderSection(section, budget) {
    const header = section.header;
    if (budget <= header.length + 1)
        return null;
    const room = budget - header.length - 1; // -1: 表头与正文之间的换行
    if (section.keep === 'head') {
        const body = section.items.join('\n');
        if (body.length <= room)
            return { text: `${header}\n${body}`, clipped: false };
        const marker = '\n…（底稿截断）';
        // 只放得下截断标记本身就没有信息量了，整段让位给优先级更高的分区。
        if (room <= marker.length)
            return null;
        const slice = body.slice(0, room - marker.length);
        return { text: `${header}\n${slice}${marker}`, clipped: true };
    }
    // keep === 'newest'：从最后一条往前收，直到装不下。
    const picked = [];
    let used = 0;
    let index = section.items.length - 1;
    for (; index >= 0; index -= 1) {
        const item = section.items[index];
        const cost = item.length + (picked.length ? 1 : 0);
        if (used + cost > room)
            break;
        picked.unshift(item);
        used += cost;
    }
    const droppedCount = index + 1;
    if (!picked.length)
        return null;
    if (droppedCount > 0) {
        const note = section.note?.(droppedCount) ?? `（较早的 ${droppedCount} 条因预算省略）`;
        // 提示行本身也要占额度：装不下就再让出一条。
        while (picked.length > 1 && used + note.length + 1 > room) {
            const shed = picked.shift();
            used -= shed.length + 1;
        }
        return { text: `${header}\n${note}\n${picked.join('\n')}`, clipped: true };
    }
    return { text: `${header}\n${picked.join('\n')}`, clipped: false };
}
/** 从折叠消息构建压缩输入。messages 按时间正序。 */
export function buildBridgeSource(messages, options = {}) {
    const budget = Math.max(0, options.sourceCharBudget ?? SOURCE_CHAR_BUDGET);
    const visualEvidence = collectVisualEvidence(messages, options.visualEvidenceCharBudget);
    // 1) 最近一次 compaction 摘要当底稿（官方已付过压缩成本）。
    const compaction = [...messages].reverse().find((m) => m.kind === 'compaction' && m.content.trim());
    // 2) 用户消息全文（意图锚点，体量小）。
    const users = messages.filter((m) => m.role === 'user' && (m.content.trim() || (m.imageCount ?? 0) > 0));
    // 3) 最近若干条 assistant 结论 + 工具痕迹（只留名字与路径）。
    const assistants = messages.filter((m) => m.role === 'assistant' && (m.content.trim() || (m.toolNodes?.length ?? 0) > 0));
    const recent = assistants.slice(-RECENT_ASSISTANT_MESSAGES);
    const sections = [];
    if (compaction) {
        sections.push({
            name: 'compaction',
            header: SECTION_HEADERS.compaction,
            items: [compaction.content.trim()],
            keep: 'head',
        });
    }
    if (users.length) {
        sections.push({
            name: 'users',
            header: SECTION_HEADERS.users,
            items: users.map((m, i) => {
                const marker = (m.imageCount ?? 0) > 0
                    ? `[image attachments: ${m.imageCount}; visual content is not available to the summary worker]`
                    : '';
                return `${i + 1}. ${[marker, m.content.trim()].filter(Boolean).join(' ')}`;
            }),
            keep: 'newest',
            note: (dropped) => `（较早的 ${dropped} 条用户消息因预算省略，保留的是最近的）`,
        });
    }
    if (recent.length) {
        const blocks = recent.map((m) => {
            const parts = [];
            const text = m.content.trim();
            if (text)
                parts.push(text.length > ASSISTANT_SNIPPET ? `${text.slice(0, ASSISTANT_SNIPPET)}…` : text);
            const tools = (m.toolNodes ?? []).map(toolLine);
            if (tools.length)
                parts.push(`[工具] ${tools.join('；')}`);
            return parts.join('\n');
        });
        sections.push({
            name: 'recent',
            header: SECTION_HEADERS.recent,
            items: blocks.map((block, i) => (i === blocks.length - 1 ? block : `${block}\n---`)),
            keep: 'newest',
            note: (dropped) => `（更早的 ${dropped} 条助手输出因预算省略）`,
        });
    }
    if (!sections.length) {
        return {
            text: '',
            userMessagesUsed: 0,
            userMessagesTotal: users.length,
            reusedCompaction: false,
            truncated: false,
            dropped: [],
            visualEvidence,
        };
    }
    // 分区间用空行拼接，先把分隔符的开销从总预算里扣掉。
    const separators = (sections.length - 1) * 2;
    const usable = Math.max(0, budget - separators);
    // 4) 先按配额分配，未用尽的额度再按优先级回流。
    const need = new Map();
    for (const section of sections) {
        const body = section.keep === 'head'
            ? section.items.join('\n').length
            : section.items.reduce((sum, item) => sum + item.length + 1, -1);
        need.set(section.name, section.header.length + 1 + Math.max(0, body));
    }
    const alloc = new Map();
    let pool = usable;
    for (const section of sections) {
        const quota = Math.floor(usable * SECTION_SHARE[section.name]);
        const take = Math.min(need.get(section.name) ?? 0, quota);
        alloc.set(section.name, take);
        pool -= take;
    }
    for (const name of ['users', 'recent', 'compaction']) {
        if (pool <= 0)
            break;
        const section = sections.find((s) => s.name === name);
        if (!section)
            continue;
        const gap = (need.get(name) ?? 0) - (alloc.get(name) ?? 0);
        if (gap <= 0)
            continue;
        const extra = Math.min(gap, pool);
        alloc.set(name, (alloc.get(name) ?? 0) + extra);
        pool -= extra;
    }
    // 5) 渲染。
    const picked = [];
    const dropped = [];
    let usersUsed = 0;
    for (const section of sections) {
        const rendered = renderSection(section, alloc.get(section.name) ?? 0);
        if (!rendered) {
            dropped.push(section.name);
            continue;
        }
        if (rendered.clipped)
            dropped.push(section.name);
        if (section.name === 'users') {
            // 数一下真正进了正文的条目（提示行不算）。
            usersUsed = rendered.text.split('\n').filter((line) => /^\d+\. /.test(line)).length;
        }
        picked.push(rendered.text);
    }
    return {
        text: picked.join('\n\n'),
        userMessagesUsed: usersUsed,
        userMessagesTotal: users.length,
        reusedCompaction: Boolean(compaction) && !dropped.includes('compaction'),
        truncated: dropped.length > 0 || visualEvidence.truncated,
        dropped: visualEvidence.truncated ? [...dropped, 'visual-evidence'] : dropped,
        visualEvidence,
    };
}
/** 摘要预算（字符）换算成写进指令的 token 上限。 */
export function summaryTokenBudget(summaryCharBudget = SUMMARY_CHAR_BUDGET) {
    return Math.max(100, Math.round(summaryCharBudget / SUMMARY_CHARS_PER_TOKEN));
}
/** 压缩指令：让工人模型输出固定 schema 的交接摘要。 */
export function buildBridgeInstruction(lang, options = {}) {
    const tokens = summaryTokenBudget(options.summaryCharBudget);
    if (lang === 'en') {
        return `You are a handoff engineer. Below is material from an AI coding session (full user messages, recent assistant output, and possibly an earlier compaction summary).

Write a handoff summary for ANOTHER agent taking over this task under a DIFFERENT tool preset. Follow this structure exactly, ≤${tokens} tokens total:

## Goal
(1-2 sentences: what the user is building and the definition of done)
## Current state
(3-5 sentences: progress, what was just completed, any blocker)
## Key decisions & conventions
(≤5 bullets: technical choices, user preferences, hard constraints — include the reasoning)
## Key files
(≤10 paths, one per line, optional half-sentence note)
## Next step
(1-2 sentences)

Rules: drop details tied to the old preset's tools; keep decision rationale; when the material says a value, path, dependency, or convention was superseded/revoked, OMIT that obsolete concrete value entirely and keep only the currently effective replacement (never list an obsolete value even to say it is obsolete); every path must come from the material, never invent one; copy exact current numbers (ports, versions, limits) verbatim on their own line so they cannot be rounded to common values; no pleasantries — output the summary only.

`;
    }
    return `你是一名交接工程师。下面是某个 AI 编程会话的取材（用户消息全文、最近若干轮助手输出，可能还有早前的一次上下文压缩摘要）。

请为「即将在另一套工具模式下接管任务的 agent」写一份交接摘要，严格按以下结构，总长 ≤${tokens} tokens：

## 目标
（1-2 句：用户在做什么、完成的定义）
## 当前状态
（3-5 句：进展到哪、刚完成什么、卡在哪）
## 关键决策与约定
（≤5 条：技术选型、用户偏好、硬约束——附决策理由）
## 关键文件
（≤10 个路径，一行一个，可带半句说明）
## 下一步
（1-2 句）

要求：删去与原模式工具细节相关的内容；保留决策理由；取材若明确说明某个值、路径、依赖或约定已作废/被覆盖，必须彻底省略该旧具体值，只保留当前生效的替代值（即使为了说明“已作废”也不得复述旧值）；路径必须来自取材，不得编造；当前生效的端口、版本号、数量上限这类精确数字必须原样单独成行抄写，不得改写成常见值；不要寒暄，直接输出摘要。

`;
}
/** 注入新会话首轮的交接指令（goal 之后的第一条 prompt）。 */
export function buildBridgeKickoff(lang, autoContinue = false) {
    if (lang === 'en') {
        return autoContinue
            ? 'The session goal above is a handoff summary from a previous session that ran under a different tool preset. Treat only currently effective values as actionable; never quote or restate concrete values marked obsolete, revoked, or superseded. Reply in one short paragraph restating your understanding of the current state, then continue with the next step.'
            : 'The session goal above is a handoff summary from a previous session that ran under a different tool preset. Treat only currently effective values as actionable; never quote or restate concrete values marked obsolete, revoked, or superseded. Reply in one short paragraph restating your understanding of the current state, then stop and wait for the user to confirm before taking any further action.';
    }
    return autoContinue
        ? '上面的会话目标是上个会话（另一套工具模式）留下的交接摘要。只把当前生效值当作可执行事实；不要引用或复述任何标记为已作废、撤销或被覆盖的具体旧值。请先用一段话复述你对当前状态的理解，然后继续执行下一步。'
        : '上面的会话目标是上个会话（另一套工具模式）留下的交接摘要。只把当前生效值当作可执行事实；不要引用或复述任何标记为已作废、撤销或被覆盖的具体旧值。请只用一段话复述你对当前状态的理解，然后停止，等待用户确认后再采取任何进一步行动。';
}
/** 成本预估（粗）：按取材字符数估输入 tokens，中英混合按 ~2 字符/token。 */
export function estimateSummaryTokens(sourceChars, options = {}) {
    return { input: Math.ceil(sourceChars / 2) + 400, output: summaryTokenBudget(options.summaryCharBudget) };
}
/**
 * 取材语言判定：CJK 字符占比超过 15% 视为中文。
 * 用于 `--lang auto`：摘要语言应该跟着会话内容走，而不是跟着部署默认走。
 */
export function detectLang(text) {
    const sample = text.slice(0, 4000);
    if (!sample)
        return 'en';
    const cjk = sample.match(/[一-鿿぀-ヿ]/g)?.length ?? 0;
    return cjk / sample.length > 0.15 ? 'zh' : 'en';
}
