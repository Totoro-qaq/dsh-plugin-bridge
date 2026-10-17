# DSH 0.2.1-alpha.5 and bounded host admission

Date: 2026-10-17, Asia/Shanghai. Candidate: Bridge **0.4.7**.

Local and bounded official Host acceptance passed. PR/CI/merge, Release, npm
publication and registry installation remain separate gates; this source
record does not establish their later completion.

## Policy

The former exact alpha.1–alpha.4 installation list is replaced by
`>=0.2.1-alpha.1 <0.2.2-0`. The older
`>=0.1.0-rc.7 <0.2.0-0 || 0.2.0-rc.2` terms are preserved.
Admission covers later 0.2.1 prereleases and final 0.2.1, but excludes
0.2.2 prereleases and later versions. It is not a claim that every admitted
future version has already passed acceptance.

The official alpha.5 evaluator uses `includePrerelease: true`. A caret such as
`^0.2.1-alpha.1` would admit later 0.2.x prereleases under that rule, so this
release uses an explicit `<0.2.2-0` upper boundary instead.

README acceptance records and Workshop's exact named-host list remain distinct
from the installation range. New compatible 0.2.1 prereleases can receive a
documentation/acceptance update without forcing a new npm package merely to
append another alpha number. New code, dependency, packaging or genuine
compatibility fixes still require a release. A different version family is
reviewed before extending the boundary.

## Build baseline

The eight DSH development SDKs remain exactly `0.2.1-alpha.4`; Cordis remains
`4.0.5-alpha.2`. Runtime dependencies, peers, business `src/` and all 33 generated
`lib/` files are unchanged against starting main `6f9598095252f31817aab2d230de1e1ab6c7c097`.
A test-only semver **7.8.5** dependency exercises the exact version resolved
from the actual alpha.5 app-boot package. Frozen installation and actual
installed SDK assertions remain in the tests. No runtime semver dependency is added.

The isolated official alpha.5 npm runtime has the same Cordis
`~4.0.5-alpha.2` and Schemastery `~3.18.5-alpha.2` requirements and installed
versions as alpha.4. Its new model-label slot is not a Bridge requirement.

## TDD and local verification

User journeys were derived from this request: stop per-alpha admission-only
releases; retain every previously admitted host; keep actual acceptance separate;
and verify real alpha.5 behavior before publishing.

| Guarantee | Executed evidence |
| --- | --- |
| Alpha.5 and later 0.2.1 prereleases/final are admitted; next patch is excluded | `10df166` RED: 5 tests, 3 passed, 2 intended failures (old alpha.5 admission and missing named evidence). `9bbd31c` GREEN: range/Workshop/load targets passed 25/25. |
| Complete old admission remains included, not just selected examples | semver `subset(previousRange, newRange, { includePrerelease: true })` is true; `f888415` adds the assertion alongside both-flag boundary matrices. |
| README explains current admission separately from historical tests | `1e5d82a` RED: upstream-contract 15 tests, 14 passed and the new policy/report assertion failed. `7d8693e` GREEN: all 15 passed. |
| SDK and installed packages remain frozen to their verified baseline | Existing exact SDK, lockfile-root, installed-manifest, Cordis and nested Schemastery assertions pass; no SDK bump to alpha.5. |

`npm run verify` passed build, typecheck, generated `lib/` consistency, datasets
and **72-file** packed install/import smoke. Full suite: **345 tests, 344 passed,
zero failed, one existing Windows-only skip** on this macOS run. Source coverage
using `node --experimental-strip-types --test --experimental-test-coverage
--test-coverage-include='src/**' --test-reporter=spec test/*.test.mjs` passed the
same suite: **95.11% lines, 81.65% branches, 92.87% functions**. The browser client
is exercised as a built bundle and is not included in that source-only figure.

## Candidate identity

Host acceptance used a local 0.4.7 initial archive with the final admission and
SDK metadata but an in-progress report. SHA-256:
`0de0742fc28a3758c0ff13b3bec064bddea9ef493f9d297b233d37e4c6b46950`.
Documentation-only repacking is not relabeled as that tested archive; runtime
identity is established by all 33 `lib/` files and these key hashes:

- `index.js`: `c8acdce6148348ae7c97ca0f34e3d61bf96f0206da2f0de24f21e4311ec136b8`
- `client.js`: `90ea1c0b15aa8eebb4386d1c4e26a68aa8f4cb16c410f85c2399029c1dbc880a`
- `migrate.js`: `1cad9ec823bb01c5b865efd652d78d78f734fa5def77f0d735a9c17efde4c076`

