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
		const PREVIEW_HEADER = /^───\s*(Handoff|交接摘要)\s*·\s*(.*?)\s*→\s*([^\s（(]+).*───\s*$/u;
		const DIVIDER = /^─{10,}\s*$/u;
		const RUN_COMMAND = /\/bridge\s+([^\s]+)\s+--go(?:\s|$)/u;
		function languageOf(text) {
			return /[\u3400-\u9fff]/u.test(text) ? "zh" : "en";
		}
		function parsePreview(text) {
			const lines = text.split("\n");
			const header = PREVIEW_HEADER.exec(lines[0] ?? "");
			if (!header) return void 0;
			const divider = lines.findIndex((line, index) => index > 0 && DIVIDER.test(line));
			if (divider < 2) return void 0;
			const targetPreset = RUN_COMMAND.exec(text)?.[1] ?? header[3];
			if (!targetPreset) return void 0;
			const tail = lines.slice(divider + 1);
			const stats = tail.find((line) => line.trim() !== "" && !line.startsWith("⚠") && !RUN_COMMAND.test(line)) ?? "";
			const warnings = tail.filter((line) => line.startsWith("⚠")).map((line) => line.replace(/^⚠\s*/u, ""));
			return {
				phase: "preview",
				lang: header[1] === "Handoff" ? "en" : "zh",
				sourcePreset: (header[2] ?? "").trim(),
				targetPreset,
				summary: lines.slice(1, divider).join("\n").trim(),
				stats,
				warnings
			};
		}
		function parseMigrated(text) {
			const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
			const first = lines[0] ?? "";
			const lang = first.startsWith("Created a new session") ? "en" : "zh";
			const preset = lang === "en" ? /^Created a new session in the (.+?) preset\b/u.exec(first)?.[1] : /^已在 (.+?) 模式下建好新会话/u.exec(first)?.[1];
			if (!preset) return void 0;
			const targetIndex = lines.findIndex((line) => /^(?:Target session:|目标会话：)/u.test(line));
			if (targetIndex < 0) return void 0;
			const target = /^(?:Target session:|目标会话：)\s*(.+?)\s*·\s*(\S+)\s*$/u.exec(lines[targetIndex] ?? "");
			if (!target?.[1] || !target[2]) return void 0;
			const remaining = lines.filter((_, index) => index !== 0 && index !== targetIndex);
			return {
				phase: "migrated",
				lang,
				targetPreset: preset,
				title: target[1],
				sessionId: target[2],
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
		function buildBridgeMigrationCommand(targetPreset, summary) {
			if (!/^[A-Za-z0-9._-]+$/u.test(targetPreset)) throw new Error("Unsupported target preset id");
			const edited = summary.trim();
			if (!edited) throw new Error("The handoff summary is empty");
			if (edited.length > 24e3) throw new Error(`The handoff summary exceeds ${MAX_EDITED_SUMMARY_CHARS} characters`);
			return `/bridge ${targetPreset} --go --summary64 ${encodeUtf8Base64Url(edited)}`;
		}
		//#endregion
		//#region src/client.tsx
		/** Official WebUI half: one native `/bridge` command card, not a second WebUI. */
		const STYLE_ID = "dsh-plugin-bridge/native-card";
		const STYLE = `
.dsh-bridge-card{border:1px solid var(--dsw-alias-border-subtle,#dedede);border-radius:12px;background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#171717);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.dsh-bridge-head{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-subtle,#e6e6e6);background:var(--dsw-alias-background-secondary,#fafafa)}
.dsh-bridge-mark{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:var(--dsw-alias-state-business-secondary,#e8f1ff);color:var(--dsw-alias-state-business-primary,#2869d8);font:700 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace}
.dsh-bridge-title{min-width:0;flex:1;font-size:13px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-bridge-route{font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-secondary,#666)}
.dsh-bridge-body{padding:14px}.dsh-bridge-copy{font-size:13px;line-height:1.55;color:var(--dsw-alias-label-secondary,#5f6368)}
.dsh-bridge-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.dsh-bridge-tabs{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-background-tertiary,#f1f2f4)}
.dsh-bridge-button,.dsh-bridge-tab{border:0;border-radius:7px;font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background-color .15s ease,color .15s ease,transform .1s ease}
.dsh-bridge-tab{padding:7px 10px;background:transparent;color:var(--dsw-alias-label-secondary,#666)}.dsh-bridge-tab[aria-selected=true]{background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#171717);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.dsh-bridge-button{padding:8px 11px;background:var(--dsw-alias-background-tertiary,#f1f2f4);color:var(--dsw-alias-label-primary,#171717)}.dsh-bridge-button[data-primary=true]{background:var(--dsw-alias-state-business-primary,#2869d8);color:#fff}.dsh-bridge-button:disabled{cursor:not-allowed;opacity:.55}.dsh-bridge-button:not(:disabled):active{transform:translateY(1px)}
.dsh-bridge-actions{display:flex;gap:8px;flex-wrap:wrap}.dsh-bridge-preview{max-height:420px;overflow:auto;padding:14px;border:1px solid var(--dsw-alias-border-subtle,#e3e5e8);border-radius:9px;background:var(--dsw-alias-background-primary,#fff)}
.dsh-bridge-editor{box-sizing:border-box;width:100%;min-height:310px;resize:vertical;padding:13px 14px;border:1px solid var(--dsw-alias-border-strong,#c8ccd2);border-radius:9px;outline:none;background:var(--dsw-alias-background-primary,#fff);color:var(--dsw-alias-label-primary,#171717);font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;tab-size:2}.dsh-bridge-editor:focus{border-color:var(--dsw-alias-state-business-primary,#2869d8);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#2869d8) 18%,transparent)}
.dsh-bridge-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;color:var(--dsw-alias-label-tertiary,#85898f);font-size:11px}.dsh-bridge-chip{padding:4px 7px;border-radius:999px;background:var(--dsw-alias-background-tertiary,#f2f3f5)}
.dsh-bridge-warning,.dsh-bridge-error{margin-top:10px;padding:9px 10px;border-radius:8px;font-size:12px;line-height:1.45}.dsh-bridge-warning{background:var(--dsw-alias-state-warn-secondary,#fff5d8);color:var(--dsw-alias-state-warn-primary,#785a00)}.dsh-bridge-error{background:var(--dsw-alias-state-error-secondary,#ffe9e7);color:var(--dsw-alias-state-error-primary,#b3261e);white-space:pre-wrap}
.dsh-bridge-progress{height:3px;margin-top:12px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-background-tertiary,#eceef1)}.dsh-bridge-progress::after{content:"";display:block;width:42%;height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary,#2869d8);animation:dsh-bridge-scan 1.35s ease-in-out infinite}
.dsh-bridge-success{display:grid;gap:10px}.dsh-bridge-session{padding:10px;border-radius:8px;background:var(--dsw-alias-state-success-secondary,#e8f7ed);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}.dsh-bridge-status{min-height:18px;font-size:11px;color:var(--dsw-alias-label-tertiary,#85898f)}
.dsh-bridge-button:focus-visible,.dsh-bridge-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#2869d8);outline-offset:2px}@keyframes dsh-bridge-scan{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}
@media(max-width:640px){.dsh-bridge-head{align-items:flex-start;flex-wrap:wrap;padding-block:10px}.dsh-bridge-route{width:100%;padding-left:32px}.dsh-bridge-toolbar{align-items:flex-start;flex-direction:column}.dsh-bridge-preview{max-height:52vh}.dsh-bridge-actions{width:100%}.dsh-bridge-actions .dsh-bridge-button{flex:1}}
@media(prefers-reduced-motion:reduce){.dsh-bridge-progress::after{animation:none;width:65%}.dsh-bridge-button,.dsh-bridge-tab{transition:none}}
`;
		const COPY = {
			zh: {
				title: "会话迁移",
				preparing: "正在生成可编辑的交接摘要",
				safe: "原会话不会被修改",
				preview: "预览",
				edit: "编辑",
				copy: "复制摘要",
				copied: "已复制",
				confirm: "确认迁移",
				confirming: "正在创建目标会话…",
				open: "打开目标会话",
				opening: "正在打开目标会话…",
				json: "JSON 结构",
				markdown: "Markdown 预览",
				editor: "交接摘要 Markdown 编辑器",
				chars: "字符"
			},
			en: {
				title: "Session handoff",
				preparing: "Generating an editable handoff preview",
				safe: "The source session stays untouched",
				preview: "Preview",
				edit: "Edit",
				copy: "Copy summary",
				copied: "Copied",
				confirm: "Confirm migration",
				confirming: "Creating the target session…",
				open: "Open target session",
				opening: "Opening target session…",
				json: "JSON structure",
				markdown: "Markdown preview",
				editor: "Handoff summary Markdown editor",
				chars: "chars"
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
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Header, { lang: "zh" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bridge-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bridge-copy",
							children: [
								COPY.zh.preparing,
								" · ",
								seconds,
								"s"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bridge-status",
							children: COPY.zh.safe
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
				"aria-label": json === void 0 ? COPY[lang].markdown : COPY[lang].json,
				children: json === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, { text: summary }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.JsonTree, {
					data: json,
					label: COPY[lang].json
				})
			});
		}
		function PreviewCard({ card, execute, openSession, sessionId }) {
			const copy = COPY[card.lang];
			const [mode, setMode] = (0, react.useState)("preview");
			const [summary, setSummary] = (0, react.useState)(card.summary);
			const [busy, setBusy] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [created, setCreated] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setSummary(card.summary);
			}, [card.summary]);
			const copySummary = async () => {
				await navigator.clipboard.writeText(summary);
				setStatus(copy.copied);
			};
			const confirm = async () => {
				setBusy(true);
				setError("");
				setStatus(copy.confirming);
				try {
					const result = parseBridgeCard(await execute(sessionId, buildBridgeMigrationCommand(card.targetPreset, summary)));
					if (result.phase === "error") throw new Error(result.text);
					if (result.phase !== "migrated") throw new Error(card.lang === "en" ? "The host returned no target session." : "宿主没有返回目标会话。");
					setCreated(result);
					setStatus(copy.opening);
					await openSession(result.sessionId);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
					setStatus("");
				} finally {
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
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bridge-tabs",
								role: "tablist",
								"aria-label": copy.title,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-bridge-tab",
									type: "button",
									role: "tab",
									"aria-selected": mode === "preview",
									onClick: () => {
										setMode("preview");
									},
									children: copy.preview
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-bridge-tab",
									type: "button",
									role: "tab",
									"aria-selected": mode === "edit",
									onClick: () => {
										setMode("edit");
									},
									children: copy.edit
								})]
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
									disabled: busy || summary.trim() === "",
									onClick: () => {
										confirm();
									},
									children: busy ? copy.confirming : copy.confirm
								})]
							})]
						}),
						mode === "preview" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryView, {
							summary,
							lang: card.lang
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
							className: "dsh-bridge-editor",
							"aria-label": copy.editor,
							value: summary,
							onChange: (event) => {
								setSummary(event.currentTarget.value);
							},
							spellCheck: false
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
					children: card.phase === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-bridge-error",
						role: "alert",
						children: card.text
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SummaryView, {
						summary: card.text,
						lang: card.lang
					})
				})]
			});
		}
		/** Rich renderer for the durable command lifecycle keyed by command name. */
		function BridgeCommandCard({ node, execute, openSession, sessionId }) {
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