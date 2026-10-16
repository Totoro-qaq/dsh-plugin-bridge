# DSH 0.2.1-alpha.4 candidate compatibility

Date: 2026-10-16, Asia/Shanghai. Candidate package: **0.4.6**.
Starting revision: `1e340f8641c8c1f79aa2ad6593b0373a405f3fc9`.

Status: local declaration, installed SDK, coverage, package and release-version
checks have passed. Isolated official Host/WebUI acceptance is being run
separately; no result from the alpha.3 record is relabeled as alpha.4 evidence.
Push, CI, merge, tag, Release, npm publication and a fresh registry install are
separate gates, not established by this candidate record.

## Scope and official sources

- [Official alpha.4 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.4), tag commit `86a4022`.
- [Host compatibility evaluator](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/app-boot/src/plugin-compatibility.ts) evaluates an own `engines.dsh` first and uses `semver.satisfies` with `includePrerelease: true`. Bridge 0.4.5's exact alpha.3 disjunction does not admit alpha.4; this change appends only exact alpha.4, retaining earlier support and rejecting unlisted later prereleases.
- [Running plugin manager](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/plugin-manager/src/index.ts) retains its HMR `already-installed` refusal. The running API must remove the package before reinstallation. The [CLI](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/apps/cli/src/plugin.ts) separately performs profile package operations; stop the corresponding Host before CLI remove/add and start it afterward.

All eight DSH development SDKs are exact `0.2.1-alpha.4`; lockfile roots, resolved
packages and actual installed package manifests are asserted. Cordis remains
`4.0.5-alpha.2`, matching the official SDK peer. The controller's nested
Schemastery is `3.18.5-alpha.2`; Bridge's direct stable Schemastery dependency and
Host-supplied SDK peers are unchanged. Business `src/` and generated `lib/` have
no diff against the starting revision.

## Test-driven evidence

Journeys were derived in this task: install on the named new Host without a
compatibility exemption; preserve all older declarations; compile against the
actual published SDK; keep draft-loss and conservative lifecycle boundaries
visible while documenting the current upstream manager behavior.

| Guarantee | Test / command | Evidence |
| --- | --- | --- |
| Exact alpha.4 engine and Workshop declarations, exact current SDK and installed manifests | `node --experimental-strip-types --test --test-reporter=spec test/upstream-contract.test.mjs test/load.test.mjs test/workshop.test.mjs` | RED `a968167`: 33 executed, 29 passed and four intended declaration/SDK failures. GREEN `e7fd588`: the same 33 passed after lockfile regeneration and frozen `npm ci`. |
| Version and tag agree | `npm run release:check -- v0.4.6` | Failed as intended against package 0.4.5; passed after the local package/lock root became 0.4.6. npm registry lookup returned E404 for 0.4.6 before preparation; this is not publication. |
| Current upgrade instructions retain alpha.3 evidence, CLI/API separation and Text/HMR limits | `node --experimental-strip-types --test --test-reporter=spec test/upstream-contract.test.mjs` | RED `f7c2634`: 14 executed, 12 passed, missing alpha.4 wording and acceptance links failed. The same 14 passed after the bilingual guidance and this candidate record were added. |

## Local verification

- Frozen `npm ci --ignore-scripts --no-audit --no-fund` completed successfully.
- `npm run verify` at SDK GREEN `e7fd588` passed build, typecheck, **334 tests:
  333 passed, zero failed, one existing Windows-only skip**, generated `lib/`
  consistency, datasets, and packed install/import smoke (**70 files**).
- After the documentation regression was added, the source coverage run executed
  all **335 tests: 334 passed, zero failed, one platform skip**. Command:
  `node --experimental-strip-types --test --experimental-test-coverage
  --test-coverage-include=src/** --test-reporter=spec test/*.test.mjs`.
  Coverage: **95.11% lines, 81.65% branches, 92.87% functions** for loaded `src/**`.
  `client.tsx` is exercised as a built bundle and is not in that source-only
  coverage percentage; these checks are not browser pixel acceptance.
- `npm audit --omit=dev --json` reported zero vulnerabilities. This is a registry
  audit snapshot, not a complete security review.
- `git diff --check` passed; no standalone lint script exists. No runtime
  `src/` or generated `lib/` change is present against the starting revision.

## Acceptance boundaries

The previous [alpha.3 run](dsh-0.2.1-alpha.3-2026-10-15.md) observed a mixed
bare-path/bullet summary that could not enter Text mode losslessly. The tester
explicitly edited Markdown before Text round-trip. The parser and that fallback
guard are unchanged; old model acceptance is not a new alpha.4 model result.

Finish or save pending previews before unloading/stopping Bridge: unconfirmed
edits and confirmation state are process memory. The source session is untouched.
Workshop `activation: restart-host`, permissions, `failureIsolation: null` and
`hotReload: null` remain conservative. Different-business-byte hot replacement,
approved-plan real execution, images, native alpha.4 Desktop, Windows and Linux
are not certified by the local contract checks.

Previous uninstalls retained a dangling `.bin/dsh-bridge` link and package-manager
cache metadata. No zero-disk-residue uninstall is claimed. Real alpha.4 removal
and restart observations will be recorded only after that run completes.
