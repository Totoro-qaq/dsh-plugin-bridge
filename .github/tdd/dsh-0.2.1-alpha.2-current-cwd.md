# DSH 0.2.1-alpha.2 current-directory TDD evidence

This work stays in `compat/dsh-0.2.1-alpha.2`. No checkpoint commits were
created: the human commit/release gate overrides automatic skill commits.
Changes and this report remain uncommitted. Real-host acceptance belongs to a
separate root-agent stage and is not claimed here.

## Intent and test runner

Journeys were derived from the approved compatibility task: when a source
session moves from its original project into a worktree, its preview worker,
confirmed migration, and approved-plan execution must use that current
directory. Confirmation and retry must not trust an old preview snapshot.
Unchanged/legacy sessions retain workspace placement; malformed or unavailable
explicit current-directory data must admit no target.

The repository uses npm and the built-in Node test runner. It has no
`scripts/setup-package-manager.js` detector or dedicated coverage script, so
the existing `package.json` scripts and lockfile were used rather than adding
another test dependency. Isolated dependencies were installed with
`npm ci --ignore-scripts --no-audit --no-fund` (63 packages).

## Baseline and RED

- `npm test`: build and typecheck passed; **237 tests passed, 0 failed**.
- Before production changes:

  ```sh
  node --experimental-strip-types --test --test-reporter=spec test/migrate.test.mjs test/dsh-alpha-host.test.mjs test/host-port.test.mjs test/approved-plan.test.mjs
  ```

  Result: **109 tests, 74 passed, 35 failed**, exit code 1. All failing tests
  executed; there were no missing-dependency or compilation failures.

Representative RED excerpts:

```text
approved-plan execution reads the switched directory after stopping the planning turn
actual: { workspaceId: 'ws-1', agentPreset: 'minimal' }
expected: { cwd: '/work/shop/.worktrees/execution', agentPreset: 'minimal' }

migrate: confirmation reads the current directory again instead of trusting preview.sourceSession
actual: { workspaceId: 'ws-1', agentPreset: 'code' }
expected: { cwd: '/work/shop/.worktrees/confirmation', agentPreset: 'code' }

migrate: invalid present current directory "relative/worktree" admits no target
AssertionError: Missing expected rejection.

preview + execute: dynamic-directory freshness adds bounded reads, never worker polling
AssertionError: 1 !== 3
```

## Implementation and GREEN

- `SessionRow.currentCwd` is optional and semantic. The DSH adapter helper maps
  the `workingDirectory` projection, preserving absent legacy data, explicit
  null, and malformed-present data. Typed-controller and RPC adapters share
  this boundary; the migration core does not read DSH projection keys.
- Placement first looks up the source workspace, then reads a fresh source row
  immediately before create when the semantic current-directory field is
  present. Model/preset preparation happens before this final read. There is no
  TTL, transcript scraping, filesystem mutation, or directory normalization.
- A changed absolute cwd is sent alone, never together with workspaceId.
  Null/unchanged cwd retains the workspace; legacy absent data retains the
  existing optimization. Explicit malformed data, fresh-read failure, missing
  source, or lost projection fails closed before target create.
- Approved-plan production code is unchanged; it continues to share
  `executeMigration`, verbatim plan injection, stopped source, and paused goal.
- Metadata only adds exact `0.2.1-alpha.2` to `engines.dsh`. The lockfile's root
  engines was aligned; its dependency graph and SDK build baseline are unchanged.
  Version remains `0.4.1`; no release, tag, publish, push, or commit occurred.

The same four-suite RED command was rerun: **109 passed, 0 failed**. One initial
GREEN attempt exposed a syntax typo in the new adapter wrapper; it was repaired
and is not counted as GREEN evidence.

Metadata had a separate executed RED/ GREEN check:

```sh
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern='DSH alpha.2 candidate' test/upstream-contract.test.mjs
```

Before the metadata edit: **1 failed** because alpha.2 was absent. Afterward:
**1 passed**. Full testing then identified the existing alpha.1-only literal in
`test/load.test.mjs`; that guard now expects the same bounded alpha.2 candidate.
The intermediate full run was **275 passed, 1 failed**, not a runtime regression
and not the final GREEN result.

Directory-candidate `npm run verify`: **exit 0**, build and typecheck passed, **276 tests
passed, 0 failed, 0 skipped**, datasets check passed, package smoke passed:

```text
# tests 276
# pass 276
# fail 0
# skipped 0
datasets ok
package smoke ok: dsh-plugin-bridge@0.4.1 (65 files)
verify exit code: 0
```

### Generated-artifact comparison

An unstaged verification attempt passed all 276 tests but stopped at
`npm run build:check`, as generated runtime files differed from the Git index.
With root-agent authorization, only the seven changed/new `lib/` artifacts
were staged as a local verification step; no commit was made. Final
`build:check` passed by comparing **working tree against index**, not HEAD.
The staged artifacts remain different from HEAD by design.

A separate SHA-256 comparison of all 31 generated `lib/` files before and after
`npm run build` returned `changed: []`. `npm run pack:check` passed (dry-run, 65
files); `npm run release:check -- v0.4.1` passed only as version consistency,
not release authorization. Its first bare invocation lacked the required tag
argument and therefore failed as documented by that script.

## Test guarantees