## Official alpha.5 Web acceptance

The unmodified official npm **DSH 0.2.1-alpha.5** runtime installed the initial
candidate through its real `pluginManager`: `applied`, no warnings, enabled,
and no version exemptions. Doctor reported **13/13** through typed controllers.

| Check | Observed result |
| --- | --- |
| Real preview | CUA submitted `/bridge ptc --lang en` through the actual composer. One minimal worker produced a 1,231-character five-section handoff in about 15 seconds and was archived. |
| User review | The native Text fields were directly edited; Text → Markdown → Text → Markdown preserved the exact reviewed payload. The long Markdown editor had 758 px of content in a 358 px viewport with `overflowY: auto`; the confirmation button was within the viewport and its center hit-test matched. This is a normal-viewport check, not a new three-breakpoint visual baseline. |
| Exact migration | The real confirmation button automatically opened PTC. The 1,856-character reviewed text matched the target goal SHA-256 `e25f904b5cea2110f01c89971dbe59d7ffb550913d536f8c40647227ff275a85`, independently calculated from the UI editor. Kickoff contained that text exactly once. |
| Placement and safety | Confirmation reread the source's newly selected directory B, rather than retaining preview directory A. Target: one business turn/request, zero tool calls, zero inherited source events. Goal: paused, max rounds 1, rounds started 0. The response acknowledged once and waited. |
| Source boundary | No source model turn or tool call occurred. The original historical prefix stayed exact; normal command and working-directory lifecycle events are not described as an immutable whole log. |
| Toggle isolation | Disable and re-enable both returned `applied`; command discovery disappeared then doctor recovered to 13/13. Other bundle declarations remained exact; exemptions stayed empty. |
| Same-Home restart | Three session IDs, titles and directories were retained. Complete target events and exact paused-goal events matched. Original source prefix matched; the Host appended its known `agent/inbox/spliced` lifecycle event. |
| Removal/restart | Removal returned `applied`; the Bridge package/dependency/bundle/command were absent, as was the `.bin/dsh-bridge` entry. No manual shim cleanup was used. A further Host restart retained the three synthetic sessions and kept Bridge absent. |

The worker made **one business model request plus one Host automatic-title
request**; the target made one business request and no automatic-title request.
This is not a claim of only two total billable requests. No repeated preview or
target prompt was started to obtain a passing result.

## Representative old-host regression

Official **0.2.0-rc.2** and **0.2.1-alpha.4** Hosts each used a new isolated Home,
with no provider credentials or exemptions. Both passed actual candidate
installation, doctor 13/13, standard → PTC target creation, exact reviewed
objective, paused goal, title preservation, normal restart, live removal and
post-removal restart. Six Host processes exited 0 with closed ports. The actual
candidate adapter and `executeMigration({ kickoff: false })` were used: this
does not claim a keyless model preview or target reply.

On keyless alpha.4, source-model selection was unavailable; Bridge emitted its
documented default-model fallback. Goal content and paused state passed, but
model-selection transfer is not claimed for that run. Across old Host restarts,
original events stayed exact while the Host appended only its normal
`session/end-seed` event; whole files are not claimed byte-identical across
normal lifecycle transitions.

Initial scratch harness attempts assumed rc.2 had the newer `getOrigin()` and
projection `kind` APIs, and initially omitted its normal end-seed transition.
Those harness failures are retained separately, not counted as product defects
or passing attempts. Fresh corrected runs passed both matrices; failed fixtures'
owned packages and processes were cleaned up.

## Boundaries

All Host checks use isolated Homes and synthetic sessions. No Jot repository,
version, daily profile or user notes are changed. Test helpers, credentials,
auth URLs and full private transcripts are not committed. The alpha.5 install
reused the normal shared pnpm cache/store; this is profile isolation, not a claim
that every package cache was isolated. The first cache-setting attempt was not
effective under pnpm 11; it was removed before any subsequent package operation,
keeping the installed store consistent. No shared cache was deleted or repaired.

Unchanged business bytes do not establish arbitrary future compatibility.
Doctor checks capability availability, not the full semantic migration flow.
No new claim is made for every historical 0.1.x Host, changed-business-byte hot
replacement, native alpha.5 Desktop or physical Windows/Linux UI.

The prior alpha.4 pnpm late-worker failure and its attribution remain in the
[historical record](dsh-0.2.1-alpha.4-2026-10-16.md). This pass uses the existing
fixed pnpm 11.26.0 executable; it does not silently modify the installed Desktop
package manager or relabel the historical operation as passing.
