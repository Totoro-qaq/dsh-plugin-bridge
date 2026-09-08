# DSH 0.1.3-alpha.2 compatibility and history-window acceptance

Date: 2026-09-08 (Asia/Shanghai). Status: **local unreleased candidate**, based on Bridge `d2b9be2` (0.3.2). These results do not apply to the unchanged registry 0.3.2 package.

## Environments and artifact

- Official npm DSH `0.1.2-rc.1`: 214 DSH packages at that version; Node 24.19.0.
- Official npm DSH `0.1.3-alpha.2`: 223 DSH packages at that version; Node 22.23.1.
- Candidate built from this branch and installed with the official `dsh plugin --profile web add <tarball>` command. The same isolated profile was then opened by alpha.2.
- `pnpm peers check` reported no peer dependency issues after upgrade.
- The profile, workspace, credentials copy, browser and host test driver were isolated. Only synthetic Session content was submitted to the configured DeepSeek endpoint. Test drivers and browser recordings are not part of the plugin package.
- Alpha.2's `fs-ext` was built during installation under Node 22. Attempting to launch that installation under Node 24 produced `ERR_DLOPEN_FAILED`; using the matching Node 22 runtime resolved the environment error. This run does not claim an installed alpha.2/Node 24 test.

## Upgrade and real migration

| Check | Result |
|---|---|
| Old-host installed command | Doctor 13/13; actual preview and migration via `commands.execute` succeeded |
| Old-host facts | Project BRIDGE-A13-7813, PostgreSQL, port 7813, planned-but-not-created `src/migration.ts`, and MongoDB prohibition preserved |
| Old-host target | PTC, paused goal, zero autonomous goal rounds |
| Same-profile upgrade | Original title retained; source header becomes format v2 |
| Old log artifacts | All four pre-upgrade JSONL/Zstandard artifacts remain byte-identical by SHA-256 |
| Source content | Folded user and assistant text exactly matches the pre-upgrade snapshot; no test file was created |
| Alpha.2 command | Doctor 13/13; preview requested through the installed WebUI |
| Native editing | Text/Markdown round trip preserves numbered-list continuation; edited Next step reaches target exactly |
| Default confirmation | Exactly one new target; automatically opened in PTC, goal paused, zero goal rounds |
| Target response | Restates the critical facts and waits; does not execute tools or create files |
| Restart | Edited objective and paused state remain intact; old log hashes still match |

The reviewed native payload had SHA-256 `cba24d3dc1dd707de9f7cfb1b111ac95311838f166216825115c11c86e987f5e` and included long synthetic text to exercise scrolling. Both the submitted content and target goal retained those exact bytes.

## UI and image fallback

- At 1280, 768 and 375 pixels, the document had no horizontal overflow; the preview had its own scrollable body and scrolling it did not move the confirmation controls.
- A separate 375-pixel check scrolled the confirmation button into view and verified that its center hit the actual button, rather than the fixed composer. Native confirmation then succeeded at the desktop viewport.
- No page errors were observed during the connected preview/edit/confirm runs. No pixel-baseline comparison or full accessibility audit was performed.
- A real image was admitted through the official vision route, then cancelled before any assistant message; the source contained one durable image and zero assistant analyses. Its selected model was changed to text-only `deepseek-v4-flash` before migration.
- Target prompt admission rejected the image with `session/attachment-invalid` and `Model "deepseek-v4-flash" does not support image input`. Bridge returned a visible warning and completed a text-only kickoff containing the unresolved-image warning. The target had zero image blocks and a paused goal.
- Raw-image delivery to a vision-capable target was not repeated in this run.

## History cost comparison

The fixture contains 6,000 synthetic user-message events, created through the old host's Session API and upgraded to v2. The default returned window remains 240 messages. The installed alpha.2 `SessionController.inspect` was instrumented to count reads; results below compare the original `main` implementation against the candidate using the same real controller. The session had no attached Agent during the cold-session query comparison. Five sequential samples were taken per implementation, original first; host/OS caches may affect timing. Heap delta is before/after allocation during a read, **not peak RSS or retained memory**.

| Metric | Original 0.3.2 | Candidate |
|---|---:|---:|
| Full `inspect` calls per source window | 4 | 1 |
| Returned message count | 240 | 240 |
| Median read + fold time | 12.93 ms | 6.70 ms |
| Median observed heap delta | 5,579,552 B | 5,165,760 B |
| Folded content equality | Identical | Identical |

Original times (ms): 58.612, 12.926, 12.533, 12.958, 11.980. Candidate: 7.643, 6.689, 6.703, 7.015, 6.665. The initial original sample also pays first-read setup. An earlier attached-session comparison showed little wall-clock change (about 4–5 ms in both paths). The reliable improvement is avoiding repeated full reads; this is not an end-to-end model latency or universal speedup claim.

The adapter retains no running-state or cross-request history cache. Regression tests additionally cover new events after a window read, current worker turn completion, errors/cancellation, and equality with the paged path across tool and compaction records.

## Removal and verification

- Official `dsh plugin --profile web remove dsh-plugin-bridge`, followed by a host restart, removed the dependency, bundle registration and profile package link.
- The old Session remained readable through the generic command renderer. The browser had zero Bridge cards, zero Bridge style elements, zero Bridge resource requests, and zero observed page errors.
- Executing `/bridge --doctor` returned no command execution; an independently registered companion command still succeeded.
- Host restart successfully reopened the same persisted sessions, exercising normal session-lock release. Crash recovery and multi-process lock contention were not separately tested.
- `npm ci` followed by `npm run verify` passed under Node 22.23.1: 174 tests, build/typecheck, generated artifact checks, datasets and package import smoke. The Node 24.19.0 test run also passed all 174 tests.
- Summary model calls, UI fixtures and inspection endpoints were restricted to the isolated acceptance environment. No user Session database was edited or deleted.
- After acceptance, the temporary credential copy, both installed runtimes, synthetic profile, browser process and three test-created summary directories were removed. Sanitized measurement results, check logs and screenshots were retained outside the repository.
