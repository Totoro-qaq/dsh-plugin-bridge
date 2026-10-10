# DSH 0.2.1-alpha.2 candidate acceptance

Date: 2026-10-10, Asia/Shanghai. Tested official npm
`@deepseek-ai/dsh@0.2.1-alpha.2` on macOS ARM64 with Node 22.23.1.
This is an **uncommitted, unpublished working-tree candidate**, based on Bridge
`500ea6b` and still carrying package version `0.4.1`. It is not the published
npm 0.4.1 package. No commit, push, PR, tag or publication is covered here.

## Why code changes were needed

- DSH retains the original project in `header.cwd`, while the effective
  directory lives in the `workingDirectory` projection. Bridge now exposes
  this as optional semantic `SessionRow.currentCwd` in its adapters. It rereads
  the selected source immediately before each worker/target creation, including
  confirmation, approved-plan cancellation and retry. A changed cwd is sent
  alone; unchanged and legacy sessions retain workspace placement. Explicit
  invalid or unavailable current-directory metadata fails closed.
- A real worker started, but its two-message history tail cropped `turn/start`
  after alpha.2 supplied two user/context messages. The old detector cancelled
  that worker and incorrectly reported it had not started. Fresh execution
  events also count as startup now; queued text, stale events and a configuration
  `request/header` do not. Overall timeouts and provider-error handling remain.
- No new mandatory host capability, direct runtime dependency, storage layer,
  filesystem mutation, TTL or global-list polling was added. Doctor still
  checks the original 13 methods. The SDK build baseline is unchanged.

## Candidate bytes

Both plugins were packed from the isolated worktrees and installed together
through the official CLI. Loaded runtime hashes matched the corresponding
worktree files; no version exemptions were granted.

| File | SHA-256 |
| --- | --- |
| Bridge `lib/migrate.js` | `077b6e253936515ac75cc18d0b817d3a9bf6d3dd2e8f3868957e7b9e2be8eaac` |
| Bridge `lib/dsh-session-row.js` | `1752745ed86b2e0ec29b955d70ed6166a27dc6b9431ae3713ac374739afd2cee` |
| Bridge `lib/client.js` | `cfd3ff13e297888e68ccd6db79016bf0f57116980aa6ea499de8cfbcead46ade` |
| Jot `lib/client.js` | `058fd86c827ed4af7e4e1b210f1114456e05d670b11b19ffa4d0c33fdc3e97f3` |

Reusing a tarball filename initially caused pnpm to keep the old file dependency.
The final Bridge archive used a different source path; the installed migration
hash above was read back before the successful model-backed retry. Version
labels alone were not used to identify the tested code.

## Actual alpha.2 Web checks

| Check | Observed result |
| --- | --- |
| Install/startup | Fresh isolated official profile loads Bridge and Jot. Version exemptions are empty; doctor reports typed controllers, 13/13, PTC/minimal/cordis. |
| Worker startup | The failing real cropped-history trace is reproduced in regression tests. The rebuilt real worker starts and completes a five-part handoff; this sample took 56 seconds. |
| Changed-directory preview | Original project is directory O; source switches to A. The worker's original/current cwd is A, not O. |
| Confirmation freshness | After preview, source switches A → B. Real UI confirmation creates the PTC target in B, not the preview's A or original O. Source header.cwd remains O. |
| Edited handoff | Plain Next step editing supplies a public marker and 18 review-only lines. The exact **2,009-character** Markdown appears once in the kickoff; the paused goal equals its edge-trimmed text. Target makes zero tool calls. |
| Editor/navigation | Text → Markdown → Text → Markdown is byte-identical on a fresh 1,433-character card. Confirmation is visible and center-hit-testable at 1280 × 900. Real confirmation automatically opens the target. |
| Source preservation | Independent comparison confirms the source event prefix is unchanged. The deliberate directory switch and subsequent command append new events; no historical event is rewritten. |
| Native plan review | The official Approve/Request changes controls coexist with Bridge. After a pending plan's cwd switches, the real Bridge approval click creates a standard executor in the new directory. |
| Plan execution | The complete **643-character host-reviewed plan** appears once in the kickoff. Source stays in plan mode; target goal stays paused. Target writes, reads and byte-checks `proof.txt`: exactly `ALPHA2_BRIDGE_OK` plus LF, **17 bytes**. Independent disk comparison agrees; original directory has no proof file. Turn completes; tool errors: zero. A provider retry occurred before successful completion. |
| Co-installed plugins | Bridge disable/enable removes/restores its client contribution and command. Its own stylesheet count is 1 → 0; SHA-256 multisets of all other styles are unchanged. Jot stays visible and its authenticated API returns 200. Doctor returns to 13/13 on enable. |
| Removal/restart | Removing Bridge leaves Jot working. Removing Jot removes its routes, navigation and six optional tools; the API returns 404. Restart loads the official WebUI, preserves eight synthetic sessions and the edited Jot note/attachment, and has no Bridge command or styles. |
| Worker retirement | The completed preview worker is in the durable Workspace Registry archive set. An interrupted initial worker remains a retained synthetic session; zero historical-log deletion is not claimed. |

