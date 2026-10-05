# Native Desktop 0.2.0-rc.2 acceptance

[简体中文](desktop-0.2.0-rc.2-2026-10-05.zh-CN.md) | English

Verified 2026-10-05 (Asia/Shanghai) on the installed official macOS ARM64 Desktop 0.2.0-rc.2, Electron 44.0.0, bundled Host Node 24.18.1, and its bundled DSH 0.2.0-rc.2. The tested plugin is the **published npm Bridge 0.4.1**, not a newly published package. All 29 installed lib files match the release checkout.

## Isolation and proof level

An independent DSH Home, desktop Profile, Electron user-data directory and public synthetic workspace were used. No daily session was used as an input, and no local AI model was downloaded. Actual installation, editing, confirmation, plan approval, toggles, uninstall and quitting were performed through the native macOS controls. Runtime facts were independently checked in the concatenated-frame V4 logs and fixture files.

Native screenshots were limited to distorted Stage Manager thumbnails. A clear image taken separately from the **same Desktop Host's browser mirror** is not a native-window screenshot or a pixel/layout certification. Acceptance rests on native accessibility observations plus durable runtime/disk checks. Post-quit state was verified by process exit, not an AX query that may reopen the application.

## Installation and migration

- The official native Plugins page installed the exact package `dsh-plugin-bridge@0.4.1` from the npm registry and enabled it without a Host restart in this fresh Profile. This is not proof of restart-free upgrades or uncached first installation.
- A public source session replied normally with DeepSeek Flash / Low. `/bridge --doctor` rendered the native result and reported typed controllers, **13/13**.
- `/bridge ptc --lang zh` produced a rendered five-section preview in **17 seconds** in this one run. Native text editing added `DESK-EDIT-8126`; Markdown and rendered preview retained it.
- Native **Confirm migration** automatically opened a new PTC session. Its one kickoff contained the exact **455-character** edited summary; its goal was paused and retained that summary. The target preserved Harbor ledger, `DESK-021-7284`, `DESK-EDIT-8126` and total 385, then stopped waiting for confirmation.
- The target completed one turn with **zero tool calls**. The source's original V4 history prefix remained identical; two new command-audit events were appended, not a new model turn or rewritten source messages.

## Approved plan in a new session

- The official plan card exposed both the Host's original review controls and Bridge's **Approve in new session** action. The original **Request changes** action delegated normally; a model-written length error was corrected before approval. No proof file existed before the accepted plan.
- Clicking Bridge's action transferred the complete **2440-character** revised plan verbatim in the kickoff and automatically opened a new standard executor with the same model/workspace. The original planning turn ended as `aborted` by the user and retained plan mode; its previous history prefix was unchanged.
- The target did not enter plan mode, had a paused goal matching the Host's edge-trimmed plan, completed one turn, and ran `bash`, `read`, `write`, `read`, `bash` with **zero tool-result errors**.
- Independent bytes were exactly `NATIVE-PLAN-6072\n` (**17 bytes**); the README SHA-256 remained `af1376aabd51844fe635776124c1ce5afdefa05df62097afd329a96174999baf`. Those were the only two workspace files.
- One automatic provider retry occurred during the first planning request. The final executor completed; this record does not claim flawless provider availability or statistical reliability.

## Lifecycle and restart

- Live disable replaced Bridge's native cards with the Host's generic historical command rendering. Re-enable restored the cards and a newly executed doctor again reported 13/13. The four optional official switches stayed off throughout.
- The native UI uninstalled **the running plugin**. Package and dependency declaration disappeared, and the installed-plugin entry was absent.
- Cmd+Q exited normally with process code 0. The same isolated Home restarted successfully: all **six** prior session IDs/history prefixes and titles were preserved; the native Plugins page still showed no Bridge. The second Cmd+Q also exited with code 0.
- A dangling `node_modules/.bin/dsh-bridge` symlink remained. User-created sessions, goals, fixture files and historical command output intentionally remained. This is not zero-disk-trace uninstall, and no Host database was edited to remove records.

## Bounds

This tests the named macOS Desktop/runtime and published Bridge only. Account login/avatar issues, image transfer/fallback, arbitrary third-party UI/plugin combinations, native Windows/Linux, exhaustive keyboard/IME and pixel/accessibility certification were not re-tested. The new OMDSH manifest is a separate local proposal; these checks do not grant Workshop's old-baseline verification or Registry admission.

Sanitized durable check results are in [the acceptance receipt](desktop-0.2.0-rc.2-2026-10-05.json). Raw private instrumentation remains outside this repository; it is not an install dependency.
