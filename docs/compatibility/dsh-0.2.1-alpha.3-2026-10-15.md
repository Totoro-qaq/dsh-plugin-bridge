# DSH 0.2.1-alpha.3 bounded candidate acceptance

Date: 2026-10-15, Asia/Shanghai. Runtime-acceptance package: **0.4.4** candidate.
Starting revision: `ae11e56784b5b0e45258bd2b3f53532b475bb61a`.

Status: local SDK, contract, lifecycle, coverage and package checks, plus the
bounded real alpha.3 Host/model/WebUI run below, have passed. The runtime was the
official npm Host with a **locally packed Bridge 0.4.4 candidate**, co-installed
with a local Jot 0.2.12 candidate. At acceptance time these compatibility changes
were unpublished. That historical run does not establish CI, native Desktop alpha.3 or hot-reload
certification for different business bytes. The earlier native Desktop 0.2.0-rc.2
acceptance remains a separate historical record. Final removal and shutdown also
passed, with the package-manager residue recorded below.

## 0.4.5 release mapping

Bridge **0.4.5** packages these compatibility declarations, SDK baseline updates,
regressions and documentation for release. Its business source and generated
`lib/` are byte-identical to the locally packed 0.4.4 candidate used below and
the starting 0.4.4 runtime revision `ae11e56`. The real model/browser acceptance
therefore retains its original 0.4.4 candidate identity; it is not relabeled as
a registry-installed 0.4.5 test.

Local 0.4.5 release preparation passed frozen `npm ci` (audit: zero
vulnerabilities), the complete `npm run verify` gate (334 tests: 333 passed,
zero failed, one existing Windows-only skip; package smoke: 70 files),
`npm run release:check -- v0.4.5`, and local npm packing. Installed SDK versions
matched their exact pins. Business source and `lib/` still had no diff against
`ae11e56`; package/lock changes from the accepted candidate were confined to
their release-version roots. Before the version update, the release check
correctly rejected `v0.4.5` against package 0.4.4.
The release/tag/registry publication and fresh registry-install results must be
recorded separately after they occur; this mapping does not assert them.

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
| Plugin cache cleanup and HMR | Both READMEs scope `already-installed` to the running plugin manager / Remote API and describe API removal before replacement. CLI replacement separately stops the selected profile's Host, removes/adds the package and starts the Host. Real Host removal/reinstallation from different archive paths with the same business bytes applied without restarting; different-business-byte replacement was not tested. |
| Session storage unload | Bridge does not own the Host's storage plugin. Normal shutdown/restart preserved the three synthetic session IDs/titles and paused target goal; the storage-plugin-unload edge itself was not isolated. |
| Credential priority | Bridge adds no credential store or resolver. A real headless run must account for alpha.3's environment/`.env` preference; saved Desktop/Web credentials do not establish headless readiness. An existing authorized test key was loaded only into the isolated Host process; no provider credential was printed or committed. |
| Minimal image support / PTC in-memory execution | These are upstream capabilities, not new Bridge features. The target's paused goal and zero tool calls were verified; image transfer/fallback and PTC in-memory execution were not re-certified. |

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
| Workshop install/remove links identify this actual alpha.3 acceptance and preserve conservative activation/permission claims | `node --test --test-reporter=spec test/workshop.test.mjs` | Host-evidence RED checkpoint `419bd2c`: three executed, two passed, the old alpha.2 evidence link failed. GREEN checkpoint `7b94d5b`: the same gate passed after updating only install/remove links; `restart-host`, permissions, `failureIsolation: null` and `hotReload: null` remain unchanged. |

The SDK GREEN followed:

```bash
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci --ignore-scripts --no-audit --no-fund
```

The repository's existing `.npmrc` sets `legacy-peer-deps=true`: DSH SDK packages
are development/type inputs and the running Host supplies the complete shared
peer graph. The real Host run separately installed/reinstalled the candidate via
the official manager and verified its installed runtime bytes and SDK versions.
That success is not a claim that every co-installed package has a warning-free
peer graph; pnpm reported peer warnings during Jot reinstallation.

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
  findings and never printed matched values. The runtime-acceptance package
  version remained 0.4.4; the subsequent release mapping is described above.

## Real official Host / WebUI acceptance

All runtime operations used one isolated alpha.3 Home and synthetic sessions.
No daily Desktop profile was upgraded, removed or edited. The public machine
receipts listed below were inspected in scratch; this report records their
results without committing temporary QA scripts, profiles, recordings,
credentials or full model transcripts.

