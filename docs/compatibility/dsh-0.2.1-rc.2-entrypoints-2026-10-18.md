# Bridge 0.5.0 entrypoints: candidate acceptance

Date: 2026-10-18, Asia/Shanghai. **Isolated Web, native macOS Desktop and
keyless old-Host acceptance passed.**
This is candidate runtime evidence, not proof of merge, a Release,
npm publication, registry package identity or a market-index update.

## Isolated official Web Host

The unmodified official npm DSH **0.2.1-rc.2** Host and Desktop-bundled pnpm
**11.28.5** use a disposable Home and synthetic conversations. No Jot repository,
notes, daily plugin declaration or daily Desktop window is modified. Model
calls use the explicitly authorized existing key in memory; no credential is
written into the package or this report. Formal model tests use only the
campaign-owned workspace. An initial Host-default workspace registration was
replaced before model testing; original project content was not used.

## Observed intermediate candidate checks

- Real plugin-manager installation applied without warnings or compatibility
  exemptions. All **37 installed runtime/declaration files** matched their
  corresponding local build; doctor reported **13/13**. An independently owned
  sentinel command, tool, card, stylesheet and shortcut stayed available.
- Empty-conversation menu activation displayed a Chinese explanation rather
  than silently appending an invisible command card.
- Host shortcut settings showed Bridge unbound. A reviewed test binding
  opened the target picker with the draft and pending TXT attachment intact.
  Remapping stopped the old binding and activated the new one. A neighboring
  sentinel binding/counter still worked; settings and a non-conversation panel
  retained keyboard ownership. Source history contained neither draft marker
  nor attachment content and had no extra model request for those actions.
- A real Chinese model request selected `bridge_prepare` once. One minimal
  worker generated a preview and was archived. The source turn concluded with
  no target created; tool replay and typed contracts are separate unit checks.
- The actual Text/Markdown roundtrip retained **1,652 reviewed characters**
  exactly. A long text field had 1,027 px of content in a 90 px client area and
  `overflowY: auto`. The confirm button's center hit-test succeeded within the
  tested viewport. No new responsive/pixel baseline or WCAG certification is
  claimed.
- Only the explicit confirmation created a PTC target and opened it. Its goal
  objective equaled the exact reviewed payload, SHA-256
  `e886cce7ff3c33885b68dfbd715191b1f3e4112073113145dfc4fa0b940f00ac`.
  The goal was paused, maximum rounds 1, rounds started 0. The target made one
  business model request, no automatic-title request and no tool call, then
  waited. Source and worker each also made a Host automatic-title request;
  these are not described as zero additional billable requests.
- A separate real inflight worker was observed running after a model request
  header, then cancelled. It stopped with an aborted turn and was durably
  archived; source events stayed exact, only that worker was created, no target
  or late successful result appeared, and the sentinel tool still executed.
  This intermediate check proves cancellation; final inflight disposal was
  tested separately below.
- The first live replacement returned normally and removed `.bin/dsh-bridge`
  according to `lstat`; no manual shim cleanup was used. Final candidate
  uninstall/restart was tested separately below.

The first installed archive SHA-256 was
`7f37ee16f7071b5f3b8d8d2714c0bcd66d7f24f1a4a5f772acaf28d1ce09377f`.
The empty-session-guard candidate was
`bcd93848fa5fb49f20422d357b2005613b4b18ee1d2d3b6c674abfec6cb15c84`.
Neither is relabeled as the later menu/presentation build. These observations
must be mapped to final runtime identity before publication.

## Issues found by actual UI acceptance

1. DSH hides argument-taking commands from `+` with a nonempty draft. The
   primary low-frequency entry was moved to the current sidebar conversation's
   public `⋯` menu rather than deleting command arguments or patching the Host.
2. Natural-language tool previews initially lived inside two default-collapsed
   process layers. A separately owned public conversation projection now shows
   the review outside that process group without changing the user's collapse
   settings or fabricating human-command events. Actual Web and native Desktop
   checks below verified the final presentation.
3. Full CLI usage dominated the Chinese target-picker card. It is now optional
   collapsed help rather than the primary action; the final Chinese picker
   and native conversation menu were observed during acceptance.

## Final runtime candidate and completed checks

