# DSH 0.2.1-alpha.4 compatibility and bounded acceptance

Date: 2026-10-16, Asia/Shanghai. Candidate package: **0.4.6**.
Starting revision: `1e340f8641c8c1f79aa2ad6593b0373a405f3fc9`.

Status: **local acceptance and package-manager attribution complete; publishing
gates separate**. Local SDK/contract/package checks and the bounded alpha.4
model/WebUI migration, editing, isolation and restart checks passed. The
historical active mixed-profile removal failed and remains **not a PASS**.
Later natural DSH calls on the same reconstructed package graph isolated the
known pnpm 11.22.0 late-worker shutdown mechanism with individual upstream
patches; unmodified 11.26.0 completed removal. The exact original PID task was
not retrospectively recovered. No alpha.3 result is relabeled as alpha.4
evidence. Push, CI, merge, tag, Release, npm publication and a fresh registry
install are separate gates, not established by this local record.

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
| Earlier partial-acceptance evidence retained the then-unresolved removal and exact source-prefix/restart limits, with Workshop pointing to that scoped record | `node --experimental-strip-types --test --test-reporter=spec test/upstream-contract.test.mjs test/workshop.test.mjs` | RED `9758520`: 18 executed, 15 passed, three intended missing-evidence/limitation failures. The same 18 passed with that checkpoint's bilingual candidate guidance; no runtime behavior was changed. |
| Release documentation preserves the historical failure, natural pnpm attribution and actual-executable/no-overlap guidance without requiring a permanent release pause | Same 18-test upstream-contract/Workshop target | RED `503b6c1`: 18 executed, 16 passed, two intended missing fixed-version/natural-attribution failures. GREEN: the same 18 passed after the bilingual guidance and verified causal-control results were recorded. No Bridge dependency or runtime change was made. |

## Local verification

- Frozen `npm ci --ignore-scripts --no-audit --no-fund` completed successfully.
- `npm run verify` at SDK GREEN `e7fd588` passed build, typecheck, **334 tests:
  333 passed, zero failed, one existing Windows-only skip**, generated `lib/`
  consistency, datasets, and packed install/import smoke (**70 files**).
- The complete final `npm run verify` at `bbdb2ee` passed **336 tests: 335 passed,
  zero failed, one existing platform skip**, build/typecheck, unchanged generated
  `lib/`, datasets and packed install/import smoke (**71 files**, including this
  new report). The subsequent evidence-only edit records that actual result.
- After the natural pnpm attribution and release-guidance GREEN at `91b2076`,
  `npm run verify` passed again: **336 tests, 335 passed, zero failed, one
  existing Windows-only skip**, build/typecheck, generated `lib/` comparison,
  datasets and **71-file** packed installation/import smoke. The final report
  update only records that result; no runtime or dependency change was needed.
- With the final documentation regressions, the source coverage run executed
  all **336 tests: 335 passed, zero failed, one platform skip**. Command:
  `node --experimental-strip-types --test --experimental-test-coverage
  --test-coverage-include=src/** --test-reporter=spec test/*.test.mjs`.
  Coverage: **95.11% lines, 81.65% branches, 92.87% functions** for loaded `src/**`.
  `client.tsx` is exercised as a built bundle and is not in that source-only
  coverage percentage; these checks are not browser pixel acceptance.
- `npm audit --omit=dev --json` reported zero vulnerabilities. This is a registry
  audit snapshot, not a complete security review.
- `git diff --check` passed; no standalone lint script exists. No runtime
  `src/` or generated `lib/` change is present against the starting revision.
  An added-line credential-pattern scan found zero findings without printing
  matched values. `npm run release:check -- v0.4.6` passed locally; no publication
  is implied.

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

### Original active-profile failed live removal

In the original active mixed test profile, one `removeBundle('dsh-plugin-bridge')`
call exceeded the HTTP helper's **60-second** deadline. The owned pnpm subprocess
had printed `Done in 2.8s` but was still alive roughly nine minutes later. No
second removal request was submitted while it was pending. Printing Done did
not establish a process exit or an `application: applied` result: **not a PASS**.
The initial capture did not establish its cause. The later natural DSH controls
below explain the waiting path as a known pnpm mechanism; they do not turn this
failed operation into a successful one or identify its exact original PID task.

