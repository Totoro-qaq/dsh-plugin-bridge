# DSH 0.1.2-alpha.2 compatibility — TDD evidence

## Source and user journeys

No plan file was supplied. The implementation derived these journeys from the upstream release and the requested immediate compatibility work:

1. As a Bridge user on DSH `0.1.2-alpha.2`, I can install the plugin from a packed npm artifact without stale or missing peer warnings.
2. As a user migrating an unresolved image to a text-only target, alpha.2's namespaced image rejection still falls back to one plain-text kickoff instead of an ambiguous-delivery warning.
3. As a WebUI user, the split alpha.2 client packages still provide the command-card slot, Session navigation, localized Markdown/JSON chrome, Text editing, and automatic target opening.
4. As an rc.2 user, the legacy `attachment-error` path and optional client dependency ranges continue to work.
5. As an operator, install and removal stay isolated, explicit, and free of Bridge package, bundle, client, or DOM residue after restart.

## RED to GREEN evidence

| Behavior | RED checkpoint and evidence | GREEN checkpoint and evidence |
|---|---|---|
| Namespaced image rejection | `b50391e`: the new test received `session/attachment-invalid` and observed the unsafe "delivery uncertain" branch instead of text fallback | `7ffa5b1`: both `attachment-error` and `session/attachment-invalid` accept the existing `MODEL_` / `IMAGE_` / `ATTACHMENT_` reason allowlist |
| Alpha peer and dev ranges | `f65f946`: manifest test showed every old DSH range rejected `0.1.2-alpha.2` and still named removed `dsh-client-runtime` | `04572a5`: four existing client packages plus `ui-chat` cover the validated alpha line; alpha.2 dev packages replace the removed runtime |
| Split client contracts | `npm run build` failed on missing `conversation.chat.commandview`, `ctx.sessions`, `ctx.slots`, and required primitive labels; `5e01a1d` pins the missing split-package surface | `04572a5`: official `CommandRowProps`, session-controller, renderer, ui-session, and localized Markdown/JSON labels compile against alpha.2 |
| Host-provided Cordis | `84791cd`: the real profile installed but `pnpm peers check` reported missing `@deepseek-ai/cordis` | `903ed6f`: Cordis remains versioned but optional because DSH supplies it through the composed bundle; a fresh install reported no peer issues |

## Automated guarantees

| Guarantee | Test or command | Result |
|---|---|---:|
| Old and alpha.2 image admission errors both produce a visible text fallback and exactly one fallback prompt | `test/migrate.test.mjs` | PASS |
| Removed runtime is absent; alpha.2 ranges, split type packages, and `ui-chat` injection are present | `test/load.test.mjs` | PASS |
| Alpha typed controller still exposes all thirteen required Bridge capabilities | `test/dsh-alpha-host.test.mjs` | PASS |
| Both host and client halves compile against the installed alpha.2 declarations | `npm run build && npm run typecheck` | PASS |
| Build drift, datasets, and packed-package installation/import remain clean | `npm run verify` | PASS, 167/167 |
| Source coverage | Node test coverage excluding generated `lib/` and tests | 93.58% lines, 78.10% branches, 88.24% functions |

The first in-sandbox `npm run verify` attempt could not bind `127.0.0.1` and failed nine CLI HTTP cases with `EPERM`. The identical command was rerun with local-loopback permission and passed 167/167; the permission failure is not counted as product evidence.

## Installed official-WebUI evidence

The 2026-08-31 gate used the official npm package `@deepseek-ai/dsh@0.1.2-alpha.2`, a fresh isolated DSH home, and packed Bridge SHA-256 `4170fc548ad4c9f77d70bc9e47cef92da849b4fa608a6b7cf323f4ad972cb085`.

- Fresh plugin installation added the dependency, bundle layer, and resolvable package; `pnpm peers check` reported no issues.
- `/bridge --doctor` rendered through the native card with `dsh-typed-controllers` and 13/13 required methods. It did not create a model turn.
- `/bridge code --tier pro --lang zh` resolved the compatibility alias to `ptc`, preserved all five fixed facts, and rendered Preview, Text, and Markdown modes.
- Editing only the plain-text Next step produced the reviewed Markdown used by the target kickoff.
- At 1200x853 the card was 625.68px high; the 476px panel had 664px scroll content with `overflow-y: auto`. The 30px toolbar and Confirm button stayed outside the panel, Confirm remained visible, and the document had no horizontal or vertical overflow.
- Confirmation automatically opened `ORBIT-A2-731 项目要点复述 → ptc` under the official PTC mode. The target restated the project code, port 7643, PostgreSQL, `src/alpha.ts`, and the MongoDB prohibition, then stopped.
- The target displayed a paused goal containing the reviewed Next step. The source remained separately selectable with its original user and assistant messages.
- Three authorized model requests were used: one source seed, one preview worker, and one target restatement.
- After removal and restart, the profile dependency and bundle row were absent, the package was not installed, Bridge client assets and `.dsh-bridge-card` both counted zero, and the fresh page had no console errors. Historical command records remained readable through the official generic fallback.

## Coverage and known gaps

- Branch coverage remains below 80% because legacy CLI/display and adapter error branches are integration-only; line and function coverage exceed 80%, and the changed old/new image-code branches are both exercised.
- This alpha.2 run did not repeat a live raw-image/VLM migration. The namespaced text-model rejection is covered deterministically; the earlier rc.2 report remains the live raw-image evidence.
- The source was created by the headless profile, so its Web session-list row did not expose an `agentPreset` projection and doctor displayed the current preset as unavailable. History capture, preview, `code` to `ptc`, target creation, card editing, navigation, and goal pause were unaffected.
- Alpha.2 still requires a WebUI restart after plugin add/remove. No hot-install or hot-remove claim is made.

## Merge evidence

If these checkpoints are squashed, preserve the RED/GREEN mapping, the 167/167 release gate, the npm-installed WebUI evidence, and the raw-image limitation in the PR or squash-commit body.