Final tested runtime candidate C is Bridge **0.5.0**, local archive SHA-256
`022d4d211cc08e42c6cdf9949a56d848a12c200b1c0f57b7fe8f73c4174c994d`.
Its 80-file package contains 39 `lib/` files; all installed runtime/declaration
bytes matched on both official Web Hosts and native Desktop. Tests, source
and dependency trees are not packed. A subsequent documentation/metadata-only
repack was checked separately: its file set remained 80, and all 39 `lib/`
files were byte-identical to candidate C and the locked local build. Its
separate archive digest is retained with the external release evidence, not
substituted for candidate C's identity or embedded as a self-referential hash.
Registry readback remains a separate publication gate.

| Final check | Observed result |
| --- | --- |
| Current conversation `⋯` action | The actual Chinese menu contained one "迁移会话" item. Clicking closed the menu and opened the compact picker while preserving the exact unsent draft and pending TXT attachment. No draft/attachment content entered source history and no model request was added. CLI help was collapsed by default. |
| Directly visible NL review | A new real Chinese request invoked `bridge_prepare` once and created one summary worker. With the official process disclosure still collapsed, exactly one outer review/confirm card was visible without expanding tools. No migration target was created. Original Tool logs remained available; no human-command event was fabricated. |
| Inflight disposal | A separate worker was observed running after a request header, then Bridge was disabled directly through the real manager, without first cancelling the caller. Disposal returned applied after the worker stopped and was durably archived. The source history stayed exact, only the worker was created, no late successful preview appeared, and unrelated command/tool schemas stayed exact. |
| Client removal and restoration | While disabled, Bridge's menu, review projection, own styles and key handling disappeared; the sentinel shortcut/card/style still worked. Re-enable restored unique command/tool/client registrations, doctor 13/13 and the saved M binding. |
| Stale review authority | Clicking a pre-disable preview after re-enable produced the explicit invalid-preview error, not a target or a new model request. The durable display does not recreate lost in-memory confirmation authority. |
| Restart and removal | Two further same-Home keyless starts preserved 15 session IDs/titles, original source/target event prefixes and the exact paused target objective. Actual removal deleted the package/dependency/bundle/command/tool/client entry and `.bin/dsh-bridge` according to lstat; a post-removal restart kept them absent and the sentinel usable. No manual shim cleanup was used. |
| Process/credential cleanup | The Web campaign Hosts exited normally with their ports closed and temporary authorization files removed. A bounded exact-key scan of 334 Web-campaign plaintext files found no authorized-credential residue; dependency trees and generated binary assets were excluded. Test profiles and synthetic evidence are retained. Native process observations are recorded separately below. |

The initial cancellation path and final runtime have identical executable
server behavior; `command.js` differs only in its corrected header comment.
Candidate C additionally passed the actual inflight-disposal case above.
Nothing here certifies arbitrary third-party UIs or every plugin combination.

## Representative old-Host regression

Official **0.2.0-rc.2**, in a fresh isolated Home with no provider credential,
installed candidate C through the real manager using pnpm 11.28.5. All 39
`lib/` files matched; doctor 13/13, default-enabled `bridge_prepare({})`, trusted
top-level metadata and `concludesTurn` passed. That bare tool call produced a
picker only: no worker, target, model request or source-history change.
Sentinel coexistence, disable/re-enable, removal and post-removal restart
passed. Both owned Hosts exited 0 with closed ports. This is controller/package
acceptance, not old-Host native keyboard or model-backed preview acceptance.

The old ToolRuntime does not project metadata for nested PTC calls. Such logs
retain the `/bridge` fallback rather than being promoted to actionable review
nodes. Current rc.2 PTC metadata transport was checked with a zero-model public
runtime fixture; this is not a claim that a real PTC model selected the tool.

## Native macOS Desktop acceptance

After the user explicitly closed the daily DSH app, the unmodified official
**Desktop 0.2.1-rc.2** ran with its bundled **pnpm 11.28.5**, an independent
Home, independent Electron user-data directory and synthetic workspace.
The daily profile, notes and Jot installation were not used or modified.
These profile boundaries do not certify isolation of every OS-level crash-log
or protocol-registration setting. No new model or external testing service
was installed. The authorized model key remained in process memory, not in
the test profile's persistent credentials.

