# DSH 0.1.5-alpha.1 compatibility smoke

Date: 2026-09-09 (Asia/Shanghai). **Bridge 0.3.4 release smoke**. The runtime checks used the candidate built from the `compat/dsh-0.1.5-alpha.1` branch on top of `f2d0fba`, before its package version was bumped from 0.3.3 to 0.3.4. These results do not apply to the registry 0.3.3 package, whose peer ranges stop at `^0.1.3-alpha.2`.

This is a smaller gate than the [0.1.3-alpha.2 acceptance](dsh-0.1.3-alpha.2-compat-2026-09-08.md): it proves install, load, host probing and the command path on the new host, and it audits the SDK contract by type diff. It does not repeat the model-backed preview, edit, migration or image-fallback runs; see [Not covered](#not-covered).

## Upstream change

DSH went from `dsh-v0.1.3-alpha.2` (2026-09-07) to `dsh-v0.1.5-alpha.1` (2026-09-08, 563 commits); no 0.1.4 was published to npm. Relevant items from the release notes and from diffing the published `.d.ts` files of every package Bridge pins (`dsh-api-remotes`, `dsh-api-session-controller`, `dsh-client-ui-chat/-conversation/-primitives/-renderer/-session/-slots`) plus the Host packages it calls structurally (`dsh-goal`, `dsh-session`, `dsh-session-persistence`, `dsh-commands`, `dsh-agent`, `dsh-agent-presets`, `dsh-workspace`, `dsh-api-workspace-controller`):

| Change | Effect on Bridge |
|---|---|
| Session format V3: `SESSION_FORMAT_VERSION = 3`, new `system/message` surface event, `SurfaceOp.replace` fields renamed to `startSeq`/`endSeq`, `user/message` payload unchanged (`UserMessage` with `content`) | None at runtime. The fold handles user, assistant, chunk, tool and turn events only; `system/message` and replacement copies are skipped, and the message budget counts user/assistant events only. New fixtures lock this in. |
| `ctx.agent` removed; `AgentSetup` receives the Agent explicitly; `Inbox` is now type-only | None. Bridge never read `ctx.agent` or `Inbox`; goals already receive the Agent from `sessionController.resolveAgent`. |
| `GoalService.pause/resume/clear(agent, ref)`, `remoteExportCreate(agent, request)`, new `goal/activation-changed` event, model may no longer resume a user-paused goal | Signatures unchanged. The paused migration target now also shows a resume control in the official UI. |
| `SessionController.list/create/inspect/modelCatalog/selectModel/prompt/cancel/rename/attachment/resolveAgent` and `SessionInspection { events }` | Unchanged; `session/attachment-invalid` with `MODEL_DOES_NOT_SUPPORT_IMAGES` still exists. |
| Client: Details panel removed (`DetailsSlotProps`, `SelectionTarget`, `conversation.details.tool` gone); `openFile` gains `options`; `MarkdownText` gains optional `pathImages`; `conversation.chat.commandview` and `CommandRowProps` unchanged; `commands.execute(sessionId, line, attachments)` unchanged | None. Bridge does not use the removed types. |
| `fs-ext` no longer compiles natively on macOS/Linux | Install no longer depends on a matching Node ABI. |
| Semver: `^0.1.3-alpha.2` does not satisfy `0.1.5-alpha.1` | The only required change: add `|| ^0.1.5-alpha.1` to the five optional peers and pin devDependencies to `0.1.5-alpha.1`. |

## Build against the 0.1.5-alpha.1 SDK

- devDependencies pinned to `0.1.5-alpha.1`; `npm install` changed only the `@deepseek-ai/*` entries in the lockfile.
- `tsc` typecheck of both halves passed; `tsdown` client build passed.
- The generated `lib/` (server build and browser bundle) is byte-identical to the 0.3.3 build, so the SDK bump changes no shipped code.
- Node 22.23.1 test run: 176/176 after updating the load test's pin and adding two V3 fixtures (fold ignores `system/message` and replacement nodes; the typed adapter's single-read window and the paged path agree on a V3 snapshot and never count system nodes toward the budget).

## Installed host smoke

Environment: official npm `@deepseek-ai/dsh@0.1.5-alpha.1` installed into a scratch prefix (541 packages, Node 22.23.1, pnpm 11.22.0), isolated `DSH_HOME`, no credentials configured, no user profile or session touched.

| Check | Result |
|---|---|
| `dsh plugin --profile web add <packed tarball>` | Profile initialized; Bridge joined `dsh.profile.bundles` after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`; no peer warnings |
| `dsh web --no-open` boot | Served; the combined `/plugins/??…` module table includes `dsh-plugin-bridge/client.js`, and the served text contains the native-card style id and the `conversation.chat.commandview` registration |
| Slash-command menu | `/bridge` listed with its description |
| `/bridge --doctor` on a fresh session | `dsh-typed-controllers · 13/13 个方法可用`, mode `standard`, targets `ptc · minimal · cordis` |
| `/bridge` (no arguments) | Usage plus `可迁入：ptc · minimal · cordis`, `当前：standard` |
| Session storage | The created session was written as `session.v3.jsonl.zstd` |

Both command results were read from the `POST /api/commands/execute` responses. The WebUI's `ws://…/api/remote.mux` stream could not be held by the automation browser used for this run, so the rendered card was not inspected visually; the card bundle itself is unchanged from 0.3.3, where it was verified on 0.1.3-alpha.2.

## Not covered

- No model request was made: the summary worker, native Text/Markdown editing, confirmation, target restatement, paused goal and image-to-text fallback were not re-run on 0.1.5-alpha.1. The 0.1.3-alpha.2 report remains the latest full migration evidence.
- No in-place upgrade of an existing v2 profile to V3 was exercised; DSH states it rewrites supported histories into new V3 log files while preserving the originals, and Bridge reads history only through `inspect`, but this run did not measure it.
- No removal/restart cycle was repeated on this host.

The isolated install, profile and scratch workspace were left outside the repository and can be deleted; nothing from them is part of the package.
