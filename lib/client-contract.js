/** Pure wire-to-view helpers shared by the native WebUI card and Node tests. */
export const MAX_EDITED_SUMMARY_CHARS = 24_000;
const RUN_COMMAND = /\/bridge\s+([^\s]+)\s+--go(?:\s|$)/u;
const TEXT_SCHEMAS = {
    zh: [
        ['goal', '目标', 'text'],
        ['currentState', '当前状态', 'text'],
        ['keyDecisions', '关键决策与约定', 'list'],
        ['keyFiles', '关键文件', 'list'],
        ['nextStep', '下一步', 'text'],
    ],
    en: [
        ['goal', 'Goal', 'text'],
        ['currentState', 'Current state', 'text'],
        ['keyDecisions', 'Key decisions & conventions', 'list'],
        ['keyFiles', 'Key files', 'list'],
        ['nextStep', 'Next step', 'text'],
    ],
};
const TEXT_APPENDICES = {
    zh: new Set(['视觉证据——原文搬运，未经二次摘要', '未解析图片']),
    en: new Set(['Visual evidence — verbatim, not summarized', 'Unresolved images']),
};
function sourceLines(markdown, lineEnding) {
    const lines = [];
    let start = 0;
    while (start <= markdown.length) {
        const next = markdown.indexOf(lineEnding, start);
        if (next < 0) {
            lines.push({ start, contentEnd: markdown.length, end: markdown.length, text: markdown.slice(start) });
            break;
        }
        lines.push({ start, contentEnd: next, end: next + lineEnding.length, text: markdown.slice(start, next) });
        start = next + lineEnding.length;
        if (start === markdown.length) {
            lines.push({ start, contentEnd: start, end: start, text: '' });
            break;
        }
    }
    return lines;
}
function markdownHeadings(markdown, lineEnding) {
    const headings = [];
    let fence;
    for (const line of sourceLines(markdown, lineEnding)) {
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line.text);
        if (fence) {
            if (fenceMatch && fenceMatch[1]?.[0] === fence.marker
                && (fenceMatch[1]?.length ?? 0) >= fence.length
                && (fenceMatch[2]?.trim() ?? '') === '') {
                fence = undefined;
            }
            continue;
        }
        if (fenceMatch) {
            const token = fenceMatch[1] ?? '';
            fence = { marker: token[0], length: token.length };
            continue;
        }
        const heading = /^##[\t ]+(.+?)[\t ]*$/u.exec(line.text);
        if (heading?.[1])
            headings.push({ label: heading[1], start: line.start, lineEnd: line.end });
    }
    return fence ? undefined : headings;
}
function documentLineEnding(markdown) {
    const endings = markdown.match(/\r\n|\n|\r/gu);
    if (!endings?.length)
        return undefined;
    const first = endings[0];
    if ((first !== '\n' && first !== '\r\n') || endings.some((ending) => ending !== first))
        return undefined;
    return first;
}
const MARKDOWN_BLOCK_START = /^([\t ]{0,3})(#{1,6}(?:[\t ]|$)|>(?:[\t ]|$)|[-+*](?:[\t ]|$)|\d+[.)](?:[\t ]|$)|`{3}|~{3})/u;
const THEMATIC_OR_SETEXT = /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,}|=+[\t ]*)$/u;
const TABLE_DELIMITER = /^ {0,3}\|?[\t ]*:?-{3,}:?[\t ]*(?:\|[\t ]*:?-{3,}:?[\t ]*)+\|?[\t ]*$/u;
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:[\t ]*\S/u;
const HTML_BLOCK_START = /^ {0,3}<[/!?A-Za-z]/u;
function hasUnsafeBlock(line) {
    return MARKDOWN_BLOCK_START.test(line)
        || THEMATIC_OR_SETEXT.test(line)
        || TABLE_DELIMITER.test(line)
        || LINK_DEFINITION.test(line)
        || /^(?: {4}|\t)/u.test(line)
        || /<!--|-->/u.test(line)
        || HTML_BLOCK_START.test(line);
}
function parseListItems(markdownBody, lineEnding, bodyStart, allowPlain) {
    if (!markdownBody)
        return { items: [], style: 'bullet', text: '' };
    const lines = sourceLines(markdownBody, lineEnding);
    if (lines.some((line) => !line.text.trim()))
        return undefined;
    const bullet = /^- (.+)$/u.exec(lines[0]?.text ?? '');
    const style = bullet ? 'bullet' : allowPlain ? 'plain' : undefined;
    if (!style)
        return undefined;
    const items = [];
    if (style === 'plain') {
        for (const line of lines) {
            if (hasUnsafeBlock(line.text) || /^[\t ]*(?:[-+*]|\d+[.)])[\t ]+/u.test(line.text))
                return undefined;
            items.push({
                text: line.text,
                contentStart: bodyStart + line.start,
                contentEnd: bodyStart + line.contentEnd,
                itemStart: bodyStart + line.start,
                itemEnd: bodyStart + line.end,
            });
        }
    }
    else {
        const starts = [];
        for (const [index, line] of lines.entries()) {
            if (/^- (.+)$/u.test(line.text)) {
                starts.push(index);
                continue;
            }
            if (!starts.length || hasUnsafeBlock(line.text) || /^[\t ]+(?:[-+*]|\d+[.)])[\t ]+/u.test(line.text)
                || /^[+*][\t ]+/u.test(line.text) || /^\d+[.)][\t ]+/u.test(line.text))
                return undefined;
        }
        for (const [itemIndex, lineIndex] of starts.entries()) {
            const first = lines[lineIndex];
            const nextLineIndex = starts[itemIndex + 1] ?? lines.length;
            const last = lines[nextLineIndex - 1];
            const firstText = /^- (.+)$/u.exec(first.text)?.[1];
            if (!firstText)
                return undefined;
            const continuationLines = lines.slice(lineIndex + 1, nextLineIndex);
            const continuationPrefixes = continuationLines.map((line) => /^[\t ]*/u.exec(line.text)?.[0] ?? '');
            const continuation = continuationLines.map((line, index) => line.text.slice(continuationPrefixes[index]?.length ?? 0));
            items.push({
                text: [firstText, ...continuation].join(lineEnding),
                contentStart: bodyStart + first.start + 2,
                contentEnd: bodyStart + last.contentEnd,
                itemStart: bodyStart + first.start,
                itemEnd: bodyStart + (lines[nextLineIndex]?.start ?? markdownBody.length),
                continuationPrefixes,
            });
        }
    }
    return { items, style, text: items.map((item) => item.text).join(lineEnding) };
}
function plainBlockText(markdownBody, lineEnding) {
    return markdownBody
        .split(lineEnding)
        .map((line) => line.replace(/^([\t ]{0,3})\\(?=[#>*+`~_<\[|!=-])/u, '$1'))
        .join(lineEnding);
}
function isPlainBlock(markdownBody, lineEnding) {
    return sourceLines(markdownBody, lineEnding).every((line) => !hasUnsafeBlock(line.text));
}
function parseTextBlock(markdownBody, lineEnding) {
    const lines = sourceLines(markdownBody, lineEnding);
    if (lines.length && lines.every((line) => /^- (.+)$/u.test(line.text))) {
        return { style: 'bullets', text: lines.map((line) => /^- (.+)$/u.exec(line.text)?.[1] ?? '').join(lineEnding) };
    }
    return isPlainBlock(markdownBody, lineEnding)
        ? { style: 'plain', text: plainBlockText(markdownBody, lineEnding) }
        : undefined;
}
function markdownSafePlainText(text, lineEnding) {
    return text
        .split(lineEnding)
        .map((line) => {
        if (/^(?: {4}|\t)/u.test(line))
            throw new Error('Plain-text lines cannot start with four spaces or a tab');
        if (!hasUnsafeBlock(line))
            return line;
        return line.replace(/^([\t ]{0,3})(?=\S)/u, '$1\\');
    })
        .join(lineEnding);
}
/**
 * Project only Bridge's exact bilingual five-section schema into plain fields.
 * Unknown structure fails closed; known visual appendices remain opaque Markdown.
 */
export function parseBridgeTextProjection(markdown) {
    const lineEnding = documentLineEnding(markdown);
    if (!lineEnding)
        return undefined;
    const headings = markdownHeadings(markdown, lineEnding);
    if (!headings?.length || headings[0]?.start !== 0)
        return undefined;
    const lang = headings[0]?.label === TEXT_SCHEMAS.zh[0][1]
        ? 'zh'
        : headings[0]?.label === TEXT_SCHEMAS.en[0][1]
            ? 'en'
            : undefined;
    if (!lang)
        return undefined;
    const appendixIndex = headings.findIndex((heading) => TEXT_APPENDICES[lang].has(heading.label));
    const schemaHeadings = appendixIndex < 0 ? headings : headings.slice(0, appendixIndex);
    if (schemaHeadings.length !== TEXT_SCHEMAS[lang].length)
        return undefined;
    if (schemaHeadings.some((heading, index) => heading.label !== TEXT_SCHEMAS[lang][index]?.[1]))
        return undefined;
    const firstAppendix = appendixIndex < 0 ? undefined : headings[appendixIndex];
    const editableMarkdown = markdown.slice(0, firstAppendix?.start ?? markdown.length);
    if (/<!--|-->/u.test(editableMarkdown))
        return undefined;
    const sections = [];
    for (const [index, heading] of schemaHeadings.entries()) {
        const [key, label, kind] = TEXT_SCHEMAS[lang][index];
        const bodyStart = heading.lineEnd;
        const regionEnd = schemaHeadings[index + 1]?.start ?? firstAppendix?.start ?? markdown.length;
        let bodyEnd = regionEnd;
        while (bodyEnd - lineEnding.length >= bodyStart
            && markdown.slice(bodyEnd - lineEnding.length, bodyEnd) === lineEnding) {
            bodyEnd -= lineEnding.length;
        }
        const body = markdown.slice(bodyStart, bodyEnd);
        const list = kind === 'list' ? parseListItems(body, lineEnding, bodyStart, key === 'keyFiles') : undefined;
        const textBlock = kind === 'text' ? parseTextBlock(body, lineEnding) : undefined;
        if (kind === 'list' && !list)
            return undefined;
        if (kind === 'text' && !textBlock)
            return undefined;
        const text = list?.text ?? textBlock?.text ?? '';
        sections.push({
            key,
            label,
            kind,
            text,
            bodyStart,
            bodyEnd,
            ...(list ? { items: list.items, listStyle: list.style } : {}),
            ...(textBlock ? { textStyle: textBlock.style } : {}),
        });
    }
    return {
        lang,
        markdown,
        lineEnding,
        sections,
        opaqueSuffix: firstAppendix ? markdown.slice(firstAppendix.start) : '',
    };
}
function normalizeLineEndings(text, lineEnding) {
    return text.replace(/\r\n|\n|\r/gu, lineEnding);
}
/** Replace one editable body while preserving every byte outside that section. */
export function replaceBridgeTextSection(projection, key, plainText) {
    const section = projection.sections.find((candidate) => candidate.key === key);
    if (!section)
        throw new Error(`Unknown Bridge text section: ${key}`);
    if (plainText === section.text)
        return projection.markdown;
    const normalized = normalizeLineEndings(plainText, projection.lineEnding);
    let markdownBody;
    if (section.kind === 'list') {
        const values = normalized.split(projection.lineEnding);
        if (!section.items || values.length !== section.items.length || section.items.some((item) => item.text.includes(projection.lineEnding))) {
            throw new Error('Use Bridge list-item helpers for this section');
        }
        markdownBody = section.listStyle === 'plain'
            ? values.join(projection.lineEnding)
            : values.map((line) => `- ${line}`).join(projection.lineEnding);
    }
    else {
        markdownBody = section.textStyle === 'bullets'
            ? normalized.split(projection.lineEnding).map((line) => `- ${line}`).join(projection.lineEnding)
            : markdownSafePlainText(normalized, projection.lineEnding);
    }
    return projection.markdown.slice(0, section.bodyStart)
        + markdownBody
        + projection.markdown.slice(section.bodyEnd);
}
function listSection(projection, key) {
    const section = projection.sections.find((candidate) => candidate.key === key);
    if (!section || section.kind !== 'list' || !section.items || !section.listStyle) {
        throw new Error(`Unknown Bridge list section: ${key}`);
    }
    return section;
}
function editedListItem(text, style, lineEnding, original) {
    const normalized = normalizeLineEndings(text, lineEnding);
    if (!normalized.trim())
        throw new Error('Bridge list item is empty');
    const lines = normalized.split(lineEnding);
    if (lines.some((line) => hasUnsafeBlock(line)))
        throw new Error('Bridge list item contains Markdown block structure');
    if (style === 'plain' && lines.length > 1)
        throw new Error('Plain path rows must stay on one line');
    return style === 'bullet'
        ? [
            lines[0],
            ...lines.slice(1).map((line, index) => `${original?.continuationPrefixes?.[index] ?? '  '}${line}`),
        ].join(lineEnding)
        : normalized;
}
/** Replace one list item without rewriting siblings and while retaining wrapped-line indentation. */
export function replaceBridgeTextListItem(projection, key, index, plainText) {
    const section = listSection(projection, key);
    const item = section.items?.[index];
    if (!item)
        throw new Error(`Unknown Bridge list item: ${key}[${index}]`);
    if (plainText === item.text)
        return projection.markdown;
    const edited = editedListItem(plainText, section.listStyle, projection.lineEnding, item);
    return projection.markdown.slice(0, item.contentStart) + edited + projection.markdown.slice(item.contentEnd);
}
/** Remove exactly one original list-item span. */
export function removeBridgeTextListItem(projection, key, index) {
    const section = listSection(projection, key);
    const items = section.items ?? [];
    const item = items[index];
    if (!item)
        throw new Error(`Unknown Bridge list item: ${key}[${index}]`);
    const removeStart = index > 0 && index === items.length - 1
        ? item.itemStart - projection.lineEnding.length
        : item.itemStart;
    return projection.markdown.slice(0, removeStart) + projection.markdown.slice(item.itemEnd);
}
/** Append one item using the section's existing bullet/plain convention. */
export function appendBridgeTextListItem(projection, key, plainText) {
    const section = listSection(projection, key);
    const edited = editedListItem(plainText, section.listStyle, projection.lineEnding);
    const prefix = section.bodyStart === section.bodyEnd ? '' : projection.lineEnding;
    const item = section.listStyle === 'bullet' ? `- ${edited}` : edited;
    return projection.markdown.slice(0, section.bodyEnd) + prefix + item + projection.markdown.slice(section.bodyEnd);
}
function previewHeaderOf(line) {
    const prefix = line.startsWith('─── Handoff · ')
        ? { text: '─── Handoff · ', lang: 'en' }
        : line.startsWith('─── 交接摘要 · ')
            ? { text: '─── 交接摘要 · ', lang: 'zh' }
            : undefined;
    if (!prefix)
        return undefined;
    const route = line.slice(prefix.text.length);
    const arrow = route.indexOf('→');
    if (arrow < 1)
        return undefined;
    const sourcePreset = route.slice(0, arrow).trim();
    const targetTail = route.slice(arrow + 1).trimStart();
    let targetEnd = 0;
    while (targetEnd < targetTail.length) {
        const char = targetTail[targetEnd];
        if (char === undefined || /\s/u.test(char) || char === '(' || char === '（' || char === '─')
            break;
        targetEnd += 1;
    }
    const targetPreset = targetTail.slice(0, targetEnd);
    if (!sourcePreset || !targetPreset)
        return undefined;
    return { lang: prefix.lang, sourcePreset, targetPreset };
}
function isDivider(line) {
    const trimmed = line.trim();
    return trimmed.length >= 10 && [...trimmed].every((char) => char === '─');
}
function languageOf(text) {
    return /[\u3400-\u9fff]/u.test(text) ? 'zh' : 'en';
}
/** Map the official WebUI document language onto Bridge's supported UI copy. */
export function uiLanguageOf(documentLang) {
    return documentLang?.toLowerCase().startsWith('zh') === true ? 'zh' : 'en';
}
function parsePreview(text) {
    const lines = text.split('\n');
    const header = previewHeaderOf(lines[0] ?? '');
    if (!header)
        return undefined;
    const divider = lines.findIndex((line, index) => index > 0 && isDivider(line));
    if (divider < 2)
        return undefined;
    const command = RUN_COMMAND.exec(text);
    const targetPreset = command?.[1] ?? header.targetPreset;
    if (!targetPreset)
        return undefined;
    const tail = lines.slice(divider + 1);
    const stats = tail.find((line) => line.trim() !== '' && !line.startsWith('⚠') && !RUN_COMMAND.test(line)) ?? '';
    const warnings = tail
        .filter((line) => line.startsWith('⚠'))
        .map((line) => line.replace(/^⚠\s*/u, ''));
    const previewIdLine = tail.find((line) => line.startsWith('Preview ID:') || line.startsWith('预览 ID：'));
    const previewId = previewIdLine?.slice(previewIdLine.indexOf(previewIdLine.startsWith('Preview') ? ':' : '：') + 1).trim();
    const fileLine = tail.find((line) => line.includes(' --file '));
    const fileMarker = fileLine?.lastIndexOf(' --file ') ?? -1;
    const summaryFile = fileMarker < 0 ? undefined : fileLine?.slice(fileMarker + ' --file '.length).trim().split(/\s/u)[0];
    return {
        phase: 'preview',
        lang: header.lang,
        sourcePreset: header.sourcePreset,
        targetPreset,
        ...(previewId ? { previewId } : {}),
        summary: lines.slice(1, divider).join('\n').trim(),
        ...(summaryFile ? { summaryFile } : {}),
        stats,
        warnings,
    };
}
function parseMigrated(text) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const first = lines[0] ?? '';
    const lang = first.startsWith('Created a new session') ? 'en' : 'zh';
    const presetPrefix = lang === 'en' ? 'Created a new session in the ' : '已在 ';
    const presetSuffix = lang === 'en' ? ' preset' : ' 模式下建好新会话';
    const presetEnd = first.indexOf(presetSuffix, presetPrefix.length);
    const preset = presetEnd < 0 ? undefined : first.slice(presetPrefix.length, presetEnd).trim();
    if (!preset)
        return undefined;
    const targetIndex = lines.findIndex((line) => line.startsWith('Target session:') || line.startsWith('目标会话：'));
    if (targetIndex < 0)
        return undefined;
    const targetLine = lines[targetIndex] ?? '';
    const targetPrefix = targetLine.startsWith('Target session:') ? 'Target session:' : '目标会话：';
    const targetPayload = targetLine.slice(targetPrefix.length).trim();
    const targetSeparator = targetPayload.lastIndexOf(' · ');
    if (targetSeparator < 1)
        return undefined;
    const title = targetPayload.slice(0, targetSeparator).trim();
    const sessionId = targetPayload.slice(targetSeparator + 3).trim();
    if (!title || !sessionId || /\s/u.test(sessionId))
        return undefined;
    const remaining = lines.filter((_, index) => index !== 0 && index !== targetIndex);
    return {
        phase: 'migrated',
        lang,
        targetPreset: preset,
        title,
        sessionId,
        details: remaining.filter((line) => !line.startsWith('⚠')),
        warnings: remaining.filter((line) => line.startsWith('⚠')).map((line) => line.replace(/^⚠\s*/u, '')),
    };
}
/** Convert one durable `/bridge` outcome into the native card's view model. */
export function parseBridgeCard(outcome) {
    if (outcome === null)
        return { phase: 'running' };
    const text = outcome.text?.trim() ?? '';
    if (outcome.kind === 'error')
        return { phase: 'error', text };
    return parsePreview(text)
        ?? parseMigrated(text)
        ?? { phase: 'message', text, lang: languageOf(text) };
}
/** Return a value only when the complete editor document is valid JSON. */
export function parseJsonDocument(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
        return undefined;
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function encodeUtf8Base64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
/** Build the hidden-input-safe command used by the native editor confirmation. */
export function buildBridgeMigrationCommand(targetPreset, summary, lang, previewId) {
    if (!/^[A-Za-z0-9._-]+$/u.test(targetPreset))
        throw new Error('Unsupported target preset id');
    if (lang !== 'zh' && lang !== 'en')
        throw new Error('Unsupported Bridge language');
    if (!/^[A-Za-z0-9-]{8,}$/u.test(previewId))
        throw new Error('Unsupported Bridge preview ID');
    if (!summary.trim())
        throw new Error('The handoff summary is empty');
    if (summary.length > MAX_EDITED_SUMMARY_CHARS) {
        throw new Error(`The handoff summary exceeds ${MAX_EDITED_SUMMARY_CHARS} characters`);
    }
    return `/bridge ${targetPreset} --go --lang ${lang} --preview-id ${previewId} --summary64 ${encodeUtf8Base64Url(summary)}`;
}
