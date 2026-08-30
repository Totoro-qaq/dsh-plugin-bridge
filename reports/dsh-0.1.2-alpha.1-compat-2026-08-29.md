# DSH 0.1.2 alpha compatibility validation

Date: 2026-08-29 (Asia/Shanghai)

## Scope

- Upstream tag: `dsh-v0.1.2-alpha.1`
- Upstream commit: `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- Bridge branch: `compat/dsh-0.1.2-alpha.1`
- Bridge base: `origin/main` at `09d701e1c66fdf32058beecf28f59dbbc3746625`
- Validation used an isolated `DSH_HOME`; no ordinary user session or profile was modified.

## Contract changes covered

- Select the legacy in-process `apiProxy` adapter when rc.2 provides it.
- Fall back to alpha's typed `sessionController`, `workspaceController`,
  `workspaceRegistry`, `agentPresets`, and `goals` services.
- Supply alpha's required client-minted `requestId` for `session.prompt`.
- Reconstruct Bridge session rows and model state from alpha projections.
- Preserve raw session history for Bridge folding and bounded pagination.
- Treat `code` and `ptc` as compatibility aliases without requiring either
  generation.
- Stop declaring the alpha-removed `@deepseek-ai/dsh-client-runtime` as a
  WebUI injection package; the official WebUI continues to provide `sessions`.

## TDD evidence

The initial compatibility tests failed for the intended reasons:

- no alpha Host adapter existed;
- the plugin still hard-required `apiProxy`;
- the WebUI manifest still named `dsh-client-runtime`;
- `code` did not resolve to alpha's `ptc`;
- a real Cordis Context rejected direct reads of an optional service that was
  not declared in `inject`.

After implementation and the runtime-discovered Cordis regression fix:

- focused compatibility/load tests passed;
- the full Bridge suite passed `164/164`;
- `npm run verify` passed build, typecheck, generated-lib drift, dataset checks,
  and packed-package smoke installation.

## Real alpha WebUI evidence

The alpha repository was installed with its frozen pnpm lock and built from
source. A packed local Bridge tarball was then added to an isolated Web profile.

Observed results:

- `/bridge --doctor`: `dsh-typed-controllers`, `13/13` required methods.
- `/bridge code` resolved the target to `ptc`.
- A live preview preserved the seeded facts `ORBIT-731`, port `7643`,
  `PostgreSQL`, `src/alpha.ts`, and the `MongoDB` prohibition.
- Plain-text mode exposed named fields and list items without requiring Markdown.
- Editing the plain-text "Next steps" field changed the generated Markdown and
  preserved the other sections.
- At a `1200x853` viewport the active card was `624px` high; its panel was
  `476px` high with `664px` scroll content and computed `overflow-y: auto`.
  The `30px` toolbar containing tabs and confirmation actions stayed outside
  the scroll panel, and the page body had no horizontal or vertical overflow.
- Confirming created and automatically opened a target titled
  `ORBIT-731 兼容性测试会话 → ptc` under the official `PTC 模式`.
- The edited summary was present in the target kickoff. The target model
  accurately restated the current facts and stopped for confirmation.
- The migration goal was visible as paused after the kickoff.
- The source session remained separately selectable and unchanged.

The live run used three authorized model requests: one source-session seed, one
Bridge preview worker, and one target kickoff.

## Install and removal evidence

Installation from the packed tarball succeeded. Because the alpha release is
source-only and its official packages are workspace fallbacks rather than npm
artifacts, pnpm reported an informational missing peer warning for
`@deepseek-ai/cordis`; the composed source WebUI still booted the plugin and
passed the complete live flow above.

After `dsh plugin --profile web remove dsh-plugin-bridge`:

- the profile dependency was absent;
- the package link was absent;
- the profile patch contained no Bridge row;
- the restarted alpha WebUI had no `dsh-plugin-bridge` boot entry;
- the page contained zero `.dsh-bridge-card` elements;
- the fresh browser console contained zero errors and zero warnings.

The isolated test root, including its copied credential document and generated
sessions, was moved to the macOS Trash and then deleted after validation.

## Known observation

The source session was created by the alpha `headless` profile before being
opened by the Web profile. Its session-list row did not expose an
`agentPreset` projection, so Bridge doctor displayed the current preset as
unavailable. This did not affect history capture, preview, `code` to `ptc`
resolution, model execution, target creation, or target preset selection. A
Web-created target did display the official PTC identity correctly.
