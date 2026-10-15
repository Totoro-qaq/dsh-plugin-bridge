# DSH 0.2.1-alpha.3 compatibility candidate

Date: 2026-10-15, Asia/Shanghai. Bridge package version: **0.4.4**, unchanged.
Starting revision: `ae11e56784b5b0e45258bd2b3f53532b475bb61a`.

Status: local SDK, contract, lifecycle, coverage and package checks have passed.
**Real alpha.3 Host/model/WebUI acceptance is pending.** This record does not
claim a published Bridge release, CI result, native Desktop upgrade or hot reload
certification. The previously recorded native Desktop baseline is 0.2.0-rc.2.

## Source and scope

- [Official alpha.3 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.3),
  tag commit `2fbf435`, published 2026-10-14.
- Public npm SDK tarballs were compared with alpha.2 using `npm diff` for all
  eight direct DSH development packages, including their emitted declarations.
- [Official HMR upgrade guide at the alpha.3 tag](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/docs/upgrade-guide/v0.2.1-alpha.2/plugin-install-over-installed/guide.md).
- [Official CLI plugin command at the alpha.3 tag](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.3/apps/cli/src/plugin.ts)
  calls profile package operations with `execution: 'cli'`, separately from the
  running `pluginManager.installBundle()` API.

The change adds only exact `0.2.1-alpha.3` to the existing `engines.dsh` and
Workshop named-host declarations. It does not claim later prereleases or stable
0.2 releases. All eight DSH development SDKs are pinned to `0.2.1-alpha.3` and
Cordis is pinned to `4.0.5-alpha.2`, matching the SDKs' official
`~4.0.5-alpha.2` peer. The session-controller SDK resolves its own Schemastery
`3.18.5-alpha.2`; Bridge's existing stable Schemastery dependency is unchanged.
The lockfile and actual installed manifests are asserted by regression tests.

No Bridge business source or generated `lib/` changed. The relevant upstream
differences and boundaries are:

| Upstream area | Bridge consequence and validation boundary |
| --- | --- |
| Session creation / current preset restoration | The public `SessionController.create(request)` still returns a session ID, which may differ from an optional requested ID. Bridge requests a fresh conversation and uses the returned ID for model selection, title, goal resolution and kickoff; the adapter regression covers this invariant. Internal `ensureSession`/`SessionCommandController.prompt` changes are not Bridge's entry points. |
| Plugin cache cleanup and HMR | Both READMEs scope `already-installed` to the running plugin manager / Remote API and describe API removal before replacement. CLI replacement separately stops the selected profile's Host, removes/adds the package and starts the Host. Existing real Cordis / official SlotRegistry tests cover registration, owner removal/remount and unload without duplicate contributions. This is not proof of live browser package replacement. |
| Session storage unload | Bridge does not own the Host's storage plugin. Persistence across real Host restart/removal still requires Host acceptance. |
| Credential priority | Bridge adds no credential store or resolver. A real headless run must account for alpha.3's environment/`.env` preference; saved Desktop/Web credentials do not establish headless readiness. No credential values were read or printed during local work. |
| Minimal image support / PTC in-memory execution | These are upstream capabilities, not new Bridge features. Image transfer/fallback and the target's paused goal require separately stated runtime evidence; local tests do not certify model vision or PTC execution. |

## TDD evidence

The journeys were derived during this task: preserve earlier supported hosts while
adding only alpha.3; compile and exercise the actual current SDK; retain fresh
target identity and goal safety; explain replacement without losing a pending
handoff draft unexpectedly.

The initial worktree contained stale `node_modules` (DSH 0.1.6-alpha.2 and Cordis
4.0.4) despite alpha.2 declarations. A frozen install restored the alpha.2
baseline before RED. The unmodified baseline `npm run verify` passed: 331 tests,
330 passed, zero failed, one platform skip, package smoke successful.