| Check | Observed result | Machine receipt |
| --- | --- | --- |
| Actual Host and candidate | `@deepseek-ai/dsh`, session-controller, renderer, slots and tools were `0.2.1-alpha.3`; Cordis `4.0.5-alpha.2`, Schemastery `3.18.5-alpha.2`. Installed Bridge index/client/migrate hashes matched the checkout. Package 0.4.4 was a local candidate, not a registry release of these changes. | `runtime-verification.json` |
| Real preview and directory placement | The model worker completed in 37 seconds in preview directory A. Before confirmation, the source moved to B; the target was created in B. The worker was archived afterward. | `preview.json`, `migration-verification.json` |
| Reviewed handoff and target safety | The exact 2,669-character reviewed draft became the goal and appeared in one kickoff, the goal was paused, the first target turn completed with zero tool calls, and the original source-history prefix stayed exact. | `migration-verification.json` |
| Actual card and navigation | Confirmation controls were hit-tested at 375, 768 and 1280 px. Long text scrolled inside a 90 px editor with 503 px content height; target opening happened automatically. | `migration-verification.json`, `bridge-navigation.json` |
| Live toggle isolation | Bridge's single style contribution disappeared and returned across disable/enable; unrelated CSS multisets stayed unchanged and Jot's API stayed available. Jot disable/enable separately left Bridge doctor available. | `toggle-verification.json` |
| Running-manager repeated install | Installing the already installed Bridge archive returned `application: failed`, `error.code: already-installed`, `changed: false`; the existing running package stayed unchanged. | `duplicate-bridge-install.json`, `reinstall-verification.json` |
| Remove and reinstall | Both candidate packages were removed and installed from different archive paths with the same business bytes. All phases returned `application: applied`, without a manual Host restart. Bridge command/style and Jot route/navigation/tools cleared, then doctor 13/13 and one Bridge style returned. Jot note and 79-byte attachment stayed exact, and the new archive specs persisted. | `reinstall-verification.json` |
| Normal stop and same-Home restart | Shutdown exited 0; all three session IDs and titles, target directory and exact paused goal persisted. Goal rounds started remained zero, target turn count did not increase, target tools remained zero, source prefix stayed exact, and doctor was 13/13. | `restart-verification.json` |
| Final removal | Both removals returned `application: applied`. Bridge/Jot styles were zero, Jot API returned 404 and its tools were zero, neither bundle remained listed, and Bridge's command was absent while the official Host stayed usable. Notes JSON and the 79-byte attachment remained byte-exact; three sessions stayed stored. | `cleanup-verification.json` |
| Final process cleanup | Host and browser launcher exited 0; neither test port 3252 nor 3253 had a listener. Production profiles and primary repositories were untouched. | `final-cleanup.json` |

### First-sample Text fallback

The first model-produced five-section summary **did not enter Text mode**. Its
Key files section began with a bare absolute path to `workspace-preview-A`, then
a bullet line `- Current working directory; no project files were listed.`
The existing parser selected plain rows from the first line and rejected the
mixed bullet at `src/client-contract.ts:223`. The UI displayed its lossless-edit
fallback notice and left the generated Markdown unchanged.

The tester then explicitly edited the real Markdown textbox by adding `- ` to
the path line. Both rows were now bullets; path and explanatory words were
retained. Text/Markdown round-trip and subsequent reviewed edits passed before
confirmation. No parser protection was relaxed, product code changed or new
model sample substituted to hide the first result. This sequence is recorded in
`bridge-original-text-fallback.json` and `migration-verification.json`; the
receipt contains the generated and explicitly reviewed Markdown separately.

### Boundaries and final cleanup

Only same-business-byte reinstallation was tested. The hoisted install used
fixed `node_modules/name` directories, so a changed realpath was not a valid
refresh criterion; saved source specs, installed bytes and recovered runtime
capabilities were checked instead. The first QA helper's incorrect realpath
assumption was retained in scratch and corrected before the passing receipt.

The run did not revalidate real approved-plan execution, image transfer or
fallback, Windows/Linux, native Desktop alpha.3, Desktop font shortcuts or PTC
in-memory reuse. It does not certify arbitrary third-party plugin/UI mixes,
different-business-byte hot replacement or statistical model reliability.

Final uninstall removed the runtime contributions, but pnpm retained a dangling
`node_modules/.bin/dsh-bridge` symlink: `exists: true`, `targetExists: false`.
Package-manager caches and metadata also remain. No user-global cache was
manually purged. Synthetic notes, the attachment and all three sessions were
intentionally preserved. This is scoped runtime/package removal, not a claim of
zero disk residue. No further service was started after final shutdown.

Workshop install/remove evidence now points here. Activation remains
`restart-host`; permissions, cache policies, `failureIsolation: null` and
`hotReload: null` remain unchanged. Save or finish pending previews before
stopping/removing Bridge, and generate a fresh preview after reinstallation.
