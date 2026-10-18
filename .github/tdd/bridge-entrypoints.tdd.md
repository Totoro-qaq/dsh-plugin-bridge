# Bridge 0.5.0 entrypoint evidence

## Request and authority

The requested journeys are a low-frequency menu entry, a configurable shortcut
and natural-language preparation, preserving `/bridge`, editable previews,
explicit confirmation and other plugins. The menu must not replace or submit
an unrelated composer draft or its attachments. Publication is authorized only
after acceptance; native Desktop was verified separately from Web rather than
inferred from browser key events.

Baseline: Bridge 0.4.7, `6199772`. No RED/GREEN checkpoint commits were made
before these working-tree edits: parallel workers reserved commits for the
root owner. The executions below are real local evidence, not reachable Git
checkpoints. Do not manufacture test-first history after implementation.
Raw logs, drivers, credentials and disposable profiles stay outside the repo.

## Observed RED / GREEN

| Guarantee | Executed RED | Corresponding GREEN / limit |
| --- | --- | --- |
| Optional NL tool, strict arguments, Host-owned session, disposal | Initial 11 tests: 11 missing-factory/config failures | 13/13 after cancellation and concurrency regressions |
| Cancelled preparation cannot leave a late confirmable preview | 12 tests: 10 pass, 2 fail | Same assertions included in NL GREEN |
| Same-source command/NL concurrency creates one worker | 13 tests: 12 pass, 1 fail | 13/13 |
| Shared launcher, default-unbound shortcut, trusted result card | 16 tests: 2 existing pass, 14 intended missing-feature failures | 17/17 |
| Move the initial permanent header prototype into a native menu | 19 tests: 15 pass, 4 fail | 21/21; the header prototype is not the final UI |
| Bound long error messages and keep retry reachable | 9 tests: 8 pass, 1 CSS failure | 9/9 |
| Empty/loading conversations must explain why nothing can be handed off | 23 tests: 21 pass, 2 fail | 23/23, public per-session notice and zero command RPCs |
| Stable optional SDK declarations and honest NL token cost | Initial 5 tests: all fail | Original expanded contract target 6/6; workspace-menu SDK separately added with one missing-pin RED |
| Worker polling preserves cancellation and cleanup errors | Corrected 10-test suite replayed on isolated baseline: 0 pass, 10 fail, 0 cancelled | Combined NL/cleanup/typed/port regression 59/59 |
| Preserve provider failure when cleanup or cleanup-port creation also fails | Two separate one-test intended failures | Included in final assigned 200/200 server regression |
| Current conversation sidebar menu without duplicate commands | 27 tests: 23 pass, 4 missing-entry failures | 27/27 after public list-slot implementation |
| Missing old-Host menu primitive must not break neighbors | 12 tests: 11 pass, 1 undefined-component failure | 12/12 after rebuild; all hooks remain unconditional |
| Plain target selection, optional collapsed CLI help | One renderer test: missing disclosure | Same target passes for Chinese and English, retaining exact help and preview-command behavior |
| Release version and pinned fallback agree | `v0.5.0` rejected against 0.4.7; stale fallback assertion failed | Version check and fallback target pass after synchronization |
| NL review appears outside collapsed process details without replacing Tool logs | Five new projection tests: 5 intended failures | Official alpha.4 and rc.2 assembler/grouping targets each 5/5; matching call identity, partial windows, prepend, PTC metadata and scoped disposal covered |

The cleanup baseline replay occurred after the implementation was corrected,
against an isolated `git archive` snapshot. It proves the old implementation's
regression, not a pre-fix Git checkpoint. An earlier expanded fixture run had
six cancelled tests due to an unref'ed mock timeout; that run is not counted as
ten valid business failures. The helper was corrected before baseline replay.
The first help-disclosure GREEN attempt also caught an incorrect test
expectation: Chinese already intentionally omits `--lang` to retain auto
language detection. The test was aligned with that unchanged public builder;
no production command behavior was changed to satisfy it.

## Real QA changed the menu placement

