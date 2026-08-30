window.__ModuleLoader__.load({
	id: "dsh-plugin-bridge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client-contract.ts
		/** Pure wire-to-view helpers shared by the native WebUI card and Node tests. */
		const MAX_EDITED_SUMMARY_CHARS = 24e3;
		const RUN_COMMAND = /\/bridge\s+([^\s]+)\s+--go(?:\s|$)/u;
		const TEXT_SCHEMAS = {
			zh: [
				[
					"goal",
					"目标",
					"text"
				],
				[
					"currentState",
					"当前状态",
					"text"
				],
				[
					"keyDecisions",
					"关键决策与约定",
					"list"
				],
				[
					"keyFiles",
					"关键文件",
					"list"
				],
				[
					"nextStep",
					"下一步",
					"text"
				]
			],
			en: [
				[
					"goal",
					"Goal",
					"text"
				],
				[
					"currentState",
					"Current state",
					"text"
				],
				[
					"keyDecisions",
					"Key decisions & conventions",
					"list"
				],
				[
					"keyFiles",
					"Key files",
					"list"
				],
				[
					"nextStep",
					"Next step",
					"text"
				]
			]
		};
		const TEXT_APPENDICES = {
			zh: /* @__PURE__ */ new Set(["视觉证据——原文搬运，未经二次摘要", "未解析图片"]),
			en: /* @__PURE__ */ new Set(["Visual evidence — verbatim, not summarized", "Unresolved images"])
		};
		function sourceLines(markdown, lineEnding) {
			const lines = [];
			let start = 0;
			while (start <= markdown.length) {
				const next = markdown.indexOf(lineEnding, start);
				if (next < 0) {
					lines.push({
						start,
						contentEnd: markdown.length,
						end: markdown.length,
						text: markdown.slice(start)
					});
					break;
				}
				lines.push({
					start,
					contentEnd: next,
					end: next + lineEnding.length,
					text: markdown.slice(start, next)
				});
				start = next + lineEnding.length;
				if (start === markdown.length) {
					lines.push({
						start,
						contentEnd: start,
						end: start,
						text: ""
					});
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
					if (fenceMatch && fenceMatch[1]?.[0] === fence.marker && (fenceMatch[1]?.length ?? 0) >= fence.length && (fenceMatch[2]?.trim() ?? "") === "") fence = void 0;
					continue;
				}
				if (fenceMatch) {
					const token = fenceMatch[1] ?? "";
					fence = {
						marker: token[0],
						length: token.length
					};
					continue;
				}
				if (!line.text.startsWith("##")) continue;
				const rest = line.text.slice(2);
				if (rest[0] !== " " && rest[0] !== "	") continue;
				let labelStart = 0;
				while (labelStart < rest.length && (rest[labelStart] === " " || rest[labelStart] === "	")) labelStart += 1;
				let labelEnd = rest.length;
				while (labelEnd > labelStart && (rest[labelEnd - 1] === " " || rest[labelEnd - 1] === "	")) labelEnd -= 1;
				if (labelEnd > labelStart) headings.push({
					label: rest.slice(labelStart, labelEnd),
					start: line.start,
					lineEnd: line.end
				});
			}
			return fence ? void 0 : headings;
		}
		function documentLineEnding(markdown) {
			const endings = markdown.match(/\r\n|\n|\r/gu);
			if (!endings?.length) return void 0;
			const first = endings[0];
			if (first !== "\n" && first !== "\r\n" || endings.some((ending) => ending !== first)) return void 0;
			return first;
		}
		const MARKDOWN_BLOCK_START = /^([\t ]{0,3})(#{1,6}(?:[\t ]|$)|>(?:[\t ]|$)|[-+*](?:[\t ]|$)|\d+[.)](?:[\t ]|$)|`{3}|~{3})/u;
		const THEMATIC_OR_SETEXT = /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,}|=+[\t ]*)$/u;
		const TABLE_DELIMITER = /^ {0,3}\|?[\t ]*:?-{3,}:?[\t ]*(?:\|[\t ]*:?-{3,}:?[\t ]*)+\|?[\t ]*$/u;
		const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:[\t ]*\S/u;
		const HTML_BLOCK_START = /^ {0,3}<[/!?A-Za-z]/u;
		function hasUnsafeBlock(line) {
			return MARKDOWN_BLOCK_START.test(line) || THEMATIC_OR_SETEXT.test(line) || TABLE_DELIMITER.test(line) || LINK_DEFINITION.test(line) || /^(?: {4}|\t)/u.test(line) || line.includes("<!--") || line.includes("-->") || line.includes("--!>") || HTML_BLOCK_START.test(line);
		}
		function parseListItems(markdownBody, lineEnding, bodyStart, allowPlain) {
			if (!markdownBody) return {
				items: [],
				style: "bullet",
				text: ""
			};
			const lines = sourceLines(markdownBody, lineEnding);
			if (lines.some((line) => !line.text.trim())) return void 0;
			const style = /^- (.+)$/u.exec(lines[0]?.text ?? "") ? "bullet" : allowPlain ? "plain" : void 0;
			if (!style) return void 0;
			const items = [];
			if (style === "plain") for (const line of lines) {
				if (hasUnsafeBlock(line.text) || /^[\t ]*(?:[-+*]|\d+[.)])[\t ]+/u.test(line.text)) return void 0;
				items.push({
					text: line.text,
					contentStart: bodyStart + line.start,
					contentEnd: bodyStart + line.contentEnd,
					itemStart: bodyStart + line.start,
					itemEnd: bodyStart + line.end
				});
			}
			else {
				const starts = [];
				for (const [index, line] of lines.entries()) {
					if (/^- (.+)$/u.test(line.text)) {
						starts.push(index);
						continue;
					}
					if (!starts.length || hasUnsafeBlock(line.text) || /^[\t ]+(?:[-+*]|\d+[.)])[\t ]+/u.test(line.text) || /^[+*][\t ]+/u.test(line.text) || /^\d+[.)][\t ]+/u.test(line.text)) return void 0;
				}
				for (const [itemIndex, lineIndex] of starts.entries()) {
					const first = lines[lineIndex];
					const nextLineIndex = starts[itemIndex + 1] ?? lines.length;
					const last = lines[nextLineIndex - 1];
					const firstText = /^- (.+)$/u.exec(first.text)?.[1];
					if (!firstText) return void 0;
					const continuationLines = lines.slice(lineIndex + 1, nextLineIndex);
					const continuationPrefixes = continuationLines.map((line) => /^[\t ]*/u.exec(line.text)?.[0] ?? "");
					const continuation = continuationLines.map((line, index) => line.text.slice(continuationPrefixes[index]?.length ?? 0));
					items.push({
						text: [firstText, ...continuation].join(lineEnding),
						contentStart: bodyStart + first.start + 2,
						contentEnd: bodyStart + last.contentEnd,
						itemStart: bodyStart + first.start,
						itemEnd: bodyStart + (lines[nextLineIndex]?.start ?? markdownBody.length),
						continuationPrefixes
					});
				}
			}
			return {
				items,
				style,
				text: items.map((item) => item.text).join(lineEnding)
			};
		}
		function plainBlockText(markdownBody, lineEnding) {
			return markdownBody.split(lineEnding).map((line) => line.replace(/^([\t ]{0,3})\\(?=[#>*+`~_<\[|!=-])/u, "$1")).join(lineEnding);
		}
		function isPlainBlock(markdownBody, lineEnding) {
			return sourceLines(markdownBody, lineEnding).every((line) => !hasUnsafeBlock(line.text));
		}
		function parseTextBlock(markdownBody, lineEnding) {
			const lines = sourceLines(markdownBody, lineEnding);
			if (lines.length && lines.every((line) => /^- (.+)$/u.test(line.text))) return {
				style: "bullets",
				text: lines.map((line) => /^- (.+)$/u.exec(line.text)?.[1] ?? "").join(lineEnding)
			};
			return isPlainBlock(markdownBody, lineEnding) ? {
				style: "plain",
				text: plainBlockText(markdownBody, lineEnding)
			} : void 0;
		}
		function markdownSafePlainText(text, lineEnding) {
			return text.split(lineEnding).map((line) => {
				if (/^(?: {4}|\t)/u.test(line)) throw new Error("Plain-text lines cannot start with four spaces or a tab");
				if (!hasUnsafeBlock(line)) return line;
				return line.replace(/^([\t ]{0,3})(?=\S)/u, "$1\\");
			}).join(lineEnding);
		}
		/**
		* Project only Bridge's exact bilingual five-section schema into plain fields.
		* Unknown structure fails closed; known visual appendices remain opaque Markdown.
		*/
		function parseBridgeTextProjection(markdown) {
			const lineEnding = documentLineEnding(markdown);
			if (!lineEnding) return void 0;
			const headings = markdownHeadings(markdown, lineEnding);
			if (!headings?.length || headings[0]?.start !== 0) return void 0;
			const lang = headings[0]?.label === TEXT_SCHEMAS.zh[0][1] ? "zh" : headings[0]?.label === TEXT_SCHEMAS.en[0][1] ? "en" : void 0;
			if (!lang) return void 0;
			const appendixIndex = headings.findIndex((heading) => TEXT_APPENDICES[lang].has(heading.label));
			const schemaHeadings = appendixIndex < 0 ? headings : headings.slice(0, appendixIndex);
			if (schemaHeadings.length !== TEXT_SCHEMAS[lang].length) return void 0;
			if (schemaHeadings.some((heading, index) => heading.label !== TEXT_SCHEMAS[lang][index]?.[1])) return void 0;
			const firstAppendix = appendixIndex < 0 ? void 0 : headings[appendixIndex];
			const editableMarkdown = markdown.slice(0, firstAppendix?.start ?? markdown.length);
			if (editableMarkdown.includes("<!--") || editableMarkdown.includes("-->") || editableMarkdown.includes("--!>")) return void 0;
			const sections = [];
			for (const [index, heading] of schemaHeadings.entries()) {
				const [key, label, kind] = TEXT_SCHEMAS[lang][index];
				const bodyStart = heading.lineEnd;
				let bodyEnd = schemaHeadings[index + 1]?.start ?? firstAppendix?.start ?? markdown.length;
				while (bodyEnd - lineEnding.length >= bodyStart && markdown.slice(bodyEnd - lineEnding.length, bodyEnd) === lineEnding) bodyEnd -= lineEnding.length;
				const body = markdown.slice(bodyStart, bodyEnd);
				const list = kind === "list" ? parseListItems(body, lineEnding, bodyStart, key === "keyFiles") : void 0;
				const textBlock = kind === "text" ? parseTextBlock(body, lineEnding) : void 0;
				if (kind === "list" && !list) return void 0;
				if (kind === "text" && !textBlock) return void 0;
				const text = list?.text ?? textBlock?.text ?? "";
				sections.push({
					key,
					label,
					kind,
					text,
					bodyStart,
					bodyEnd,
					...list ? {
						items: list.items,
						listStyle: list.style
					} : {},
					...textBlock ? { textStyle: textBlock.style } : {}
				});
			}
			return {
				lang,
				markdown,
				lineEnding,
				sections,
				opaqueSuffix: firstAppendix ? markdown.slice(firstAppendix.start) : ""
			};
		}
		function normalizeLineEndings(text, lineEnding) {
			return text.replace(/\r\n|\n|\r/gu, lineEnding);
		}
		/** Replace one editable body while preserving every byte outside that section. */
		function replaceBridgeTextSection(projection, key, plainText) {
			const section = projection.sections.find((candidate) => candidate.key === key);
			if (!section) throw new Error(`Unknown Bridge text section: ${key}`);
			if (plainText === section.text) return projection.markdown;
			const normalized = normalizeLineEndings(plainText, projection.lineEnding);
			let markdownBody;
			if (section.kind === "list") {
				const values = normalized.split(projection.lineEnding);
				if (!section.items || values.length !== section.items.length || section.items.some((item) => item.text.includes(projection.lineEnding))) throw new Error("Use Bridge list-item helpers for this section");
				markdownBody = section.listStyle === "plain" ? values.join(projection.lineEnding) : values.map((line) => `- ${line}`).join(projection.lineEnding);
			} else markdownBody = section.textStyle === "bullets" ? normalized.split(projection.lineEnding).map((line) => `- ${line}`).join(projection.lineEnding) : markdownSafePlainText(normalized, projection.lineEnding);
			return projection.markdown.slice(0, section.bodyStart) + markdownBody + projection.markdown.slice(section.bodyEnd);
		}
		function listSection(projection, key) {
			const section = projection.sections.find((candidate) => candidate.key === key);
			if (!section || section.kind !== "list" || !section.items || !section.listStyle) throw new Error(`Unknown Bridge list section: ${key}`);
			return section;
		}
		function editedListItem(text, style, lineEnding, original) {
			const normalized = normalizeLineEndings(text, lineEnding);
			if (!normalized.trim()) throw new Error("Bridge list item is empty");
			const lines = normalized.split(lineEnding);
			if (lines.some((line) => hasUnsafeBlock(line))) throw new Error("Bridge list item contains Markdown block structure");
			if (style === "plain" && lines.length > 1) throw new Error("Plain path rows must stay on one line");
			return style === "bullet" ? [lines[0], ...lines.slice(1).map((line, index) => `${original?.continuationPrefixes?.[index] ?? "  "}${line}`)].join(lineEnding) : normalized;
		}
		/** Replace one list item without rewriting siblings and while retaining wrapped-line indentation. */
		function replaceBridgeTextListItem(projection, key, index, plainText) {
			const section = listSection(projection, key);
			const item = section.items?.[index];
			if (!item) throw new Error(`Unknown Bridge list item: ${key}[${index}]`);
			if (plainText === item.text) return projection.markdown;
			const edited = editedListItem(plainText, section.listStyle, projection.lineEnding, item);
			return projection.markdown.slice(0, item.contentStart) + edited + projection.markdown.slice(item.contentEnd);
		}
		/** Remove exactly one original list-item span. */
		function removeBridgeTextListItem(projection, key, index) {
			const items = listSection(projection, key).items ?? [];
			const item = items[index];
			if (!item) throw new Error(`Unknown Bridge list item: ${key}[${index}]`);
			const removeStart = index > 0 && index === items.length - 1 ? item.itemStart - projection.lineEnding.length : item.itemStart;
			return projection.markdown.slice(0, removeStart) + projection.markdown.slice(item.itemEnd);
		}
		/** Append one item using the section's existing bullet/plain convention. */
		function appendBridgeTextListItem(projection, key, plainText) {
			const section = listSection(projection, key);
			const edited = editedListItem(plainText, section.listStyle, projection.lineEnding);
			const prefix = section.bodyStart === section.bodyEnd ? "" : projection.lineEnding;
			const item = section.listStyle === "bullet" ? `- ${edited}` : edited;
			return projection.markdown.slice(0, section.bodyEnd) + prefix + item + projection.markdown.slice(section.bodyEnd);
		}
		function previewHeaderOf(line) {
			const prefix = line.startsWith("─── Handoff · ") ? {
				text: "─── Handoff · ",
				lang: "en"
			} : line.startsWith("─── 交接摘要 · ") ? {
				text: "─── 交接摘要 · ",
				lang: "zh"
			} : void 0;
			if (!prefix) return void 0;
			const route = line.slice(prefix.text.length);
			const arrow = route.indexOf("→");
			if (arrow < 1) return void 0;
			const sourcePreset = route.slice(0, arrow).trim();
			const targetTail = route.slice(arrow + 1).trimStart();
			let targetEnd = 0;
			while (targetEnd < targetTail.length) {
				const char = targetTail[targetEnd];
				if (char === void 0 || /\s/u.test(char) || char === "(" || char === "（" || char === "─") break;
				targetEnd += 1;
			}
			const targetPreset = targetTail.slice(0, targetEnd);
			if (!sourcePreset || !targetPreset) return void 0;
			return {
				lang: prefix.lang,
				sourcePreset,
				targetPreset
			};
		}
		function isDivider(line) {
			const trimmed = line.trim();
			return trimmed.length >= 10 && [...trimmed].every((char) => char === "─");
		}
		function languageOf(text) {
			return /[\u3400-\u9fff]/u.test(text) ? "zh" : "en";
		}
		/** Map the official WebUI document language onto Bridge's supported UI copy. */
		function uiLanguageOf(documentLang) {
			return documentLang?.toLowerCase().startsWith("zh") === true ? "zh" : "en";
		}
		function parsePreview(text) {
			const lines = text.split("\n");
			const header = previewHeaderOf(lines[0] ?? "");
			if (!header) return void 0;
			const divider = lines.findIndex((line, index) => index > 0 && isDivider(line));
			if (divider < 2) return void 0;
			const targetPreset = RUN_COMMAND.exec(text)?.[1] ?? header.targetPreset;
			if (!targetPreset) return void 0;
			const tail = lines.slice(divider + 1);
			const stats = tail.find((line) => line.trim() !== "" && !line.startsWith("⚠") && !RUN_COMMAND.test(line)) ?? "";
			const warnings = tail.filter((line) => line.startsWith("⚠")).map((line) => line.replace(/^⚠\s*/u, ""));
			const previewIdLine = tail.find((line) => line.startsWith("Preview ID:") || line.startsWith("预览 ID："));
			const previewId = previewIdLine?.slice(previewIdLine.indexOf(previewIdLine.startsWith("Preview") ? ":" : "：") + 1).trim();
			const fileLine = tail.find((line) => line.includes(" --file "));
			const fileMarker = fileLine?.lastIndexOf(" --file ") ?? -1;
			const summaryFile = fileMarker < 0 ? void 0 : fileLine?.slice(fileMarker + 8).trim().split(/\s/u)[0];
			return {
				phase: "preview",
				lang: header.lang,
				sourcePreset: header.sourcePreset,
				targetPreset,
				...previewId ? { previewId } : {},
				summary: lines.slice(1, divider).join("\n").trim(),
				...summaryFile ? { summaryFile } : {},
				stats,
				warnings
			};
		}
		function parseMigrated(text) {
			const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
			const first = lines[0] ?? "";
			const lang = first.startsWith("Created a new session") ? "en" : "zh";
			const presetPrefix = lang === "en" ? "Created a new session in the " : "已在 ";
			const presetSuffix = lang === "en" ? " preset" : " 模式下建好新会话";
			const presetEnd = first.indexOf(presetSuffix, presetPrefix.length);
			const preset = presetEnd < 0 ? void 0 : first.slice(presetPrefix.length, presetEnd).trim();
			if (!preset) return void 0;
			const targetIndex = lines.findIndex((line) => line.startsWith("Target session:") || line.startsWith("目标会话："));
			if (targetIndex < 0) return void 0;
			const targetLine = lines[targetIndex] ?? "";
			const targetPrefix = targetLine.startsWith("Target session:") ? "Target session:" : "目标会话：";
			const targetPayload = targetLine.slice(targetPrefix.length).trim();
			const targetSeparator = targetPayload.lastIndexOf(" · ");
			if (targetSeparator < 1) return void 0;
			const title = targetPayload.slice(0, targetSeparator).trim();
			const sessionId = targetPayload.slice(targetSeparator + 3).trim();
			if (!title || !sessionId || /\s/u.test(sessionId)) return void 0;
			const remaining = lines.filter((_, index) => index !== 0 && index !== targetIndex);
			return {
				phase: "migrated",
				lang,
				targetPreset: preset,
				title,
				sessionId,
				details: remaining.filter((line) => !line.startsWith("⚠")),
				warnings: remaining.filter((line) => line.startsWith("⚠")).map((line) => line.replace(/^⚠\s*/u, ""))
			};
		}
		/** Convert one durable `/bridge` outcome into the native card's view model. */
		function parseBridgeCard(outcome) {
			if (outcome === null) return { phase: "running" };
			const text = outcome.text?.trim() ?? "";
			if (outcome.kind === "error") return {
				phase: "error",
				text
			};
			return parsePreview(text) ?? parseMigrated(text) ?? {
				phase: "message",
				text,
				lang: languageOf(text)
			};
		}
		/** Return a value only when the complete editor document is valid JSON. */
		function parseJsonDocument(text) {
			const trimmed = text.trim();
			if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return void 0;
			try {
				const parsed = JSON.parse(trimmed);
				return typeof parsed === "object" && parsed !== null ? parsed : void 0;
			} catch {
				return;
			}
		}
		function encodeUtf8Base64Url(text) {
			const bytes = new TextEncoder().encode(text);
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
		}
		/** Build the hidden-input-safe command used by the native editor confirmation. */
		function buildBridgeMigrationCommand(targetPreset, summary, lang, previewId) {
			if (!/^[A-Za-z0-9._-]+$/u.test(targetPreset)) throw new Error("Unsupported target preset id");
			if (lang !== "zh" && lang !== "en") throw new Error("Unsupported Bridge language");
			if (!/^[A-Za-z0-9-]{8,}$/u.test(previewId)) throw new Error("Unsupported Bridge preview ID");
			if (!summary.trim()) throw new Error("The handoff summary is empty");
			if (summary.length > 24e3) throw new Error(`The handoff summary exceeds ${MAX_EDITED_SUMMARY_CHARS} characters`);
			return `/bridge ${targetPreset} --go --lang ${lang} --preview-id ${previewId} --summary64 ${encodeUtf8Base64Url(summary)}`;
		}
		//#endregion
		//#region src/client.tsx
		/** Official WebUI half: one native `/bridge` command card, not a second WebUI. */
		const STYLE_ID = "dsh-plugin-bridge/native-card";
		const STYLE = `
.dsh-bridge-card{border:1px solid var(--dsw-alias-border-subtle,light-dark(#dedede,#3f3f46));border-radius:12px;background:var(--dsw-alias-background-primary,light-dark(#fff,#18181b));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5));overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dsh-bridge-head{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-subtle,light-dark(#e6e6e6,#3f3f46));background:var(--dsw-alias-background-secondary,light-dark(#fafafa,#202024))}
.dsh-bridge-mark{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--dsw-alias-state-business-secondary,light-dark(#e8f1ff,#22325c));color:var(--dsw-alias-state-business-primary,light-dark(#2869d8,#8eaeff));font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-bridge-title{min-width:0;flex:1;font-size:13px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-bridge-route{font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,light-dark(#666,#a1a1aa))}
.dsh-bridge-body{padding:14px}.dsh-bridge-copy{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary,light-dark(#5f6368,#b4b4bd))}
.dsh-bridge-toolbar{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}.dsh-bridge-tabs{display:inline-flex;flex-shrink:0;padding:2px;border-radius:8px;background:var(--dsw-alias-background-tertiary,light-dark(#f1f2f4,#29292e))}
.dsh-bridge-button,.dsh-bridge-tab{border:0;border-radius:7px;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background-color .15s ease,color .15s ease,transform .1s ease}
.dsh-bridge-tab{padding:7px 10px;background:transparent;color:var(--dsw-alias-label-secondary,light-dark(#666,#a1a1aa))}.dsh-bridge-tab[aria-selected=true]{background:var(--dsw-alias-background-primary,light-dark(#fff,#3a3a40));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5));box-shadow:0 1px 2px rgba(0,0,0,.18)}
.dsh-bridge-button{padding:8px 11px;background:var(--dsw-alias-background-tertiary,light-dark(#f1f2f4,#303036));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5))}.dsh-bridge-button[data-primary=true]{background:var(--dsw-alias-state-business-primary,light-dark(#2869d8,#4f7ee8));color:#fff}.dsh-bridge-button:disabled{cursor:not-allowed;opacity:.55}.dsh-bridge-button:not(:disabled):active{transform:translateY(1px)}
.dsh-bridge-actions{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}.dsh-bridge-panel{box-sizing:border-box;max-height:min(56vh,520px);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:14px;border:1px solid var(--dsw-alias-border-subtle,light-dark(#e3e5e8,#3f3f46));border-radius:9px;background:var(--dsw-alias-background-primary,light-dark(#fff,#18181b))}
.dsh-bridge-preview{min-width:0}.dsh-bridge-markdown-editor,.dsh-bridge-text-editor,.dsh-bridge-list-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-strong,light-dark(#c8ccd2,#52525b));border-radius:8px;outline:none;background:var(--dsw-alias-background-primary,light-dark(#fff,#202024));color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5))}
.dsh-bridge-markdown-editor{min-height:360px;resize:vertical;padding:13px 14px;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2}.dsh-bridge-text-editor{min-height:92px;resize:vertical;padding:10px 11px;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.dsh-bridge-list-input{min-width:0;min-height:34px;resize:vertical;padding:9px 10px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dsh-bridge-markdown-editor:focus,.dsh-bridge-text-editor:focus,.dsh-bridge-list-input:focus{border-color:var(--dsw-alias-state-business-primary,#2869d8);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#2869d8) 18%,transparent)}
.dsh-bridge-form{display:grid;gap:14px}.dsh-bridge-field{display:grid;gap:7px}.dsh-bridge-field-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.dsh-bridge-field-label{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary,light-dark(#171717,#f4f4f5))}.dsh-bridge-field-help{font-size:11px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa))}
.dsh-bridge-list{display:grid;gap:7px}.dsh-bridge-list-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center}.dsh-bridge-list-button{align-self:center;padding:8px 9px}.dsh-bridge-add-button{justify-self:start}.dsh-bridge-appendix{display:grid;gap:7px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-subtle,light-dark(#e3e5e8,#3f3f46))}.dsh-bridge-appendix-copy{font-size:11px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa))}
.dsh-bridge-notice{padding:12px;border-radius:8px;background:var(--dsw-alias-background-secondary,light-dark(#f7f8fa,#29292e));font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary,light-dark(#5f6368,#b4b4bd))}.dsh-bridge-notice-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.dsh-bridge-draft-notice{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-state-warn-secondary,light-dark(#fff5d8,#443814));color:var(--dsw-alias-state-warn-primary,light-dark(#785a00,#f3d36b));font-size:12px}.dsh-bridge-draft-notice .dsh-bridge-actions{margin-left:0}
.dsh-bridge-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa));font-size:11px}.dsh-bridge-chip{padding:4px 7px;border-radius:999px;background:var(--dsw-alias-background-tertiary,light-dark(#f2f3f5,#29292e))}
.dsh-bridge-warning,.dsh-bridge-error{margin-top:10px;padding:9px 10px;border-radius:8px;font-size:12px;line-height:1.45}.dsh-bridge-warning{background:var(--dsw-alias-state-warn-secondary,light-dark(#fff5d8,#443814));color:var(--dsw-alias-state-warn-primary,light-dark(#785a00,#f3d36b))}.dsh-bridge-error{background:var(--dsw-alias-state-error-secondary,light-dark(#ffe9e7,#4a2325));color:var(--dsw-alias-state-error-primary,light-dark(#b3261e,#ffaaa4));white-space:pre-wrap}
.dsh-bridge-progress{height:3px;margin-top:12px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-background-tertiary,light-dark(#eceef1,#303036))}.dsh-bridge-progress::after{content:"";display:block;width:42%;height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary,light-dark(#2869d8,#6d92ff));animation:dsh-bridge-scan 1.35s ease-in-out infinite}
.dsh-bridge-success{display:grid;gap:10px}.dsh-bridge-session{padding:10px;border-radius:8px;background:var(--dsw-alias-state-success-secondary,light-dark(#e8f7ed,#183a26));font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.dsh-bridge-status{min-height:18px;font-size:11px;color:var(--dsw-alias-label-tertiary,light-dark(#85898f,#a1a1aa))}
.dsh-bridge-button:focus-visible,.dsh-bridge-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2869d8);outline-offset:2px}@keyframes dsh-bridge-scan{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}
@media(max-width:640px){.dsh-bridge-head{align-items:flex-start;flex-wrap:wrap;padding-block:10px}.dsh-bridge-route{width:100%;padding-left:32px}.dsh-bridge-toolbar{align-items:stretch;flex-direction:column}.dsh-bridge-tabs{align-self:flex-start;max-width:100%;overflow-x:auto}.dsh-bridge-panel{max-height:52vh;padding:11px}.dsh-bridge-actions{width:100%;margin-left:0}.dsh-bridge-toolbar>.dsh-bridge-actions .dsh-bridge-button{flex:1}.dsh-bridge-draft-notice{align-items:flex-start;flex-direction:column}.dsh-bridge-list-row{grid-template-columns:minmax(0,1fr)}}
@media(prefers-reduced-motion:reduce){.dsh-bridge-progress::after{animation:none;width:65%}.dsh-bridge-button,.dsh-bridge-tab{transition:none}}
`;
		const COPY = {
			zh: {
				title: "会话迁移",
				preparing: "正在生成可编辑的交接摘要",
				safe: "原会话不会被修改",
				preview: "预览",
				text: "文本编辑",
				markdownSource: "Markdown",
				copy: "复制摘要",
				copied: "已复制",
				confirm: "确认迁移",
				confirming: "正在创建目标会话…",
				open: "打开目标会话",
				opening: "正在打开目标会话…",
				json: "JSON 结构",
				markdownPreview: "Markdown 预览",
				markdownEditor: "交接摘要 Markdown 编辑器",
				chars: "字符",
				listHelp: "每行一项，无需输入 Markdown 符号",
				addItem: "添加一项",
				removeItem: "删除此项",
				appendix: "附录（只读）",
				appendixHelp: "视觉证据与未解析图片会原样保留；需要修改请切换到 Markdown。",
				textUnavailable: "这份摘要不是可无损转换的标准五段格式。内容没有被修改，请使用 Markdown 编辑。",
				editMarkdown: "使用 Markdown",
				newPreview: "检测到新的预览；当前编辑稿不会被自动覆盖。",
				keepDraft: "保留编辑稿",
				loadPreview: "加载新预览",
				renderFailure: "Bridge 卡片渲染失败；其他插件和会话不受影响。",
				tooLong: `摘要超过 WebUI 的 ${MAX_EDITED_SUMMARY_CHARS.toLocaleString()} 字符安全上限，请使用摘要文件回退。`,
				fileFallback: "摘要文件",
				stalePreview: "这张旧预览没有安全确认标识。请重新运行 /bridge 生成预览，或使用摘要文件流程。"
			},
			en: {
				title: "Session handoff",
				preparing: "Generating an editable handoff preview",
				safe: "The source session stays untouched",
				preview: "Preview",
				text: "Text",
				markdownSource: "Markdown",
				copy: "Copy summary",
				copied: "Copied",
				confirm: "Confirm migration",
				confirming: "Creating the target session…",
				open: "Open target session",
				opening: "Opening target session…",
				json: "JSON structure",
				markdownPreview: "Markdown preview",
				markdownEditor: "Handoff summary Markdown editor",
				chars: "chars",
				listHelp: "One item per line; no Markdown markers needed",
				addItem: "Add item",
				removeItem: "Remove item",
				appendix: "Appendix (read only)",
				appendixHelp: "Visual evidence and unresolved images stay exact; use Markdown to edit them.",
				textUnavailable: "This handoff is not a losslessly editable five-section document. Nothing changed; use Markdown instead.",
				editMarkdown: "Use Markdown",
				newPreview: "A newer preview arrived. Your draft was not overwritten.",
				keepDraft: "Keep draft",
				loadPreview: "Load new preview",
				renderFailure: "The Bridge card failed to render. Other plugins and sessions are unaffected.",
				tooLong: `The handoff exceeds the ${MAX_EDITED_SUMMARY_CHARS.toLocaleString()}-character WebUI safety limit. Use the summary-file fallback.`,
				fileFallback: "Summary file",
				stalePreview: "This older preview has no secure confirmation ID. Run /bridge again or use the summary-file workflow."
			}
		};
		const PRIMITIVE_LABELS = {
			zh: {
				markdown: {
					code: {
						copyLabel: "复制",
						copiedLabel: "已复制"
					},
					footnotes: "脚注"
				},
				json: {
					copyValue: "复制值",
					copyJson: "复制 JSON",
					copyPath: "复制属性路径",
					copyPrettyJson: "复制格式化 JSON",
					copyCompactJson: "复制紧凑 JSON",
					copied: "已复制",
					copyFailed: "复制失败",
					collapseNode: "折叠 JSON 节点",
					expandNode: "展开 JSON 节点",
					copyButtonTitle: (action) => `${action}；右键查看更多复制选项`
				}
			},
			en: {
				markdown: {
					code: {
						copyLabel: "Copy",
						copiedLabel: "Copied"
					},
					footnotes: "Footnotes"
				},
				json: {
					copyValue: "Copy value",
					copyJson: "Copy JSON",
					copyPath: "Copy property path",
					copyPrettyJson: "Copy pretty JSON",
					copyCompactJson: "Copy compact JSON",
					copied: "Copied",
					copyFailed: "Copy failed",
					collapseNode: "Collapse JSON node",
					expandNode: "Expand JSON node",
					copyButtonTitle: (action) => `${action}; right-click for copy options`
				}
			}
		};
		function Header({ lang, route }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bridge-head",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-bridge-mark",
						"aria-hidden": true,
						children: "B"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-bridge-title",
						children: COPY[lang].title
					}),
					route ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-bridge-route",
						children: route
					}) : null
				]
			});
		}
		function RunningCard() {
			const lang = uiLanguageOf(typeof document === "undefined" ? void 0 : document.documentElement.lang);
			const copy = COPY[lang];
			const [seconds, setSeconds] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				const started = Date.now();
				const timer = window.setInterval(() => {
					setSeconds(Math.floor((Date.now() - started) / 1e3));
				}, 1e3);
				return () => {
					window.clearInterval(timer);
				};
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bridge-card",
				"aria-live": "polite",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Header, { lang }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bridge-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-copy",
							children: [
								copy.preparing,
								" · ",
								seconds,
								"s"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-status",
							children: copy.safe
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-progress",
							"aria-hidden": true
						})
					]
				})]
			});
		}
		function SummaryView({ summary, lang }) {
			const json = (0, react.useMemo)(() => parseJsonDocument(summary), [summary]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-bridge-preview",
				"aria-label": json === void 0 ? COPY[lang].markdownPreview : COPY[lang].json,
				children: json === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
					text: summary,
					labels: PRIMITIVE_LABELS[lang].markdown
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
					data: json,
					label: COPY[lang].json,
					labels: PRIMITIVE_LABELS[lang].json
				})
			});
		}
		function TextListEditor({ lang, onAppend, onChange, onRemove, section }) {
			const copy = COPY[lang];
			const items = section.items ?? [];
			const [draftRows, setDraftRows] = (0, react.useState)([]);
			const [itemDrafts, setItemDrafts] = (0, react.useState)({});
			const removeDraft = (index) => {
				setDraftRows((current) => current.filter((_, itemIndex) => itemIndex !== index));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bridge-list",
				children: [
					items.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bridge-list-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							"aria-label": `${section.label} ${index + 1}`,
							className: "dsh-bridge-list-input",
							maxLength: MAX_EDITED_SUMMARY_CHARS,
							rows: Math.min(4, item.text.split(/\r\n|\n|\r/gu).length),
							value: itemDrafts[index] ?? item.text,
							onChange: (event) => {
								const value = event.currentTarget.value;
								setItemDrafts((current) => ({
									...current,
									[index]: value
								}));
								if (value) onChange(index, value);
							},
							onBlur: () => {
								if (itemDrafts[index] === "") onRemove(index);
								setItemDrafts((current) => {
									const next = { ...current };
									delete next[index];
									return next;
								});
							},
							spellCheck: true
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							"aria-label": `${copy.removeItem}: ${section.label} ${index + 1}`,
							className: "dsh-bridge-button dsh-bridge-list-button",
							type: "button",
							onPointerDown: (event) => {
								event.preventDefault();
							},
							onClick: () => {
								onRemove(index);
							},
							children: "−"
						})]
					}, `${section.key}-${item.itemStart}`)),
					draftRows.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bridge-list-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							"aria-label": `${section.label} ${items.length + index + 1}`,
							autoFocus: index === draftRows.length - 1,
							className: "dsh-bridge-list-input",
							maxLength: MAX_EDITED_SUMMARY_CHARS,
							rows: 1,
							value: item,
							onChange: (event) => {
								const value = event.currentTarget.value;
								setDraftRows((current) => current.map((row, rowIndex) => rowIndex === index ? value : row));
							},
							onBlur: () => {
								if (!item.trim() || onAppend(item)) removeDraft(index);
							},
							spellCheck: true
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							"aria-label": `${copy.removeItem}: ${section.label} ${items.length + index + 1}`,
							className: "dsh-bridge-button dsh-bridge-list-button",
							type: "button",
							onPointerDown: (event) => {
								event.preventDefault();
							},
							onClick: () => {
								removeDraft(index);
							},
							children: "−"
						})]
					}, `${section.key}-draft-${index}`)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						className: "dsh-bridge-button dsh-bridge-add-button",
						type: "button",
						onClick: () => {
							setDraftRows((current) => [...current, ""]);
						},
						"aria-label": `${copy.addItem}: ${section.label}`,
						children: ["＋ ", copy.addItem]
					})
				]
			});
		}
		function TextHandoffEditor({ idPrefix, lang, onChange, onError, projection }) {
			const copy = COPY[lang];
			const safelyApply = (operation) => {
				try {
					onError("");
					return onChange(operation());
				} catch (cause) {
					onError(cause instanceof Error ? cause.message : String(cause));
					return false;
				}
			};
			const updateSection = (section, value) => {
				safelyApply(() => replaceBridgeTextSection(projection, section.key, value));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bridge-form",
				children: [projection.sections.map((section) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					"aria-labelledby": section.kind === "list" ? `${idPrefix}-${section.key}-label` : void 0,
					className: "dsh-bridge-field",
					role: section.kind === "list" ? "group" : void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bridge-field-head",
						children: [section.kind === "text" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
							className: "dsh-bridge-field-label",
							htmlFor: `${idPrefix}-${section.key}`,
							children: section.label
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-field-label",
							id: `${idPrefix}-${section.key}-label`,
							children: section.label
						}), section.kind === "list" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-bridge-field-help",
							children: copy.listHelp
						}) : null]
					}), section.kind === "text" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "dsh-bridge-text-editor",
						id: `${idPrefix}-${section.key}`,
						maxLength: MAX_EDITED_SUMMARY_CHARS,
						value: section.text,
						onChange: (event) => {
							updateSection(section, event.currentTarget.value);
						},
						spellCheck: true
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextListEditor, {
						lang,
						section,
						onAppend: (value) => safelyApply(() => appendBridgeTextListItem(projection, section.key, value)),
						onChange: (index, value) => {
							safelyApply(() => replaceBridgeTextListItem(projection, section.key, index, value));
						},
						onRemove: (index) => {
							safelyApply(() => removeBridgeTextListItem(projection, section.key, index));
						}
					})]
				}, section.key)), projection.opaqueSuffix ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bridge-appendix",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-bridge-field-label",
						children: copy.appendix
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-bridge-appendix-copy",
						children: copy.appendixHelp
					})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryView, {
						summary: projection.opaqueSuffix,
						lang
					})]
				}) : null]
			});
		}
		const EDITOR_MODES = [
			"preview",
			"text",
			"markdown"
		];
		function PreviewCard({ card, execute, openSession, sessionId }) {
			const copy = COPY[card.lang];
			const panelId = (0, react.useId)();
			const [mode, setMode] = (0, react.useState)("preview");
			const [summary, setSummary] = (0, react.useState)(card.summary);
			const [busy, setBusy] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [pendingSummary, setPendingSummary] = (0, react.useState)(null);
			const [created, setCreated] = (0, react.useState)(null);
			const lastCardSummary = (0, react.useRef)(card.summary);
			const confirming = (0, react.useRef)(false);
			const tooLong = summary.length > MAX_EDITED_SUMMARY_CHARS;
			const textProjection = (0, react.useMemo)(() => tooLong ? void 0 : parseBridgeTextProjection(summary), [summary, tooLong]);
			const updateSummary = (next) => {
				if (next.length > 24e3) {
					setError(copy.tooLong);
					return false;
				}
				setError("");
				setSummary(next);
				return true;
			};
			(0, react.useEffect)(() => {
				const prior = lastCardSummary.current;
				if (card.summary === prior) return;
				lastCardSummary.current = card.summary;
				if (summary === prior) {
					setSummary(card.summary);
					setPendingSummary(null);
				} else setPendingSummary(card.summary);
			}, [card.summary, summary]);
			const copySummary = async () => {
				try {
					await navigator.clipboard.writeText(summary);
					setError("");
					setStatus(copy.copied);
				} catch (cause) {
					setStatus("");
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			};
			const confirm = async () => {
				if (confirming.current) return;
				confirming.current = true;
				setBusy(true);
				setError("");
				setStatus(copy.confirming);
				try {
					const result = parseBridgeCard(await execute(sessionId, buildBridgeMigrationCommand(card.targetPreset, summary, card.lang, card.previewId ?? "")));
					if (result.phase === "error") throw new Error(result.text);
					if (result.phase !== "migrated") throw new Error(card.lang === "en" ? "The host returned no target session." : "宿主没有返回目标会话。");
					setCreated(result);
					setStatus(copy.opening);
					await openSession(result.sessionId);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
					setStatus("");
				} finally {
					confirming.current = false;
					setBusy(false);
				}
			};
			if (created) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MigratedCard, {
				card: created,
				openSession,
				status,
				error
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bridge-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Header, {
					lang: card.lang,
					route: `${card.sourcePreset} → ${card.targetPreset}`
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bridge-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-toolbar",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-bridge-tabs",
								role: "tablist",
								"aria-label": copy.title,
								onKeyDown: (event) => {
									if (![
										"ArrowLeft",
										"ArrowRight",
										"Home",
										"End"
									].includes(event.key)) return;
									event.preventDefault();
									const current = EDITOR_MODES.indexOf(mode);
									const next = event.key === "Home" ? 0 : event.key === "End" ? EDITOR_MODES.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + EDITOR_MODES.length) % EDITOR_MODES.length;
									const nextMode = EDITOR_MODES[next] ?? "preview";
									setMode(nextMode);
									window.requestAnimationFrame(() => {
										document.getElementById(`${panelId}-${nextMode}`)?.focus();
									});
								},
								children: [
									["preview", copy.preview],
									["text", copy.text],
									["markdown", copy.markdownSource]
								].map(([value, label]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									"aria-controls": panelId,
									"aria-selected": mode === value,
									className: "dsh-bridge-tab",
									id: `${panelId}-${value}`,
									role: "tab",
									tabIndex: mode === value ? 0 : -1,
									type: "button",
									onClick: () => {
										setMode(value);
									},
									children: label
								}, value))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bridge-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-bridge-button",
									type: "button",
									onClick: () => {
										copySummary();
									},
									children: copy.copy
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-bridge-button",
									"data-primary": true,
									type: "button",
									disabled: busy || !card.previewId || summary.trim() === "" || tooLong,
									onClick: () => {
										confirm();
									},
									children: busy ? copy.confirming : copy.confirm
								})]
							})]
						}),
						pendingSummary !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-draft-notice",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: copy.newPreview }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bridge-actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-bridge-button",
									type: "button",
									onClick: () => {
										setPendingSummary(null);
									},
									children: copy.keepDraft
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-bridge-button",
									type: "button",
									onClick: () => {
										setSummary(pendingSummary);
										setPendingSummary(null);
									},
									children: copy.loadPreview
								})]
							})]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"aria-labelledby": `${panelId}-${mode}`,
							className: "dsh-bridge-panel",
							id: panelId,
							role: "tabpanel",
							children: tooLong ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bridge-notice",
								role: "alert",
								children: [copy.tooLong, card.summaryFile ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [copy.fileFallback, ":"] }),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: card.summaryFile })
								] }) : null]
							}) : mode === "preview" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryView, {
								summary,
								lang: card.lang
							}) : mode === "text" ? textProjection ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TextHandoffEditor, {
								idPrefix: panelId,
								lang: card.lang,
								projection: textProjection,
								onChange: updateSummary,
								onError: setError
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bridge-notice",
								role: "status",
								children: [copy.textUnavailable, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-bridge-notice-actions",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: "dsh-bridge-button",
										type: "button",
										onClick: () => {
											setMode("markdown");
										},
										children: copy.editMarkdown
									})
								})]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "dsh-bridge-markdown-editor",
								"aria-label": copy.markdownEditor,
								maxLength: MAX_EDITED_SUMMARY_CHARS,
								value: summary,
								onChange: (event) => {
									updateSummary(event.currentTarget.value);
								},
								spellCheck: false
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-meta",
							children: [card.stats ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-bridge-chip",
								children: card.stats
							}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-bridge-chip",
								children: [
									summary.length.toLocaleString(),
									" ",
									copy.chars
								]
							})]
						}),
						card.warnings.map((warning) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-warning",
							children: ["⚠ ", warning]
						}, warning)),
						!card.previewId ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-warning",
							children: ["⚠ ", copy.stalePreview]
						}) : null,
						status ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-status",
							"aria-live": "polite",
							children: status
						}) : null,
						error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-error",
							role: "alert",
							children: error
						}) : null
					]
				})]
			});
		}
		function MigratedCard({ card, error = "", openSession, status = "" }) {
			const copy = COPY[card.lang];
			const [opening, setOpening] = (0, react.useState)(false);
			const [localError, setLocalError] = (0, react.useState)(error);
			const open = async () => {
				setOpening(true);
				setLocalError("");
				try {
					await openSession(card.sessionId);
				} catch (cause) {
					setLocalError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setOpening(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bridge-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Header, {
					lang: card.lang,
					route: `→ ${card.targetPreset}`
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bridge-body dsh-bridge-success",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-session",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: card.title }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								card.sessionId
							]
						}),
						card.details.map((detail) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-copy",
							children: detail
						}, detail)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-actions",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-bridge-button",
								"data-primary": true,
								type: "button",
								disabled: opening,
								onClick: () => {
									open();
								},
								children: opening ? copy.opening : copy.open
							})
						}),
						status ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-status",
							"aria-live": "polite",
							children: status
						}) : null,
						card.warnings.map((warning) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-warning",
							children: ["⚠ ", warning]
						}, warning)),
						localError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-error",
							role: "alert",
							children: localError
						}) : null
					]
				})]
			});
		}
		function MessageCard({ card }) {
			const lang = card.phase === "message" ? card.lang : /[㐀-鿿]/u.test(card.text) ? "zh" : "en";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bridge-card",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Header, { lang }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dsh-bridge-body",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-bridge-panel",
						children: card.phase === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-error",
							role: "alert",
							children: card.text
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryView, {
							summary: card.text,
							lang: card.lang
						})
					})
				})]
			});
		}
		var BridgeCardBoundary = class extends react.Component {
			state = { failed: false };
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error, info) {
				console.error("dsh-plugin-bridge card render failed", error, info.componentStack);
			}
			render() {
				if (!this.state.failed) return this.props.children;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bridge-card",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Header, { lang: this.props.lang }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-bridge-body",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-error",
							role: "alert",
							children: COPY[this.props.lang].renderFailure
						})
					})]
				});
			}
		};
		function BridgeCommandCardContent({ node, execute, openSession, sessionId }) {
			const card = (0, react.useMemo)(() => parseBridgeCard(node.outcome), [node.outcome]);
			if (card.phase === "running") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunningCard, {});
			if (card.phase === "preview") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PreviewCard, {
				card,
				execute,
				openSession,
				sessionId
			});
			if (card.phase === "migrated") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MigratedCard, {
				card,
				openSession
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MessageCard, { card });
		}
		/** Rich renderer for the durable command lifecycle keyed by name and isolated from every other plugin. */
		function BridgeCommandCard(props) {
			const lang = uiLanguageOf(typeof document === "undefined" ? void 0 : document.documentElement.lang);
			const outcomeKey = props.node.outcome === null ? "running" : `${props.node.outcome.kind}:${props.node.outcome.text ?? ""}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BridgeCardBoundary, {
				lang,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BridgeCommandCardContent, { ...props })
			}, outcomeKey);
		}
		async function openWhenVisible(ctx, sessionId) {
			if (ctx.sessions.list.getSnapshot().byId[sessionId] !== void 0) {
				ctx.sessions.open(sessionId);
				return;
			}
			await new Promise((resolve, reject) => {
				let dispose = () => {};
				const timeout = window.setTimeout(() => {
					dispose();
					reject(/* @__PURE__ */ new Error(`Target session ${sessionId} has not reached this browser yet.`));
				}, 5e3);
				dispose = ctx.sessions.list.subscribe(() => {
					if (ctx.sessions.list.getSnapshot().byId[sessionId] === void 0) return;
					window.clearTimeout(timeout);
					dispose();
					resolve();
				});
			});
			ctx.sessions.open(sessionId);
		}
		/** Client services are supplied by the official WebUI module table. */
		const inject = [
			"slots",
			"sessions",
			"remote",
			"remote.commands"
		];
		function apply(ctx) {
			const commands = ctx.remote.commands;
			ctx.effect(() => {
				if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {};
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-plugin-bridge";
				style.dataset.pluginCss = STYLE_ID;
				style.textContent = STYLE;
				document.head.append(style);
				return () => {
					style.remove();
				};
			}, "bridge: native card styles");
			ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
				name: "conversation.chat.commandview",
				key: "bridge",
				inject: () => ({
					execute: async (sessionId, line) => {
						const result = await commands.execute(sessionId, line, []);
						if (!result.ok) throw new Error(`${result.error?.code ?? "command-failed"}: ${result.error?.message ?? "The host rejected the command."}`);
						if (result.value === void 0) throw new Error("The /bridge command was not admitted by the host.");
						return result.value.result;
					},
					openSession: (sessionId) => openWhenVisible(ctx, sessionId)
				})
			}, BridgeCommandCard));
		}
		//#endregion
		exports.BridgeCommandCard = BridgeCommandCard;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map