| Native check | Observed result |
| --- | --- |
| GUI installation and identity | Installed candidate C through the actual Plugins GUI. Its 80-file archive and all 39 installed `lib/` files matched the tested build. `/bridge --doctor` reported 13/13. |
| Configurable shortcut | Bridge initially had no binding. `Control+Option+Shift+B` opened the picker; changing the binding to `Control+Option+Shift+M` made the old key inert and the new key work. Settings retained modal ownership; the Bridge key did not act there. The Host's normal `Command+,` settings shortcut still worked. |
| Low-frequency menu | The current sidebar conversation's `⋯` menu contained “迁移会话”. Selecting it opened the localized target picker without submitting or replacing the unsent draft. This is not a claim that the inline `+` menu shows argument-taking commands with a nonempty draft. |
| Real natural-language preview | An English handoff request asked for a Chinese preview, invoked `bridge_prepare` once and created one summary worker. The Chinese review card was visible outside collapsed process details, with no target created before confirmation. |
| Review and exact confirmation | Text/Markdown round-tripping preserved the reviewed **1,519-character** payload, SHA-256 `40cbc371ebaf328531c12a15d9857c9364538e760ea311ebdebf35392c80179a`. The editor scrolled internally and the confirmation control remained reachable in the observed native window. Only the explicit click created the PTC target and opened it. Its goal objective matched that payload exactly, was paused, had maximum rounds 1 and rounds started 0. The target completed one turn with zero tool calls. |
| Installed restart | Normal `Command+Q` exited 0 with the owned Web port closed. Restarting the same independent profile preserved session titles, source/target event prefixes, the exact paused target objective and the saved M binding. |
| GUI removal and post-removal restart | The bundled pnpm completed removal in **192ms**. Package, dependency and bundle declarations were absent; `lstat` confirmed no `.bin/dsh-bridge` link, including no dangling link. Bridge's menu item disappeared and the saved M binding became inert while the ordinary conversation remained usable. A further same-profile restart retained the original PTC target/title and paused goal, showed no installed Bridge, and gave the old binding no new action. Normal `Command+Q` again exited 0 with the port closed. Across the native campaign, three business-state quits and one keyless welcome-screen quit exited 0. |

The keyless restart's welcome screen was expected: the test's environment-only
provider key had not been persisted as login or credentials. This does not
certify account login, avatar display or every startup state. The target model
also repeated an older “await confirmation” statement from the carried source;
the exact approved payload, correct new target and paused goal were verified,
but perfect target restatement wording is not claimed.

Native Chinese IME composition and clipboard/paste integration were not
separately exercised; the native-paste automation transport had a limitation.
IME and frame/modal rejection have contract coverage, not a native IME success
claim. Native disable/re-enable, approved-plan execution, images, narrow-screen
layouts, all other plugins, Windows and Linux were not re-certified here.
Web coexistence and inflight-disposal observations must not be relabeled as
native Desktop toggle/disposal tests.

After the owned native processes stopped, an exact-key scan of 470 campaign
plaintext files found no authorized-credential residue. Dependency trees and
generated binary assets were excluded; no oversize plaintext file was skipped.
Synthetic test profiles and evidence were retained rather than erased.

## Local verification and remaining gates

The final full suite passed **408 total / 407 passed / 0 failed / 1 existing
Windows-only skip**. Source coverage passed **96.36% lines / 84.94% branches /
93.27% functions**; the built TSX is covered separately by renderer/runtime
tests. Typecheck, datasets, installed-package/import smoke and the version
check passed. Independent reviews found no new P1/P2 issues. The added menu
primitive is guarded on older clients; optional services do not gate the
original slash command. No existing locked package version was upgraded.

- The independently rerun review targets passed **66/66** entrypoint/renderer/
  NL/cleanup tests and **214/214** existing command/migration/Host/plan/metadata
  regressions, plus typecheck and whitespace checks. Those local counts remain
  separate from CI.
- The final locked `npm run verify`, `release:check v0.5.0` and generated-`lib`
  synchronization checks passed, including the 80-file package smoke. The
  documentation/metadata-only repack retained the tested runtime bytes.
  PR/CI/merge, Release, npm registry/provenance/fresh install, and market-index
  readback remain separate publication gates rather than local-test claims.

See the [entrypoint protocol](../entrypoints.md) and
[TDD ledger](../../.github/tdd/bridge-entrypoints.tdd.md) for authority and
failure boundaries.