| Guarantee | Test / command | Evidence |
| --- | --- | --- |
| Bounded Host declaration, all exact SDK pins, installed Cordis and lockfile agree | `node --experimental-strip-types --test --test-reporter=spec test/upstream-contract.test.mjs test/load.test.mjs test/workshop.test.mjs test/dsh-alpha-host.test.mjs` | RED checkpoint `80fa4bb`: 58 executed, 54 passed, four intended failures (missing alpha.3 Host/Workshop declaration, alpha.2 SDK pin, installed Cordis alpha.1). GREEN checkpoint `c4fee99`: the same 58 passed after lock regeneration and frozen installation. |
| Alpha.3 creation cannot make migration act on an assumed target ID | `test/dsh-alpha-host.test.mjs` fresh-target identity case | Passed before and after SDK alignment. No runtime defect or runtime RED is claimed. |
| Upgrade guidance explains refusal, remove-before-install, memory-only drafts and separate Desktop evidence in both languages | `node --experimental-strip-types --test --test-reporter=spec test/upstream-contract.test.mjs` | RED checkpoint `19889b1`: 13 executed, 12 passed, missing upgrade guidance failed. GREEN checkpoint `3763455`: the same 13 passed. |
| The HMR refusal is scoped to the running API; CLI replacement explicitly stops the corresponding Host before remove/add and starts it afterward | Same upstream-contract command | Review follow-up RED checkpoint `b11e1b8`: 13 executed, 12 passed, the missing running-API scope failed. GREEN checkpoint `3749c89`: the same 13 passed after the bilingual clarification, checked against the official CLI source. |
| Official slot registration follows owner and plugin lifetimes | `test/client-slots.test.mjs` | Uses actual installed Cordis, SlotCore, SlotRegistry and the built Bridge client; visual primitives and DOM rendering are stubbed. |

The SDK GREEN followed:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
```

The repository's existing `.npmrc` sets `legacy-peer-deps=true`: DSH SDK packages
are development/type inputs and the running Host supplies the complete shared
peer graph. This local install does not prove the official plugin installer or
the existing optional Cordis peer behavior on a live alpha.3 Host.

## Verification and coverage

- `npm run verify`: the final gate passed **334 tests (333 passed, zero failures,
  one platform skip)**, build, typecheck, generated-artifact comparison, datasets
  and packed-artifact installation/import: `dsh-plugin-bridge@0.4.4 (70 files)`.
  The earlier SDK-only GREEN passed 333 tests before the documentation regression
  was added.
- The later documentation-only review clarification reran the same 13-test
  upstream-contract gate successfully and `git diff --check`; it changed no
  runtime source, SDK pin, generated artifact or Host acceptance status.
- Node's coverage runner executed all 15 `test/*.test.mjs` files, with
  `--experimental-strip-types --test --experimental-test-coverage
  --test-coverage-include=src/** --test-reporter=spec`: **334 tests, 333 passed,
  zero failed, one skipped; lines 95.11%, branches 81.65%, functions 92.87%**.
- The existing skip is `Windows 上不同分隔符指向同一份摘要`, which requires Windows;
  no new skip or disabled test was added.
- Coverage is for loaded `src/**` files. The browser client is exercised as its
  built bundle, and `client.tsx` is not included in that source-only percentage.
  Unit/contract checks do not replace real pixels, navigation or model acceptance.
- Build and typecheck are part of `verify`; there is no standalone lint script.
  `git diff --check` passed. An added-line credential-pattern scan reported zero
  findings and never printed matched values. Package version remained 0.4.4.

## Pending real Host acceptance

Use only an isolated alpha.3 profile and synthetic sessions. Before publishing a
support claim, record the actual package installation and optional-peer result,
doctor 13/13, model-backed preview/edit/confirm, returned target navigation,
unchanged source and paused goal, co-installed Jot, plugin disable/enable,
duplicate-install refusal without altering the existing run, remove/reinstall
mapping refresh, and restart/storage recovery. Save or finish pending previews
before removal, then regenerate the preview after reinstallation.

Workshop activation remains `restart-host`; `failureIsolation` and `hotReload`
evidence stay null. Existing install/remove links still identify the prior
alpha.2 acceptance until a real alpha.3 result is available. No temporary QA
script, profile, recording, credential, or model transcript is included here.
