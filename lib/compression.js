/** 摘要正文的硬预算（token 量级 ≈ 1K 内，按字符宽估）。 */
export const SUMMARY_CHAR_BUDGET = 2400;
/** 压缩输入（喂给工人模型的取材）总字符预算，≈30K tokens 内。 */
export const SOURCE_CHAR_BUDGET = 60_000;
/** 单条 assistant 结论段截断。 */
const ASSISTANT_SNIPPET = 900;
/** 保留完整细节的最近轮数（一轮 = 一条用户消息起的段落）。 */
const RECENT_TURNS_FULL = 3;
function toolLine(node) {
    // 工具只留名字与首个路径样参数，stdout 与代码块一律丢弃。
    const detail = (node.detail ?? '').split('\n')[0] ?? '';
    const pathMatch = /(?:^|\s)((?:\/|~\/|\.\/|[\w.-]+\/)[\w./-]+)/.exec(detail);
    return pathMatch ? `${node.title} ${pathMatch[1]}` : node.title;
}
/** 从折叠消息构建压缩输入。messages 按时间正序。 */
export function buildBridgeSource(messages, options = {}) {
    const budget = options.sourceCharBudget ?? SOURCE_CHAR_BUDGET;
    const sections = [];
    let truncated = false;
    // 1) 最近一次 compaction 摘要当底稿（官方已付过压缩成本）。
    const compaction = [...messages].reverse().find((m) => m.kind === 'compaction' && m.content.trim());
    if (compaction) {
        sections.push(`【早前上下文压缩摘要】\n${compaction.content.trim()}`);
    }
    // 2) 用户消息全文（意图锚点，体量小）。
    const users = messages.filter((m) => m.role === 'user' && m.content.trim());
    if (users.length) {
        sections.push('【用户消息全文（按时间序）】\n' + users.map((m, i) => `${i + 1}. ${m.content.trim()}`).join('\n'));
    }
    // 3) 最近若干轮的 assistant 结论 + 工具痕迹（只留名字与路径）。
    const assistants = messages.filter((m) => m.role === 'assistant' && (m.content.trim() || (m.toolNodes?.length ?? 0) > 0));
    const recent = assistants.slice(-RECENT_TURNS_FULL * 2);
    if (recent.length) {
        const rows = recent.map((m) => {
            const parts = [];
            const text = m.content.trim();
            if (text)
                parts.push(text.length > ASSISTANT_SNIPPET ? `${text.slice(0, ASSISTANT_SNIPPET)}…` : text);
            const tools = (m.toolNodes ?? []).map(toolLine);
            if (tools.length)
                parts.push(`[工具] ${tools.join('；')}`);
            return parts.join('\n');
        });
        sections.push(`【最近 ${recent.length} 条助手输出摘要】\n${rows.join('\n---\n')}`);
    }
    // 4) 预算内拼装：优先级 1→2→3，超限从最低优先级砍。
    const picked = [];
    let used = 0;
    for (const section of sections) {
        if (used + section.length <= budget) {
            picked.push(section);
            used += section.length;
        }
        else {
            const room = budget - used;
            if (room > 400) {
                picked.push(`${section.slice(0, room)}\n…（取材截断）`);
                used += room;
            }
            truncated = true;
            break;
        }
    }
    return {
        text: picked.join('\n\n'),
        userMessagesUsed: users.length,
        userMessagesTotal: users.length,
        reusedCompaction: Boolean(compaction),
        truncated,
    };
}
/** 压缩指令：让工人模型输出固定 schema 的交接摘要。 */
export function buildBridgeInstruction(lang) {
    if (lang === 'en') {
        return `You are a handoff engineer. Below is material from an AI coding session (full user messages, recent assistant output, and possibly an earlier compaction summary).

Write a handoff summary for ANOTHER agent taking over this task under a DIFFERENT tool preset. Follow this structure exactly, ≤900 tokens total:

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

Rules: drop details tied to the old preset's tools; keep decision rationale; every path must come from the material, never invent one; no pleasantries — output the summary only.

`;
    }
    return `你是一名交接工程师。下面是某个 AI 编程会话的取材（用户消息全文、最近若干轮助手输出，可能还有早前的一次上下文压缩摘要）。

请为「即将在另一套工具模式下接管任务的 agent」写一份交接摘要，严格按以下结构，总长 ≤900 tokens：

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

要求：删去与原模式工具细节相关的内容；保留决策理由；路径必须来自取材，不得编造；不要寒暄，直接输出摘要。

`;
}
/** 注入新会话首轮的交接指令（goal 之后的第一条 prompt）。 */
export function buildBridgeKickoff(lang) {
    return lang === 'en'
        ? 'The session goal above is a handoff summary from a previous session that ran under a different tool preset. Reply in one short paragraph restating your understanding of the current state, then continue with the next step.'
        : '上面的会话目标是上个会话（另一套工具模式）留下的交接摘要。请先用一段话复述你对当前状态的理解，然后继续执行下一步。';
}
/** 成本预估（粗）：按取材字符数估输入 tokens，中英混合按 ~2 字符/token。 */
export function estimateSummaryTokens(sourceChars) {
    return { input: Math.ceil(sourceChars / 2) + 400, output: 900 };
}
