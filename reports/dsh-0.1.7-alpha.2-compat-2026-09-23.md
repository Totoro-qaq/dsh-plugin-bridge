# DSH 0.1.7-alpha.2 source-build acceptance

Date: 2026-09-23 (Asia/Shanghai). This verifies a **locally packed Bridge source candidate after the published 0.3.9**, not a new npm release. The tarball still reported version 0.3.9 for the isolated install; that metadata does not mean the registry package or `v0.3.9` tag contains these fixes.

## Problem and fix

- The published 0.3.9 preview worker omitted the source user's explicit “不要调用任何工具，不要读写文件” restriction. In the original alpha.2 run, a `ptc` target called `run_code`; a separately supplied explicit no-tools handoff produced no tool call. The source build now copies only narrowly recognized, active, user-authored no-tools/no-file prohibitions into the **editable preview** when the worker omits them. Explicit later permission wins. User edits are not rewritten at confirmation.
- At 800×700, the native card's confirmation button could be covered by the host's fixed composer after text → Markdown → text editing and choosing “直接继续”. The source build gives the preview card bottom scroll clearance below 900 px width; no host or other-plugin CSS is changed.

## Test fixture and result

Official npm `@deepseek-ai/dsh@0.1.7-alpha.2`, macOS, Node 22.23.1 and real headless Chrome. A copy of the earlier synthetic V4 test profile, not the daily DSH home, received the locally packed Bridge candidate. The installed client and compression bundles were hash-checked against the built source. The test source contained one direct Chinese user message with a no-tools/no-file restriction, Lighthouse demo values, and a deferred mental-arithmetic step. Credentials were passed only to the isolated host process; no local recognition model was installed.

| Check | Result |
|---|---|
| `/bridge --doctor` | 13/13 |
| Model-backed worker preview | Final candidate passed in one run; 24.8 s observed, not a latency guarantee |
| Explicit source restriction visible in editable preview | Both no-tools and no-file clauses visible |
| Text → Markdown → text edits | Preserved; final Markdown sent byte-for-byte |
| Narrow-window layout | 800×700 and 640×700: confirmation in viewport and hit-test reaches button after 1.5 s; no horizontal card overflow |
| `standard → ptc`, “直接继续” | Target auto-opened, returned `RESULT=385`, no `tool/*` events |
| Goal and source | Goal `paused`, `roundsStarted=0`; source user/assistant content unchanged |
| Worker and browser | Worker archived, not running; zero observed page JavaScript errors |

The tested 800×700 button was at approximately x=676, y=373, above the fixed composer. The target received the final edited summary exactly and did not use tools. A previous published-0.3.9 run with the omission had **failed** the no-tools and button-hit checks, so this is a direct before/after regression test.

## Test-driven evidence

Journeys: preserve an active source-user restriction in the reviewable handoff; keep the confirmation reachable after changing edit mode and continuation choice. The new fake-host integration test was RED because the worker reply lacked the prohibition. A real-browser alpha.2 hit-test was RED because the fixed composer intercepted the button. Additional RED tests caught a permission question being mistaken for a revocation and optional non-use being mistaken for a prohibition. After the changes, `npm test` passed 211 tests, and the same browser flow passed on the official alpha.2 host. Targeted coverage for `src/compression.ts` was 100% lines, 90.12% branches and 93.10% functions; the two-file targeted run covered 92.93% lines overall. `npm run verify` checks the compiled bundle, dataset integrity and package smoke in addition to the tests.

## Boundaries

- The final candidate's one model-backed preview and migration is a fixed sample, not a statistical guarantee (an earlier intermediate candidate also passed once). This run did not repeat alpha.1's V3→V4 upgrade, image fallback, plugin live toggle or uninstall gates.
- The deterministic guard covers a few explicit Chinese/English tool and file prohibitions, not arbitrary natural-language instructions. Users should still review and edit the handoff. A later explicit permission supersedes the recognized earlier prohibition.
- The npm registry's 0.3.9 and Git tag `v0.3.9` are unchanged. Releasing this code requires a later package version; the README does not claim the old package contains it.
- The raw driver, synthetic test home and screenshots stay outside the repository. No other UI/plugin combination or Windows host was tested.
