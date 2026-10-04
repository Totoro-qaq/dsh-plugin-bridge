# DSH 0.2.1-alpha.1 support declaration: TDD receipt

Journeys derive from the user's request to adapt, verify and release **Bridge** on the latest upstream. The scope is not Cobsidian and does not authorize another plugin initiative.

- RED checkpoint: `b5301d4`, `node --test test/load.test.mjs`: 15 pass / 1 fail. The delivered-package manifest test executes and fails because the old range does not declare the exact new alpha.1 target.
- GREEN checkpoint: `da71350`, same command: 16/16 pass. It preserves the original range and adds only `0.2.1-alpha.1`; runtime source, generated lib, peer ranges and SDK pins remain unchanged.
- Baseline `npm test`: 234/234 pass before the metadata change. Full `npm run verify` repeats the suite plus typecheck, generated-artifact check, datasets and actual tarball smoke.
- [Real official-host acceptance](../../docs/compatibility/dsh-0.2.1-alpha.1-2026-10-04.md) proves rendered editing, exact ordinary handoff, one native approved-plan execution, paused goals and idle plugin lifecycle separately from the manifest unit gate.
- Runtime coverage is not newly measured because this task changes no runtime logic. Images, Desktop, exhaustive responsive/a11y testing and later upstream versions are outside the fresh acceptance scope.

Preserve this RED/GREEN mapping in the PR body before squash merge. A prior checkpoint message understated the other RED-target passes as 13; the actual captured result is 15 pass and 1 fail, as recorded here.
