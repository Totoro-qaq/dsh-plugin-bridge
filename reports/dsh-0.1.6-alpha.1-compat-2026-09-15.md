# DSH 0.1.6-alpha.1 compatibility smoke

Date: 2026-09-15 (Asia/Shanghai). **Bridge 0.3.6 release smoke**. The candidate was `main` at `a365a50` (Bridge 0.3.5) with only the DSH peer ranges and SDK devDependencies changed. These results do not apply to the registry 0.3.5 package, whose peer ranges do not match 0.1.6 prereleases.

This is a credential-free gate. It proves install, load, host probing, the command path and the native card on the new host, and it audits the SDK contract by type diff. The model-backed migration was not re-run; see [Not covered](#not-covered).

## Upstream change

DSH went from `dsh-v0.1.5-rc.2` (2026-09-10) to `dsh-v0.1.6-alpha.1` (2026-09-15, 800 commits). npm publishes it under the `alpha` tag; `latest` is still `0.1.5-rc.1`. Under npm semver, `^0.1.5-alpha.1` matches a future `0.1.6` release but no `0.1.6` prerelease, so Bridge needs an explicit `^0.1.6-alpha.1` peer term.

| Release-note item | Effect on Bridge |
|---|---|
| `agent/session-start` replaced by asynchronous `agent/created`; the first model request waits for it | None found. Bridge does not listen to either event; it creates the target through the session controller and pauses the goal before kickoff. |
| Synchronous history APIs `snapshotEvents`, `eventAt`, `ownEvents` deprecated | None. Bridge reads history through `sessionController.inspect`. |
| PTC packages and services renamed to `ptc-runtime` without aliases | The `ptc` Agent Preset id is unchanged; `/bridge` still lists `ptc` as a target. |
| Messages is the default DeepSeek protocol; uploaded images are reused through the Files API | Not exercised. Bridge passes carried images as ordinary prompt image content; the adapter owns upload. |
| New image offload session event | None expected. The fold handles user, assistant, chunk, tool and turn events and skips unknown types. |

Type declarations were diffed between `0.1.5-rc.2` and `0.1.6-alpha.1` for every package Bridge pins or calls structurally. Eleven changed; every change is an addition. No declaration Bridge uses was removed or retyped, and `conversation.chat.commandview`, `CommandRowProps`, `commands.execute(sessionId, line, attachments)`, the 13 session/workspace/preset/goal methods and the `dsh.client.platform === "web"` client-module filter are unchanged. `dsh-client-ui-primitives` and `dsh-client-ui-slots` are published at `0.1.6-alpha.1` under the same names.

## Build against the 0.1.6-alpha.1 SDK

- SDK devDependencies pinned to `0.1.6-alpha.1`; the load test now requires the `^0.1.6-alpha.1` peer term and the new pins.
- Typecheck of both halves and 177/177 tests passed on Node 22.23.1.
- The generated `lib/` (server build and browser bundle) is byte-identical to 0.3.5, so the SDK bump changes no shipped code. The packed tarball has 48 files.

## Installed host smoke

Official npm `@deepseek-ai/dsh@0.1.6-alpha.1` in a scratch prefix (443 packages), an isolated `DSH_HOME` with no credentials, the candidate installed with `dsh plugin --profile web add <tarball>`, and the WebUI driven by headless Chrome with a throwaway profile.

| Check | Result |
|---|---|
| Plugin install | Candidate joined the `web` profile; no peer warnings |
| WebUI boot | 3 s |
| `/bridge --doctor` | `dsh-typed-controllers · 13/13`, mode `standard`, tier `current` |
| `/bridge` | Usage card; targets `ptc · minimal · cordis` |
| `/bridge ptc` with no key configured | Failed closed with `worker-empty`; no target session |
| Native card | Rendered for all three results; Bridge style injected; no horizontal overflow at 1280 px |
| WebSocket and page | `remote.mux` stayed open; no page errors |

## Not covered

- No model request was made: summary quality, native editing, confirmation, target restatement and paused goals were not re-run on 0.1.6-alpha.1. The [0.1.5-rc.1 acceptance](dsh-0.1.5-rc.1-compat-2026-09-10.md) remains the latest model-backed evidence for the same shipped code.
- The Files API image path and the new image offload event were not exercised with a model.
- The isolated home held no earlier sessions, so upgrading existing sessions to 0.1.6 was not measured.
- The Electron desktop app in `apps/desktop` is still private at `0.1.6-alpha.1`. It has no npm package, no GitHub release asset, and none of the public release workflows build it, so Bridge was not tested inside it.

The isolated install, profile and driver stayed outside the repository.
