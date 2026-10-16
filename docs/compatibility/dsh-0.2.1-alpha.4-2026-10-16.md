# DSH 0.2.1-alpha.4 candidate compatibility

Date: 2026-10-16, Asia/Shanghai. Candidate package: **0.4.6**.
Starting revision: `1e340f8641c8c1f79aa2ad6593b0373a405f3fc9`.

Status: **unpublished candidate, partial acceptance; publication paused**. Local
SDK/contract/package checks and the bounded alpha.4 model/WebUI migration,
editing, isolation and restart checks below passed. The original active
mixed-profile live removal stalled; it is unresolved and **not a PASS**. Fresh
controls and final offline cleanup do not overwrite that result. No result from
the alpha.3 record is relabeled as alpha.4 evidence. Push, CI, merge, tag,
Release, npm publication and a fresh registry install are separate gates, not
established by this record.

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
| Current evidence retains the unresolved removal and exact source-prefix/restart limits, and Workshop points to that scoped record | `node --experimental-strip-types --test --test-reporter=spec test/upstream-contract.test.mjs test/workshop.test.mjs` | RED `9758520`: 18 executed, 15 passed, three intended missing-evidence/limitation failures. The same 18 passed with the final bilingual candidate guidance; no runtime behavior is changed. |

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

## Real official alpha.4 Host / WebUI results

The runtime was the published official npm **DSH 0.2.1-alpha.4**, with a local
Bridge **0.4.6** candidate, published Jot **0.2.13** and the official experimental
plugin-market bundle. All operations used isolated test Homes and synthetic
sessions. An already-authorized test credential was supplied only to the bounded
model run; no provider credential, temporary auth URL, full transcript, profile,
QA script or recording is committed. The accepted archive is the `7936e744…`
candidate identified in the backward-smoke section; final documentation/package
metadata changes are not relabeled as a different tested runtime.

| Check | Observed result | Scratch receipt |
| --- | --- | --- |
| Actual installation | Installed Bridge index/client/migrate hashes match the checkout and the accepted 0.4.6 archive. Jot is 0.2.13; compatibility exemptions are `{}`. | `bridge-qa/installed-runtime.json`, `lifecycle-verification.json` |
| Real preview and placement | The real browser composer submitted `/bridge ptc --lang en`. One worker completed in **27,277 ms** in preview directory A. Before confirmation, the source's current directory changed to B; the target was created in B, not the original directory. The worker was archived. | `bridge-qa/migration-verification.json` |
| Review and migration | This first model sample entered Text mode without a formatting rewrite. Both initial and edited Text/Markdown round-trips passed. The exact **2,883-character** reviewed draft became the paused goal and appeared in one kickoff; the target acknowledged once, with one turn, zero tools and zero goal rounds started. Original source-history prefixes stayed exact. | Same migration receipt |
| Real UI and navigation | Confirmation controls were hit-tested at 375, 768 and 1280 px. The long text editor had 524 px content in a 90 px viewport with `overflowY: auto`; automatic target opening occurred after the genuine confirmation, without a target sidebar click. Browser page errors, console errors and failed HTTP responses were zero. | Same migration receipt |
| Live disable/enable isolation | Bridge styles followed `1 → 0 → 1`; the complete unrelated-style multiset stayed exact. Jot's route remained available and AI stayed off; doctor stayed 13/13. | `lifecycle-verification.json` |
| Repeated install | The running manager returned `application: failed`, `error.code: already-installed`, `changed: false`. It did not silently replace the existing package. | `duplicate-install.json` |
| Same-Home restart | All four IDs, titles and current directories remained. Complete target events and exact goal events were preserved, with one target turn and zero tools; Jot state stayed exact and doctor was 13/13. The source prefix is bounded separately below. | `restart-verification.json` |
| Discover | The tester added a localhost-only source through the real Discover UI and saw both entries. The old Bridge 0.4.5 entry was correctly incompatible with alpha.4. This proves the local draft's UI path, not publication of a public market index or approval by any community. | `market-ui-verification.json` |

### Exact restart boundary

The source's **18-event** historical prefix remained exact, including its SHA
comparison. The complete source log was not byte-identical after shutdown and
restore: graceful Host disposal canceled two queued working-directory
notifications by appending `agent/inbox/spliced` at sequence 18, and restore
appended `session/end-seed` at sequence 19. The restored header explicitly added
`delegationDepth: 0`. Only those known lifecycle changes were accepted; this is
not a generic tolerance for arbitrary rewritten source events. The target's
complete events and goal remained exact. The initial helper's overly broad
full-log/header equality assumption was corrected against the official Host
lifecycle source; no additional target prompt or model acknowledgment was used.

### Unresolved active-profile live removal

In the original active mixed test profile, one `removeBundle('dsh-plugin-bridge')`
call exceeded the HTTP helper's **60-second** deadline. The owned pnpm subprocess
had printed `Done in 2.8s` but was still alive roughly nine minutes later. No
second removal request was submitted while it was pending. Printing Done did
not establish a process exit or an `application: applied` result: **not a PASS**.
The cause was not established, and the result is not attributed to Bridge, Jot,
the market, HMR or every alpha.4 installation without evidence.

