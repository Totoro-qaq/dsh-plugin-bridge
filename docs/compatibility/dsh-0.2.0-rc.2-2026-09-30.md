# DSH 0.2.0-rc.2 compatibility acceptance

Completed: 2026-09-30 (Asia/Shanghai), following an initial run on September 29. The **published Bridge 0.3.10** passed the bounded migration and lifecycle checks below on official npm **DSH 0.2.0-rc.2**. No Bridge runtime change was required. Bridge **0.3.11** carries the support declaration and this record; the model-backed acceptance must not be misread as a fresh-registry test of 0.3.11.

## Versions and isolation

- Official `@deepseek-ai/dsh@0.2.0-rc.2`, release commit `639ed015397290b3745d163aafe02ffee4aa3f84`; macOS ARM64, Node 22.23.1, pnpm 11.22.0.
- Bridge 0.3.10 was installed from npm through the official plugin CLI without a compatibility exemption. Its installed server, client, compression and typed-adapter bundles matched the repository at `95cebda147eee0c92846f5c62d8abbfecd6008fb`.
- A temporary `DSH_HOME` and web profile received copies of two earlier **synthetic** V4 sessions. Their titles were retained after loading. The original fixture files' SHA-256 hashes were unchanged at the end. The daily Desktop profile was neither upgraded nor uninstalled.
- The host was started through official `runProfile`; commands used real `commands.execute` or the native WebUI controls. Model requests used the existing official API credential in process memory. Automatic title generation and telemetry were disabled in this test profile. No credential, local test driver or raw session dump is committed here.
- Network failures required installing the runtime with `--no-optional --ignore-scripts`, then supplying the required official ARM64 native packages and Sharp image libraries in that temporary runtime. This is **not a full default-optional installation test**. No speech, vision or other local AI model was downloaded. DSH still exposed the user's skill catalog to the model; the OS home was not sandboxed.

## Observed checks

| Check | Result |
|---|---|
| Official WebUI start and restored synthetic sessions | Passed; both prior titles visible |
| `/bridge --doctor` | Typed-controller adapter, **13/13**; `ptc`, `minimal`, `cordis` available |
| Real model-backed preview | Succeeded before and after the interrupted host run; workers archived and idle. The prior in-memory confirmation draft did not survive restart, so a fresh preview was generated |
| Text → Markdown → text | Reviewed marker retained; confirmed summary delivered exactly as edited |
| `standard → ptc`, direct continuation | Target auto-opened and returned `RESULT=385`; no target tool events, source user/assistant messages unchanged |
| `standard → minimal`, default waiting behavior | Supplied summary-file handoff acknowledged; target waited instead of computing the deferred result |
| Goal behavior across the four migration scenarios | Each target had one actual user kickoff, no inherited events, no tool events, goal `paused`, `roundsStarted=0`, and was idle at the final snapshot |
| Image-capable target | Official Flash received one real unresolved PNG and identified its test facts; no tool calls |
| Text-only target | Official Pro rejected raw image admission; Bridge emitted an explicit warning and sent a text fallback. Target received no image, acknowledged the unresolved image without guessing, and waited |
| Narrow-window editing | At actual content viewports **800×652** and **640×652**, the confirm button was in view and its center hit-test reached the button; no horizontal card overflow; preview content scrolled vertically |
| Live disable and enable | Disable removed the command and Bridge style; enable restored the style and doctor 13/13 |
| WebUI uninstall while enabled | Removed package, dependency declaration, bundle, command and Bridge style; other observed official plugin switches were unchanged |
| Restart after uninstall | WebUI booted, eight official entries remained and Bridge was absent; its command remained unregistered |

The viewport requests were 800×700 and 640×700; the in-app browser's toolbar left 652 pixels of content height. Native buttons and switches were activated through keyboard input because this browser automation surface showed a pointer offset. The DOM hit-tests and inspected screenshots establish bounded layout evidence, **not a pixel-regression or WCAG certification**.

The two PTC targets also contained host-generated runtime-context and skill-catalog messages. Those are not additional Bridge kickoffs: each target had exactly one `user/message` with `source.kind === "user"`.

## Known limits

- Uninstall still leaves a **dangling `node_modules/.bin/dsh-bridge` symlink**. Its target is gone and the plugin no longer loads, but this is not a zero-disk-trace uninstall. Bridge does not delete host-owned package-manager state itself.
- The browser retained connection/retry warnings around deliberate host stops and restarts; this record does not claim zero console errors over the entire run.
- These are fixed synthetic scenarios, not statistical reliability or latency guarantees. Default-optional installation, Windows, native Desktop login/avatar/quit behavior, empty-session card rendering, arbitrary custom presets and other third-party UI combinations are outside this acceptance.
- The typecheck retains the repository's existing 0.1.6-alpha.2 SDK baseline. The actual 0.2.0-rc.2 runtime was tested, but no new-SDK compilation claim is made.
- The temporary host was stopped normally after acceptance. The synthetic test home and detailed local evidence were retained outside the repository.

## Support declaration and release boundary

Bridge 0.3.11 declares:

```text
>=0.1.0-rc.7 <0.2.0-0 || 0.2.0-rc.2
```

The previous 0.1.x declaration is retained, and the exact tested 0.2.0-rc.2 is added. Other 0.2 prereleases, stable 0.2.0 and future minor versions are not newly admitted. The five optional DSH peer dependencies remain `"*"`. The official rc.2 installer evaluates DSH peer ranges rather than `engines.dsh`; the published 0.3.10 therefore installed successfully even though its support declaration excluded 0.2. Installation acceptance and tested compatibility are separate claims.

The existing manifest-contract test is updated to pin this declaration. Runtime source, generated `lib/`, dependencies, and the SDK baseline are unchanged. This record captures the completed 0.3.10 runtime acceptance; the 0.3.11 release additionally requires the normal `npm run verify`, Node 22/24 CI, CodeQL, tag/version check and post-publication registry-install smoke. Release-specific receipts belong with the release, not retroactively to the earlier model-backed run.
