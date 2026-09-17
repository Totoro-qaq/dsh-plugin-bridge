# DSH 0.1.6-alpha.2 compatibility acceptance

Date: 2026-09-18 (Asia/Shanghai). **Bridge 0.3.7 release acceptance**. The runtime checks used the candidate built from `main` at `9ca4a24` (Bridge 0.3.6) plus the session-opening fix, before its package version was bumped from 0.3.6 to 0.3.7. These results do not apply to the registry 0.3.6 package.

The checks were credential-free. They exercise install, load, the migration command path through a summary file, the target session and paused goal, opening the target from the native card, live plugin disable and enable, and environment configuration. The model-backed preview was not re-run; see [Not covered](#not-covered).

## Upstream change

DSH went from `dsh-v0.1.6-alpha.1` (2026-09-15) to `dsh-v0.1.6-alpha.2` (2026-09-17, 887 commits). npm publishes it under the `alpha` tag. Bridge's `^0.1.6-alpha.1` peer term already matches it.

| Change | Effect on Bridge |
|---|---|
| Multi-instance Client Sessions removed `ISessions.open`, `openSubagent` and `clear`; navigation belongs to view owners | **Breaks Bridge 0.3.6.** The migration still succeeds, but the card's **Open target session** button shows `ctx.sessions.open is not a function` and the view stays on the source. The same call backs the automatic open after **Confirm migration**. Fixed in 0.3.7. |
| Plugins page with live enabling and disabling; Plugin Manager runtime unloading | Bridge unloads cleanly. Its command registration and client slot are bound to their Cordis fibers, and its style element is removed and restored exactly once. |
| V4 Flash and V4 Flash Vision Exp removed from the default model list | The `flash` tier already resolved to `deepseek-flash`, and `current` follows the session. The guide no longer recommends `deepseek-v4-flash-vision-exp` for image migration. |
| `dsh <profile>` launches a profile | `dsh web` and `dsh plugin --profile web add` still work. |
| Messages API endpoint fix; `session/writer-held` error | No Bridge change. |

Nineteen DSH packages were diffed between alpha.1 and alpha.2. Eight had identical declarations. The only removed or retyped declaration Bridge used was `ISessions.open`. The `conversation.chat.commandview` slot, `CommandRowProps`, `commands.execute`, `MarkdownText`, `JsonTree`, the client-module `dsh` block parsing, and the server services Bridge calls are unchanged in the ways Bridge relies on.

## The fix

- At click time the card reads the WebUI navigation service with `ctx.get('uiWorkspace')` and calls `openSession`. Cordis `ctx.get` reads the root service store without an inject entry and returns `undefined` when the service is absent.
- `uiWorkspace` is not added to the client inject list. Every Cordis inject entry is required, so hosts without the service would leave Bridge's client module pending.
- Hosts without the service, or whose `openSession` throws, fall back to `sessions.open`. A host with neither shows a localized error.
- The card still waits until the target appears in the browser's session list, because alpha.2 rejects sessions it has not listed. The wait stops when the client plugin unloads.
- On 0.1.5-alpha.2 through 0.1.6-alpha.1 the host already provides `uiWorkspace.openSession`, which calls `sessions.open` and closes the side panel, so Bridge now uses that official navigation there too.

Build and tests: SDK devDependencies pinned to `0.1.6-alpha.2`; typecheck of both halves; 184/184 tests, including unit tests of the navigation choice with a real Cordis fiber; generated `lib/` rebuilt and consistent. The client also typechecks against the 0.1.6-alpha.1 SDK.

## Live verification

Official npm DSH `0.1.6-alpha.2` and `0.1.6-alpha.1` in isolated homes, each with a seeded workspace and no credentials, driven by headless Chrome with a throwaway profile. The alpha.1 host was installed with exact overrides so that its DSH packages are 0.1.6-alpha.1, except seven packages published only at alpha.2. Migrations used `/bridge ptc --go --file <handoff>` with a synthetic five-section handoff.

| Check | Bridge 0.3.6 on alpha.2 | Candidate on alpha.2 | Candidate on alpha.1 |
|---|---|---|---|
| Migration command | Success; PTC target created | Success; PTC target created | Success; PTC target created |
| **Open target session** | Inline error `ctx.sessions.open is not a function`; view unchanged | Opened the target in about 0.55 s | Opened the target in about 0.57 s |
| Target state | — | Paused goal bar; kickoff handoff admitted | Paused goal bar; kickoff handoff admitted; goal phase `paused` |
| Page errors | None; the error appears only inside the card | None | None |

On alpha.1 the normal route is the host's `uiWorkspace.openSession`. Bridge's own `sessions.open` fallback was exercised in a simulated run that hid the service from Bridge; it also opened the target without errors.

Additional alpha.2 checks with the candidate:

- `DSH_BRIDGE_TIER=pro` in the server environment made `/bridge --doctor` report tier `pro`, and removing it restored `current`. Bridge's `cordis.patch.yml` environment values still apply under alpha.2's patch loading.
- One live disable and enable from the sidebar **插件** page: the Bridge style count went from 1 to 0 and back to 1, `/bridge` left and returned to the slash menu, `/bridge --doctor` worked after re-enabling, and no page errors appeared. With Bridge disabled, a typed `/bridge` line is sent to the model as an ordinary prompt; that is host behavior.
- The earlier alpha.2 smoke with the published 0.3.6 confirmed doctor 13/13, `ptc` still offered, a keyless preview failing closed, a clean install with no peer warnings, and clean live toggles by bundle and by component.

## Not covered

- No model request was made. The preview worker, native editing, **Confirm migration** with its automatic open, and target restatement were not re-run on alpha.2. **Confirm migration** uses the same open function as the verified button.
- Upgrading an existing Bridge install from the Plugins page was not tested. Plugin Manager reports that a package already in the profile needs a restart, so the README limits live application to a first install.
- A CLI install into a running alpha.2 server was not tested for live reload.

The isolated installs, homes and drivers stayed outside the repository.