| Guarantee | Executed test target | Type | Result |
|---|---|---|---|
| Changed cwd is forwarded alone; null/same cwd keeps workspace identity | `test/migrate.test.mjs` | semantic fake-host integration | PASS |
| Confirmation observes a directory changed after preview or during model lookup | `test/migrate.test.mjs` | semantic fake-host integration | PASS |
| Preview worker and target create each make one bounded freshness read, independent of 30 worker polls | `test/migrate.test.mjs` | performance regression | PASS |
| A create retry rereads cwd; valid absolute path bytes are not normalized | `test/migrate.test.mjs` | semantic fake-host integration | PASS |
| Wrong type, blank, relative, NUL, unavailable source, missing row, and lost projection admit no target | `test/migrate.test.mjs`, `test/dsh-alpha-host.test.mjs` | input/error regression | PASS |
| Typed and RPC adapters preserve original cwd while exposing current cwd semantically | `test/dsh-alpha-host.test.mjs`, `test/host-port.test.mjs` | adapter contract | PASS |
| A malformed unrelated row does not poison selected-source placement | `test/dsh-alpha-host.test.mjs` | adapter contract | PASS |
| Approved-plan execution sees cwd changes during source stop, retries once without another cancel, retains exact CRLF plan and paused goal | `test/approved-plan.test.mjs` | semantic fake-host integration | PASS |
| Old hosts retain cached placement and doctor remains 13-method baseline | existing migrate/load/upstream contract tests | regression | PASS |
| Support range is exact; package-lock root engines matches it; SDK baseline is unchanged | `test/upstream-contract.test.mjs`, `test/load.test.mjs` | package contract | PASS |

## Coverage and known limits

Executed coverage command:

```sh
node --experimental-strip-types --experimental-test-coverage --test-coverage-include='src/migrate.ts' --test-coverage-include='src/host.ts' --test-coverage-include='src/dsh-alpha-host.ts' --test-coverage-include='src/dsh-session-row.ts' --test --test-reporter=spec test/migrate.test.mjs test/dsh-alpha-host.test.mjs test/host-port.test.mjs test/approved-plan.test.mjs
```

The four changed runtime modules together: **95.38% lines, 80.95% branches,
86.09% functions**. The new projection mapper: **100% / 100% / 100%**. This is
scoped Node coverage, not whole-product UI/E2E coverage; alpha adapter branches
were 75.96% and migrate functions 77.59% individually, although the scoped
aggregate exceeded 80% on all measured axes. Paths exercised here are POSIX
paths on macOS. No Windows-host acceptance is claimed.

The tests run actual Bridge production functions against fake semantic/typed
hosts and existing HTTP/CLI fixtures, not an installed DSH alpha.2 runtime.
WebUI/Desktop lifecycle, real model requests, editor/navigation UX, worktree
placement under the actual controller, and uninstall/restart cleanup remain
the separate real-host acceptance gate. Candidate metadata is not a claim that
those host checks already passed. No new capabilities were added to doctor or
made mandatory on legacy hosts, and no filesystem or credential permissions
were expanded.

## Additional live-host finding: cropped worker startup

Root's isolated real alpha.2 preview failed with `worker-not-started`, although
the synthetic worker log contained `turn/start` seq 5. The two injected
`user/message` events at seq 9 and 10 made Bridge's `maxMessages: 2` poll window
begin at seq 9. That window omitted `turn/start` and `step/start`, but still held
`request/header` seq 11 and `request/context` seq 12. The supplied captured
worker subsequently ended `aborted/user` after Bridge's cancellation; that
capture is not recorded here as a successfully completed preview.

Installed `@deepseek-ai/dsh-api-session-controller@0.2.1-alpha.2` was inspected
read-only. Its `inspect()` returns the attached snapshot or complete persisted
prefix. Bridge's adapter, not that inspection, applies the two-message cut.
The installed agent-loop appends `step/start` inside an admitted turn and
`request/context` during request preparation. A `request/header` can represent
a configuration change and is not, by itself, startup evidence.

RED command before the additional production fix:

```sh
node --experimental-strip-types --test --test-reporter=spec --test-name-pattern='alpha.2 (context injection|a request still|queued user text|delayed provider error)' test/dsh-alpha-host.test.mjs
```

Result: **4 tests, 1 passed, 3 failed**, exit 1. The completed-turn test got
`{idle:true,started:false}` instead of completed; the active-request timeout
was misreported as not started; and the delayed credential error was incorrectly
classified as `worker-not-started` instead of `worker-failed`.

Minimal correction: `waitIdle` treats fresh durable `step/start`,
`request/context`, `assistant/message`, and `assistant/chunk` as execution
evidence, in addition to `turn/start`. Queued user messages, a fresh
configuration-only `request/header`, and any events at/before `afterSeq` remain
insufficient. The two-message window, per-session polling, watermark,
startup/overall timeout bounds, and `turn/end` reason handling are unchanged.
There are no extra pages, global list polling, new port requirements, or
increased timeout settings.

The same RED command reran **4 passed, 0 failed**. An initial build found the
optional `SessionEvent.type` TypeScript guard was missing; the guard was added
and subsequent build/typecheck passed. Full `npm run verify` then passed:
**280 tests, 280 passed, 0 failed, 0 skipped**, datasets and package smoke
green (65 files). Generated files were locally staged for the same index-based
reproducibility check; no commit was made.

The existing scoped coverage command now executes **113 tests, all passed**:
**95.91% lines, 81.50% branches, 88.24% functions** across the four changed
runtime modules. This regression test shows no-start, completion, active timeout,
and delayed provider-error classification. Root's real preview/UI retest is
still a separate acceptance step, not implied by fake-host GREEN.