The original Host was subsequently shut down normally, canceling its owned
package-manager operation. Offline official CLI removal cleaned the remaining
test-profile Jot/market dependencies and selections with exit 0. That recovery
and the independent controls below do not turn the original live operation into
a passing result. Publication remains paused pending a decision on this known
limitation or further diagnosis.

## Prior-Host backward smoke

The same local **0.4.6** archive was additionally installed in separate isolated,
keyless official npm **0.2.0-rc.2** and **0.2.1-alpha.3** Web Homes. No daily
Desktop/profile was read or changed, and no provider credential or model request
was used. The accepted archive SHA256 was
`7936e744e89a13d53fc77063d0075a3ee2aa5261b5cba59264e3c95506e0989a`;
it predates the final report/README additions but has the same business `lib/`.

Both actual Host versions matched their named package manifests; version
exemptions were `{}` and the candidate's engine satisfied each runtime. Installed
`lib/index.js`, `lib/client.js` and `lib/migrate.js` hashes matched this checkout.
On a populated synthetic session, doctor reported **13/13**, the authenticated
homepage returned HTTP 200 and the registered Bridge client resource returned
HTTP 200. The served code matched the installed bundle after the official
combo-resource delimiter and source-map transformation. Each removal returned
`application: applied`, no Bridge bundle remained, and the command was absent.
Normal shutdown returned, the assigned port closed and each Host process exited
0. Receipt filenames: `host-receipt-1792117364432.json` (rc.2) and
`host-receipt-1792117367964.json` (alpha.3), in the scratch `backward-smoke` tree.

This is a startup/contract/served-resource/removal smoke, not a new browser-card
interaction, model-backed migration or native Desktop certification on the older
Hosts. The first QA helper incorrectly required the newer `webServer.getOrigin`
on rc.2 and byte-identical served JavaScript before combo/source-map handling;
those setup assumptions were corrected using the official public API/source.
Failed attempts were retained in scratch, their test Hosts shut down, and no
Bridge product code was changed to pass the corrected checks.

## Fresh alpha.4 removal controls

Independent keyless/no-browser/no-model Homes reused the same official alpha.4
runtime and original 0.4.6 archive. Each removal was one call with an explicit
**90-second** outer deadline; success required the actual returned result and
pnpm exit code, not text in its log.

- Bridge alone: removal returned `application: applied`, pnpm exit 0, in **505 ms**.
  Doctor 13/13, installed runtime hashes and client HTTP 200 passed first. The
  bundle and command disappeared; normal shutdown returned, port closed and the
  process exited 0. Receipt: `host-receipt-1792118010656.json`.
- Same package graph — Bridge 0.4.6 + Jot 0.2.13 + official experimental market
  alpha.4: Bridge removal returned applied/exit 0 in **3,453 ms**, and Jot removal
  returned applied/exit 0 in **3,145 ms**. The Bridge command and bundle were gone;
  Jot's tools had stayed zero. Receipt: `host-receipt-1792118119414.json`.
- That mixed helper then incorrectly required the official market to be
  API-removable too. It returned `not-removable` in 74 ms because this official
  runtime ships the market bundle; the manager's profile-owned removal rule does
  not own the installation copy. The helper's overall `failed` status is retained
  alongside the independent successful Bridge/Jot removal fields. After normal
  shutdown, official offline CLI cleanup removed only the test profile's market
  dependency/selection; exit 0, no extra dependencies and only base/web-app
  selected. The runtime-provided market package was not deleted. See
  `offline-market-cleanup.json`.

The controls show the original stall is not inevitable for Bridge alone or that
fresh package graph. They do not explain the original active-profile failure or
certify arbitrary plugin combinations, changed-business-byte hot replacement or
a failure/cancellation rollback scenario.

## Acceptance boundaries

The previous [alpha.3 run](dsh-0.2.1-alpha.3-2026-10-15.md) observed a mixed
bare-path/bullet summary that could not enter Text mode losslessly. The tester
explicitly edited Markdown before Text round-trip. The parser and that fallback
guard are unchanged. This alpha.4 sample needed no rewrite; that single success
does not erase the earlier observed fallback or prove every model summary can
enter Text mode losslessly.

Finish or save pending previews before unloading/stopping Bridge: unconfirmed
edits and confirmation state are process memory. Bridge does not rewrite the
source; the separate Host lifecycle appends are scoped above.
Workshop `activation: restart-host`, permissions, `failureIsolation: null` and
`hotReload: null` remain conservative. Different-business-byte hot replacement,
approved-plan real execution, images, native alpha.4 Desktop, Windows and Linux
were not re-certified. Browser checks have no pixel baseline and are not full
visual-regression or accessibility certification.

Final cleanup was independently verified in `final-cleanup.json`:
`cleanupCompleted: true`, original Host exit 0, offline CLI cleanup exit 0, no
owned test dependencies/selections, and no listeners on the Host, browser,
localhost market or temporary debug ports. Synthetic sessions, notes and
attachments were intentionally retained. The dangling `.bin/dsh-bridge` link
still had `exists: true`, `symlink: true`, `targetExists: false`; package-manager
caches were not purged. Production profiles and primary repositories were
untouched. This is scoped runtime/profile cleanup, not zero disk residue or a
passing original live-removal case.

Workshop install/remove evidence links now point to this **partial** record. The
remove link includes the unresolved original case, successful independent
controls and offline cleanup; it is not a blanket live-removal PASS.
