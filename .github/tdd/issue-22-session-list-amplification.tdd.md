# Issue #22: session list scan amplification

## Source and user journeys

The guarantees were derived from [GitHub issue #22](https://github.com/Totoro-qaq/dsh-plugin-bridge/issues/22), without a separate plan document.

- As an operator with many sessions, I want Bridge to poll only the compression worker so migration latency and gateway CPU do not scale with every stored session.
- As a Bridge user, I want a slowly queued worker to finish before its summary is read, so the optimization does not reintroduce the early-idle race.
- As a CLI or WebUI user, I want one source-session snapshot reused throughout a command so preset, title, cwd, and placement do not trigger redundant global scans.

## RED and GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `node --experimental-strip-types --test --test-name-pattern='preview \+ execute' test/migrate.test.mjs` | Expected failure | 30 worker polls produced 32 `session.list` calls; assertion expected 1. Commit `7b48e0a`. |
| GREEN | `node --experimental-strip-types --test --test-name-pattern='preview \+ execute|waitIdle' test/migrate.test.mjs` | PASS, 2/2 | Worker completion uses per-session `session.history`; the same 30-poll flow performs one source-list lookup, and delayed start remains correct. |
| Full verification | `npm run verify` | PASS, 126/126 | Includes build, typecheck, generated `lib/` consistency, dataset checks, and isolated package smoke installation. |
| Coverage | `node --experimental-strip-types --experimental-test-coverage --test test/migrate.test.mjs` | PASS | 89.43% line coverage overall; `src/migrate.ts` 94.43% line coverage. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Worker poll count no longer increases global `session.list` scans | `preview + execute：worker 轮询不应把 session.list 放大成全局扫描` | Integration | PASS |
| 2 | A worker that starts after several polls is not mistaken for a completed worker | `waitIdle：会话排队慢也不会被误判成已跑完` | Integration | PASS |
| 3 | Slash-command preview/confirm performs one source-list read per invocation | `/bridge code --go：用预览的摘要建目标会话，goal 只给一轮` | Command integration | PASS |
| 4 | One-shot CLI run reuses the preview source row during migration | `run：预览 + 迁移一步到位` | CLI E2E | PASS |
| 5 | Generated package artifacts match TypeScript source and install/import successfully | `npm run build:check`, `npm run package:smoke` | Packaging | PASS |

## Implementation boundary and known gap

DSH `0.1.1-rc.2` has no unary `session.get` or `session.status` RPC. Bridge therefore records the worker's pre-prompt event watermark and polls that session's bounded history tail for a newer `turn/end`. If upstream later exposes a direct completion/status method, it can replace this compatibility path without changing the migration contract.

## Live model acceptance

On 2026-08-24, the current branch was packed and installed into a fresh isolated official `@deepseek-ai/dsh@0.1.1-rc.2` Web profile. One real `deepseek-official/deepseek-v4-flash` migration ran through the installed command registry:

| Gate | Result |
|---|---:|
| `/bridge --doctor` | 13/13 |
| Source response exact low-collision facts | 4/4 |
| `/bridge minimal --tier flash --lang en` preview facts | 4/4 |
| Migrated minimal target first response facts | 4/4 |
| Preview duration | 5,319 ms |
| Preview worker nominal tokens | 1,998 |
| Target nominal tokens | 1,804 |
| Migration total nominal tokens | 3,802 |
| Test sessions archived | 3/3 |

The separate source-fixture turn used 9,188 nominal tokens and is excluded from migration overhead. The target preserved the source model and `high` reasoning effort. The source, preview worker, and target were all cancelled if needed and archived after the assertions.

The automated suite itself uses no model tokens. The live check is one controlled compatibility run, not a latency or token population benchmark; runtime compatibility still relies on upstream `turn/start` and `turn/end` history events.
