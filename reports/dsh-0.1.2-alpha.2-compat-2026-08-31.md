# DSH 0.1.2-alpha.2 compatibility validation

Date: 2026-08-31 (Asia/Shanghai)

## Scope

- Official host: `@deepseek-ai/dsh@0.1.2-alpha.2` from the npm registry
- Upstream tag: `dsh-v0.1.2-alpha.2`
- Upstream commit: `0a53fb55bea101816fa226bb964ae2bed71c343b`
- Bridge branch: `codex/dsh-alpha2-compat`
- Packed Bridge SHA-256: `4170fc548ad4c9f77d70bc9e47cef92da849b4fa608a6b7cf323f4ad972cb085`
- All profiles, credentials copied for the run, sessions, packages, and browser state were isolated from the ordinary DSH home.

## Compatibility changes covered

- Accept alpha.2's `session/attachment-invalid` image rejection while retaining rc.2's `attachment-error` behavior.
- Remove the alpha-deleted `@deepseek-ai/dsh-client-runtime` peer, development import, and bundler external.
- Build against the split alpha.2 client contracts: API remotes/session controller, Chat command-row slot, renderer, Session UI, primitives, and slots.
- Provide alpha.2's required localized labels to `MarkdownText` and `JsonTree`.
- Add `ui-chat` to client injection so the package that owns `conversation.chat.commandview` is explicit rather than assumed from the official Web profile.
- Treat Cordis as a host-provided optional peer while retaining its supported version range.

## Automated evidence

- Focused old/new image fallback tests passed.
- Alpha manifest and split-client contract tests passed.
- `npm run verify` passed build, typecheck, 167 tests, generated-lib drift, dataset checks, and packed-package smoke installation.
- Source coverage: 93.58% lines, 78.10% branches, and 88.24% functions.

## Official npm install evidence

- The clean runtime reported DSH `0.1.2-alpha.2`.
- Plugin add completed without a peer warning after the Cordis metadata correction.
- `pnpm peers check`: no peer dependency issues.
- The profile contained the Bridge dependency and bundle layer, and `node_modules/dsh-plugin-bridge` resolved.

## Real WebUI evidence

- Native `/bridge --doctor`: `dsh-typed-controllers`, 13/13 required methods.
- `code` resolved to the official `ptc` preset.
- Preview preserved `ORBIT-A2-731`, port `7643`, `PostgreSQL`, `src/alpha.ts`, and the `MongoDB` prohibition.
- Preview, Text, and Markdown modes rendered. A Next-step edit in Text mode was the exact Next step delivered to the target.
- At 1200x853 the card panel scrolled internally; toolbar and confirmation actions stayed outside it; the document had no overflow.
- Confirm automatically opened the target under the official PTC mode.
- The target restated all five facts and stopped for confirmation.
- The target goal was visibly paused and contained the reviewed summary.
- The original source remained separately selectable and retained its original model conversation.

The run used three authorized model requests: source seed, preview worker, and target restatement.

## Removal evidence

After `dsh plugin --profile web remove dsh-plugin-bridge` and a WebUI restart:

- the profile dependency was absent;
- the bundle list contained only the official base and Web app;
- the Bridge package was absent from profile `node_modules` and lock/profile text;
- the browser loaded no Bridge client asset and contained zero `.dsh-bridge-card` nodes;
- the fresh browser console contained zero errors;
- historical command outcomes remained readable through the official generic command renderer.

## Known boundary

This run did not repeat a live raw-image/VLM transfer. Alpha.2's namespaced text-model image rejection is covered by deterministic migration regression tests; the earlier rc.2 vision report remains the live attachment-transfer evidence. Installation and removal still require one WebUI restart.
