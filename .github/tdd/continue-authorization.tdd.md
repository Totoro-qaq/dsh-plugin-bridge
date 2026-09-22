# Bounded continuation authorization

Date: 2026-09-22. Scope derived from the user's request to clarify the meaning of **Continue directly**, after a live target repeated the handoff's old generic wait condition instead of continuing.

## User journeys and implementation

- Selecting **Continue directly** / `--continue` confirms the already-defined next step in the current target request, satisfying generic waits for continuation.
- Specific action approvals, tool permissions, safety restrictions, task scope, and other prerequisites remain binding. Session migration completion does not imply that task-specific migrations or deployments are complete.
- Default waiting behavior, the exact edited handoff, and the paused goal remain unchanged.

Only the Chinese and English `autoContinue` strings in `buildBridgeKickoff()` changed in production source. The generated `lib/compression.js` was rebuilt. No UI, host adapter, permission API, or goal mutation logic changed.

## RED → GREEN

Command: `node --experimental-strip-types --test test/summary-schema.test.mjs test/migrate.test.mjs`

- RED checkpoint `6ef2a51`: 48 tests, 45 passed, 3 failed. The new Chinese/English contracts and migration integration assertion failed because kickoff did not express the user's current continuation confirmation.
- GREEN checkpoint `cca433b`: the same 48 tests passed after the two prompt strings changed.
- No refactor was needed. These checkpoints belong to `fix/handoff-continue-authorization` and must retain their evidence if later squashed.

| Guarantee | Test | Result |
|---|---|---|
| Both languages explicitly scope current confirmation to a generic continuation wait | `test/summary-schema.test.mjs` continuation tests | PASS |
| Separate approvals, safety restrictions and unmet/unclear prerequisites remain blockers | Same bilingual tests | PASS for prompt contract, not a universal model-behavior guarantee |
| Existing default wait wording remains in place | Existing kickoff test and unchanged false branches | PASS |
| Original summary/approval constraints remain exact in goal and prompt | `test/migrate.test.mjs` autoContinue integration | PASS |
| One kickoff request; goal remains paused | Same integration test | PASS |

## Coverage and package gate

Command: `node --experimental-strip-types --experimental-test-coverage --test-coverage-include='src/compression.ts' --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 --test test/compression.test.mjs test/summary-schema.test.mjs test/migrate.test.mjs`

- 67/67 tests passed.
- `src/compression.ts`: lines 100%, branches 89.36%, functions 96%. These numbers describe this module, not repository-wide coverage.
- `npm run verify` passed: 203/203 tests, typecheck, build consistency, datasets, actual package install/import smoke.

## Official-host live replay

Node 22.23.1, real Chrome, isolated official npm DSH 0.1.5-rc.2 and 0.1.6-alpha.2. Installed a local candidate tarball, retaining version 0.3.8 without publishing it. Both installed `lib/compression.js` files were byte-identical to the checkout.

For native replay, generated a fresh preview, replaced its Markdown with the **exact previously failing alpha.2 edited summary**, selected **Continue directly**, and confirmed in the card. No old wait wording was deleted. File-handoff cases below reuse the same installed plugin's migration path without another summary-worker request.

| Case | rc.2 | alpha.2 |
|---|---|---|
| Original conflicting Chinese summary through native card: same-request `RESULT=385` | PASS | PASS |
| Same Chinese summary, default wait via summary file: no calculation result | PASS | PASS |
| English generic continuation wait via summary file: same-request `RESULT=385` | Not repeated | PASS |
| English calculation explicitly requiring separate reviewer approval: identify missing approval, do not calculate | Not repeated | PASS |

Both native runs checked `--continue`, exact submitted summary, and automatic target navigation. All six target cases preserved the exact goal objective, `phase: paused`, `roundsStarted: 0`, and made no tool calls. Both hosts passed doctor 13/13 and source user/assistant history equality; no page/console errors were recorded.

The browser driver needed a selector correction for an already-selected disabled breadcrumb and the host's collapsed older-session list. This was test setup, not a plugin fix; completed model samples were not rerun. The original failure evidence and new raw results/screenshots remain outside the repository, as do the driver and credentials.

## Limits

These are six bounded live cases, not a statistical success rate or proof of universal model compliance. The approval counterexample is harmless arithmetic, not a production deployment or destructive action. Actual permission enforcement remains the host's responsibility. Installation lifecycle, image migration, third-party UIs and unrelated plugin behavior were not revalidated for this prompt-only change. No push, PR, merge, release or npm publish was performed in this task.
