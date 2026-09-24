# DSH 0.1.7-rc.1 compatibility acceptance

Date: 2026-09-24 (Asia/Shanghai). This is a bounded compatibility check of the **published** `dsh-plugin-bridge@0.3.10` on official npm `@deepseek-ai/dsh@0.1.7-rc.1` (`next`), not a new Bridge release. The repository runtime and generated `lib/` were not changed.

## Environment boundary

- macOS, Node 22.23.1, pnpm 11.22.0, real headless Chrome, isolated DSH profiles. The daily DSH home and the earlier alpha.2 fixture were not upgraded.
- Registry connection resets stalled a default runtime install while fetching an optional LibreOffice kit. For this test, the official rc.1 package graph was installed without optional packages; the runtime-required `node-addon-require-builtin-darwin-arm64@0.1.6` binary was then installed into the isolated runtime. This **does not validate a default full-optional DSH installation**. No speech or vision model was downloaded.
- One fresh profile tested the registry Bridge installation and removal. A separate copy of an existing synthetic V4 source profile tested the model-backed handoff after upgrading its Bridge plugin from 0.3.9 to the published 0.3.10. No real user session was migrated.

## Observed checks

| Check | Result |
|---|---|
| Bridge registry install into a fresh rc.1 web profile | Passed without an incompatibility exemption |
| WebUI start and `/bridge --doctor` on the copied existing-session profile | Passed; typed-controller adapter 13/13 |
| Native `/bridge` card and `ptc` target picker on that existing session | Rendered; no observed page JavaScript errors |
| Model-backed preview on the copied synthetic source | One success; 24.06 s observed, not a latency benchmark |
| Explicit source no-tools/no-file clauses | Visible in the editable handoff |
| Text → Markdown → text, then `standard → ptc` with direct continuation | Edited Markdown sent exactly; target opened automatically |
| Target and source | Target replied `RESULT=385` without tool calls; goal `paused`, `roundsStarted=0`; source user/assistant content unchanged; worker archived and idle |
| 800×700 and 640×700 viewports | Confirmation button stayed in view and passed a delayed hit-test; no horizontal card overflow |
| Official CLI removal on the fresh profile, then WebUI restart | Package and dependency declaration absent; WebUI returned 200. A dangling `.bin/dsh-bridge` symlink remained with no target. |

The delayed viewport screenshots were inspected for gross layout failure, but this run has no committed pixel baseline and makes **no pixel-regression or WCAG conformance claim**. On the first empty session of the fresh profile, command RPCs returned successfully but a command row was not observed before opening a populated session; that blank-session UI behavior was not isolated against built-in commands, so this report claims native-card behavior only on an existing session. The unresolved-image route, other custom UIs, Windows, legacy directory presets, default installation with every optional DSH dependency, and statistical repeatability were not tested here.

## Conclusion

No Bridge runtime or npm package update is required for this tested rc.1 path. The README records the host-version evidence without claiming universal compatibility or zero disk residue after uninstall. `/bridge --doctor` checks method availability only; it does not replace a handoff test on each user's preset and UI combination.