Tests use synthetic workspaces and notes under a separate DSH Home. The
previously authorized DeepSeek test key is loaded only in process memory; it
was not found in the top-level QA artifacts. No production conversation,
daily profile, installed app or local AI model was replaced.

## Backward and Desktop boundaries

- Official **alpha.1 Web**: separate fresh profile installs both candidates,
  starts, reports doctor 13/13 with no exemptions, and serves Jot's authenticated
  state with AI access off. This is an install/API/command smoke, not a repeated
  full alpha.1 model/UI run.
- Official **macOS Desktop 0.2.0-rc.2**: separate Desktop Home and Electron user
  data; candidates install through the app's carrier CLI. Its actual renderer
  displays doctor 13/13 and a small real model acknowledgment. Jot note editing,
  task Save, table/attachment rendering, attachment bytes and legacy code sizes
  pass. Both packages are removed; notes/attachments and the synthetic session
  remain. After a normal application-menu Quit (exit 0), the same fresh Electron
  user-data directory and Desktop Home restart with a visible native window and
  no Jot entry. No fresh Desktop migration or plan-execution pass is claimed.
- A signal-driven test teardown was force-killed by the runner after a
  `Host is stopping` task-inspection warning. The first interrupted Electron
  cache relaunch had no window/host. Reusing the **same Desktop Home** with fresh
  Electron user data, then normal menu Quit/restart, passed. This is retained
  as a test/native shutdown limitation, not evidence that the user's earlier
  freeze or account-avatar problem was reproduced or fixed.
- The official ARM64 desktop update feed still declared rc.2 on this date.
  Alpha.2 Web acceptance is not native alpha.2 Desktop certification.
- Image transfer/text fallback, Windows/Linux native execution, arbitrary
  third-party UI combinations and full accessibility/visual regression were not
  freshly accepted in this run. Existing automated regressions remain distinct.
- pnpm peer-check reports missing SDK/React peers in the profile-only dependency
  tree; the official installation fallback provides these host packages. This
  is not a claim that the profile is independently peer-complete. Required
  official ARM64 native packages were supplied; full optional-component
  provisioning was not tested.
- Removal retains an observed dangling `.bin/dsh-bridge` symlink and package
  manager caches. User-created notes, attachments, exports and host logs are
  intentionally retained; uninstall is not a zero-disk-trace operation.

## Local quality gate

Final `npm run verify` passes build, typecheck, **280/280 tests**, generated
runtime consistency, datasets and tarball smoke. The changed runtime modules'
scoped coverage is 95.91% lines / 81.50% branches / 88.24% functions; this is not
whole-product UI coverage. Generated files were staged for worktree-versus-index
`build:check`; they remain different from HEAD. No checkpoint commit was made.
Independent code/security reviews found no blocker; exact RED/GREEN traces and
negative startup/error tests are in [the TDD receipt](../../.github/tdd/dsh-0.2.1-alpha.2-current-cwd.md).

Sources: [upstream release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2),
[working-directory contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/session/working-directory/README.zh.md),
[official desktop feed](https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml).