The official rc.2 `CommandUiRuntime` filters argument-taking commands out of
the inline `+` menu before applying decorations. A nonempty retained draft
therefore hides Bridge. Removing its whole `input` declaration makes the row
appear but loses the client claim for `/bridge ptc`, `--doctor` and `--go`.
A zero-model check of the real SessionCommandController confirmed those
unclaimed lines enter the Agent inbox, not the command registry. An independent
input-trigger source cannot fix the `+` button, which selects its own fixed
`command` source.

The final primary button is the current sidebar conversation's `⋯` menu item.
It uses the public list slot, owns a unique ID, closes the menu and rechecks
the captured session before opening the original picker. The existing bare
command decoration remains useful where offered; inline `+` support with a
nonempty draft is not claimed. No private Host list or global input handler is
patched. Full command usage is available in a collapsed help disclosure.

## Local checks and limits

The first complete candidate run passed `npm test`: 396 total, 395 pass,
zero failures, one existing Windows-only skip. Its source coverage passed
96.29% lines, 84.72% branches and 93.08% functions with:

```sh
node --experimental-strip-types --experimental-test-coverage --test-coverage-include='src/*.ts' --test-coverage-exclude='src/client.tsx' --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 --test test/*.test.mjs
```

These are dated intermediate counts, not the final suite after UI QA fixes.
The source aggregate excludes the built TSX bundle, which renderer and public
runtime integration tests exercise separately. The assigned server regression
passed 200/200. Independent safety review initially passed 54/54; later menu,
notice and help targets passed 27/27. Final rebuilt totals, actual browser and
Desktop checks belong in the [version-specific acceptance record](../../docs/compatibility/dsh-0.2.1-rc.2-entrypoints-2026-10-18.md).

The final candidate full run passed **408 tests: 407 passed, zero failed, one
existing Windows-only skip**. Source coverage passed **96.36% lines, 84.94%
branches, 93.27% functions** with the command above. Typecheck, datasets,
80-file installed-package/import smoke and `release:check v0.5.0` passed.
The mechanical UI detector reported no findings. Original locked package
versions stayed unchanged; added SDKs are pinned development/optional peers,
not new runtime dependencies. These local checks alone do not establish native
keys, CI, merge or publication.

The same executable candidate C subsequently passed isolated official macOS
Desktop **0.2.1-rc.2** with bundled pnpm **11.28.5**: GUI installation, initially
unbound shortcut, B-to-M remapping and modal ownership, current-conversation
menu with an intact draft, one real natural-language tool call/worker, visible
Chinese review, and exact Text/Markdown-confirmed **1,519-character** handoff.
The created PTC target auto-opened, held the exact paused one-round goal and
completed one turn with no tools. Normal quits, installed restart with the
saved binding, GUI removal and post-removal restart passed. This is separate
observed native evidence, not a new claim of native IME/paste, account-login,
native toggle/disposal or arbitrary third-party plugin certification. The
version-specific acceptance record retains the target-wording limitation.

The final independent review additionally passed **66/66** entrypoint/NL/
cleanup and **214/214** existing migration/Host/plan/metadata targets, plus
typecheck and whitespace checks; no new P1/P2 issue was found. Workshop's exact
host/evidence metadata is updated to include the actually exercised rc.2;
the existing bounded engine and alpha.4 development pins are unchanged.
The documentation/metadata-only repack retained all 39 tested runtime files,
and the committed-build verification passed. CI, merge, Release, npm and
index readback remain separate post-commit gates.

The model tool shares the command's handler and pending-preview identity. It
accepts no session ID, summary, file, arbitrary command, confirmation or
continuation flag. Canonical tool data is not a confidentiality boundary: a
PTC program can read the full result. Only a human action submits reviewed
text through the original guarded command path.

Cancellation interrupts owned sleeps, polling and cancellable reads. Cleanup
uses an independent five-second read/poll budget, but Host write APIs have no
abort contract and remain fully awaited. This is not a universal five-second
unload guarantee. An aborted NL call can retain the original cancellation
message rather than detailed cleanup diagnostics; the retained worker guard
must not be mistaken for proof of successful cleanup.

Local tests, observed UI, native keys, PR/CI/merge, Release, npm provenance and
fresh registry installation, and market-index readback are separate gates.
