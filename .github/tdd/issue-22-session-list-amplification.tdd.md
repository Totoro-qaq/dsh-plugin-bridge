# Issue #22: session list scan amplification

## Source and user journeys

The guarantees were derived from [GitHub issue #22](https://github.com/Totoro-qaq/dsh-plugin-bridge/issues/22), without a separate plan document.

- As an operator with many sessions, I want Bridge to poll only the compression worker so migration latency and gateway CPU do not scale with every stored session.
- As a Bridge user, I want a slowly queued worker to finish before its summary is read, so the optimization does not reintroduce the early-idle race.
- As a CLI or WebUI user, I want one source-session snapshot reused throughout a command so preset, title, cwd, and placement do not trigger redundant global scans.

## RED and GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED | `node --experimental-strip-types --test --test-name-pattern='preview \\+ execute' test/migrate.test.mjs` | Expected failure | 30 worker polls produced 32 `session.list` calls; assertion expected 1. Commit `7b48e0a`. |
| GREEN | `node --experimental-strip-types --test --test-name-pattern='preview \\+ execute\|waitIdle' test/migrate.test.mjs` | PASS, 2/2 | Worker completion uses per-session `session.history`; the same 30-poll flow performs one source-list lookup, and delayed start remains correct. |
| Full verification | `npm run verify` | PASS, 126/126 | Includes build, typecheck, generated `lib/` consistency, dataset checks, and isolated package smoke installation. |
| Coverage | `node --experimental-strip-types --experimental-test-coverage --test test/migrate.test.mjs` | PASS | 89.43% line coverage overall; `src/migrate.ts` 94.43% line coverage. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Worker poll count no longer increases global `session.list` scans | `preview + execute：worker 轮询不应把 session.list 放大成全局扫描` | Integration | PASS |
| 2 | A worker that starts after several polls is not mistaken for a completed worker | `waitIdle：会话排队慢也不会被误判成已跑完` | Integration | PASS |
| 3 | Preview, migration, CLI, and slash-command paths accept and reuse one source-session row | Full `npm test` suite | Integration / CLI | PASS |
| 4 | Generated package artifacts match TypeScript source and install/import successfully | `npm run build:check`, `npm run package:smoke` | Packaging | PASS |

## Implementation boundary and known gap

DSH `0.1.1-rc.2` has no unary `session.get` or `session.status` RPC. Bridge therefore records the worker's pre-prompt event watermark and polls that session's bounded history tail for a newer `turn/end`. If upstream later exposes a direct completion/status method, it can replace this compatibility path without changing the migration contract.

No real model tokens were used by these tests; runtime compatibility still relies on the already-supported upstream `turn/start` and `turn/end` history events.