The original Host was subsequently shut down normally, canceling its owned
package-manager operation. Offline official CLI removal cleaned the remaining
test-profile Jot/market dependencies and selections with exit 0. That recovery
and the independent controls below do not turn the original live operation into
a passing result. Attribution was held open at this earlier checkpoint; the
later isolated upstream-patch controls close that engineering diagnosis below.

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

Those early controls showed the stall was not inevitable for Bridge alone or
that fresh package graph. Alone they did not explain the active-profile failure;
the later natural causal controls below supply that missing diagnosis. Neither
phase certifies arbitrary plugin combinations, changed-business-byte hot
replacement or a failure/cancellation rollback scenario.

## Appendix: earlier directed pnpm diagnosis and validated fixed-version control

This earlier diagnostic phase added evidence before the natural DSH causal
controls were available. It changed no Bridge source, `lib/`, dependency, plugin
script or global pnpm. The original case remains **not a PASS**; the new
attribution below does not rewrite its historical outcome.

### Official fixes and directed local fixture

[pnpm #13226](https://github.com/pnpm/pnpm/pull/13226) retains the worker-pool
reference when finishing workers so that a late task does not create an
untracked pool; its [regression](https://github.com/pnpm/pnpm/blob/2d0d75c6cfd1b48fba95014bc1826bf4622fbd8f/pnpm11/worker/test/finishWorkers.test.ts#L14-L39)
checks process exit after a worker call following `finishWorkers()`. The
[11.23.0 release](https://github.com/pnpm/pnpm/releases/tag/v11.23.0) records the
fix for installs not exiting after Done. Separately,
[pnpm #14141](https://github.com/pnpm/pnpm/pull/14141) prevents the forced previous
hoisted-graph walk from fetching skipped optional packages; its
[regression](https://github.com/pnpm/pnpm/blob/2e6d07efb9bf2206448215f94a65145c91ed93e3/pnpm11/installing/deps-restorer/test/lockfileToHoistedDepGraph.test.ts#L192-L231)
retains their previous directory entries without fetching them. The
[11.26.0 release](https://github.com/pnpm/pnpm/releases/tag/v11.26.0) includes that
hoisted-install fix. The installed 11.22.0 bundle still contained the earlier
previous-graph fetch path and worker-pool reset.

A scratch-only CLI integration extended those official test shapes with two
tiny self-authored packages: one removable ordinary dependency and one optional
`os: [win32]` package on this Darwin host. Each version used a separate fresh
fixture, hoisted `node_modules`, store, cache and configuration. A loopback-only
registry served their generated tarballs; no external package download, model,
provider key, browser or new tool was needed for the fixture. Initial installs
correctly skipped the foreign optional tarball. Only that tarball response was
delayed 2.5 seconds during removal, representing a slow fetch rather than an
arbitrary sleep after Done. Each owned child had a 10-second outer limit.

| Fresh run | Existing pnpm 11.22.0 | Isolated pnpm 11.26.0 |
| --- | --- | --- |
| `run-1792118769523` | Printed Done at 227 ms; requested the skipped optional tarball 2 ms later. Its HTTP 200 response completed after 2,501 ms, but the process was still alive at 10,007 ms and only then received the fixture's bounded SIGTERM. | No optional tarball request; natural exit 0 in 223 ms, 5 ms after Done. |
| `run-1792118806784` | Printed Done at 221 ms; requested the skipped optional tarball 1 ms later. Its HTTP 200 response completed after 2,502 ms, but the process was still alive at 10,010 ms and received bounded SIGTERM. | No optional tarball request; natural exit 0 in 219 ms, 5 ms after Done. |

Both versions' initial installs exited 0 in both runs and requested no foreign
optional tarball. The scratch `pnpm-repro` tree retains its explanation,
`results.json`, timestamped `requests.json`, initial locks and full command logs;
the loopback servers closed afterward. A preliminary unsupported
`pnpm remove --ignore-scripts` helper invocation was corrected by setting the
fixture configuration instead, retained separately, and excluded from this
result. The old timed-out child is not counted as a naturally exiting process.

This reproduces the known previous-graph/late-work failure family and shows the
fixed version avoids that path. It does **not** capture the exact late-worker
timeline of the original DSH subprocess, or isolate the contribution of these
two patches from every other change between 11.22 and 11.26. At that stage the
fixture mechanism alone was not promoted to a confirmed root cause of the
original occurrence; the next natural-call phase isolates individual upstream
patches rather than relying on this version comparison.

### Effective-command validation in the original isolated Home

The later keyless Host comparison reused the original isolated activity Home
after its earlier stop/cleanup/reinstallation; it was not a replay of an intact
stalled process. Before accepting fixed-version evidence, the tester inspected
the actual manager fields: `pnpmCommand` was the absolute scratch-local
`pnpm-fixed/node_modules/.bin/pnpm` executable, `idleTimeoutMs` was **15,000**, and
no provider credential was supplied. See
`fixed-pnpm-validated-diagnostics.json`.

- `validated-fixed-pnpm-bridge.json`: removal returned `application: applied`,
  actual pnpm exit 0, in **3,849 ms**; captured stdout identified **pnpm 11.26.0**.
- `validated-fixed-pnpm-jot.json`: removal returned applied/exit 0 in
  **2,677 ms**; stdout likewise identified **11.26.0**. Neither call reached its
  configured idle bound.

The earlier files `fixed-pnpm-activity-bridge.json` and
`fixed-pnpm-activity-jot.json` are **excluded from fixed-version comparison**.
Their initial override-map configuration did not take effect: actual diagnostics
still showed command `pnpm` and the default **600,000 ms** idle limit, so their
successful results used the existing 11.22 tool. This is recorded in
`fixed-pnpm-first-attempt-note.json`, not relabeled as a successful 11.26 control.

During this phase the global pnpm remained **11.22.0**; only the isolated diagnostic Host used the
scratch copy. That Host stopped normally, and the official market's remaining
test-profile dependency/selection was cleaned through the offline CLI. The
phase's `final-cleanup.json` recorded no extra dependencies/selections and all
**14** then-listed test ports closed. Synthetic data, the dangling CLI link and
package-manager caches retain their earlier boundaries. Those early successful
controls were useful but did not by themselves isolate a particular upstream
change or recover the original subprocess timeline.

## Natural DSH causal controls and engineering attribution

The final verification used the actual official alpha.4 `removeBundle()` call
and the real three-package graph: Bridge 0.4.6, Jot 0.2.13 and the official
experimental market bundle. Each arm used a separate keyless reconstructed
Home, hoisted install/store/cache/configuration and the **same initial lockfile**
SHA-256 `5c42a63a294a7a2681b280734c0e210e8271c87f19d48c4f3c31dea99e33e578`.
These copies were rebuilt from the same configuration after the original
cleanup; they are not an immutable snapshot of the original stalled lockfile.
All runs were natural DSH operations, **without an artificial delay**, model
request or provider credential.

`pnpm-dsh-observation/instrument.mjs` adds matching trace hooks to private
copies of pnpm 11.22.0. The `13226-only` arm has one semantic change: remove
the upstream `workerPool = void 0` reset after `finishWorkers()`. The separate
`14141-only` arm applies only the upstream previous-hoisted-graph
`skipFetching` correction and retains the worker reset. These diagnostic
copies are not Bridge dependencies or changes to the user's tool installation.

| Natural DSH campaign | Package-manager arm | Actual result |
| --- | --- | --- |
| `observed-run.IH4go3` | Observed pnpm 11.22.0 baseline | Done printed, but the call exceeded its 20-second bound; canceled during normal diagnostic Host shutdown, **not a PASS**. |
| Same campaign and starting lock | `13226-only` | `application: applied`, pnpm exit 0 in **3,493 ms**. Foreign optional fetching still happened; late workers and the main process exited. |
| `observed-run.0fmD6b` | Observed pnpm 11.22.0 baseline | The same natural late-worker failure repeated and reached the 20-second bound; **not a PASS**. |
| Same campaign and starting lock | `13226-only` | Applied/exit 0 in **4,650 ms**, retaining the finishing pool and draining the late work. |
| Same campaign and starting lock | Unmodified, uninstrumented pnpm 11.26.0 | The actual DSH manager returned applied/exit 0 in **3,043 ms**; the Bridge command was absent. |
| `observed-run.MKw2Q5`, same starting lock | `14141-only` on 11.22.0 | Applied/exit 0 in **2,041 ms**; **zero** foreign previous-graph fetches, downloads or extractions. The original two worker-reset calls remained. |
| Separate `pnpm-uninstrumented-control/observed-run.pj3nNh`, same starting lock | Unmodified, uninstrumented global pnpm 11.22.0 | Done printed in **322 ms**, but the real manager call still reached its 20-second bound; canceled through normal Host shutdown, **not a PASS**. No diagnostic environment flags or trace hooks were present. |

The first baseline trace captures the chain: a forced previous-hoisted-graph
walk fetches eight skipped foreign optional packages through asynchronous
store work; `finishWorkers()` drains and resets twice, and pnpm prints Done.
At **Done + 1,169 ms**, `addFilesFromTarball()` sees `hasPool:false` for the
Darwin-x64 optional package, creates pool generation 2, and dispatches to worker
thread 11. Eight foreign extractions follow, with no subsequent finish for
that replacement pool before the bounded cancellation. These package/thread
details describe the observed replay, **not the original PID**.

With only #13226, the same eight foreign fetches/extractions remain, but the
finishing pool reference is retained: no generation 2 is created, and every
late worker plus the main process exits 0. With only #14141, the unnecessary
previous-graph fetching path is absent, so there is no late foreign extraction
to trigger the reset race. Both independently remove the failure in the actual
DSH manager flow without changing any plugin runtime code.

This closes the engineering attribution of the waiting symptom to pnpm
11.22.0's known late-worker shutdown mechanism. It does **not** retrospectively
recover the original PID 29791's exact optional-package/thread timeline or
reclassify its timed-out operation as applied. It does not prove that every
possible package-manager hang has this cause.

`pnpm-dsh-observation/verify.mjs` independently verifies all six arms and writes
`verified-summary.json`: effective manager commands matched the intended
executables, the initial locks matched, no controlled delay/model/key was
used, every diagnostic Host/owned pnpm child was gone and its port closed.
Bridge's command was already absent before the first pnpm output in every
arm, separating plugin disposal from the later package-manager wait. The
global 11.22.0 bundle still matched its original SHA-256; it was not upgraded.
All traces and helper scripts remain in scratch and are not package contents.

The separate uninstrumented 11.22.0 campaign is not part of the six-arm
`verified-summary.json` count. Its `campaign.json` records the same initial
lock, no `PNPM_DIAG_*` or `DSH_PNPM_*` environment, unchanged global bundle
SHA-256 before/after, normal shutdown cancellation, closed owned child/port,
and no use of the 30-second outer fallback. Bridge was already absent before
the first pnpm output. This reproduces the waiting symptom without trace
instrumentation, excluding those hooks as a necessary trigger; no late task
or thread identity is inferred from that uninstrumented control.

For actual installation/removal, check the **Host's actual pnpm executable**
and use **11.26.0 or later**, which includes both upstream fixes. A shell
`pnpm --version` alone does not prove which executable a packaged Host uses.
Do not start overlapping package operations while one is pending: let it settle
or stop the Host normally before offline CLI recovery, after saving pending
handoffs. Bridge does not add a pnpm dependency, patch the user's installation,
or automatically upgrade tools. Native alpha.4 Desktop remains uncertified.

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

Workshop install/remove links point to this scoped record. It retains the
historical failure, isolated causal controls, corrected-package-manager success
and offline cleanup; it does not certify every plugin mix or package-manager
version, and `hotReload: null` remains unchanged. Local acceptance and diagnosis
are complete; release/tag/npm/registry-install gates are recorded separately.
