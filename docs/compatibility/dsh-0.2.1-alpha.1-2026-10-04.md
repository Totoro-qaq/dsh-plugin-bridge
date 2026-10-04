# DSH 0.2.1-alpha.1 bounded compatibility acceptance

Date: 2026-10-04, Asia/Shanghai. Host: official npm `@deepseek-ai/dsh@0.2.1-alpha.1`; macOS ARM64, Node 22.23.1, pnpm 11.22.0. Plugin under the full model/UI tests: published npm `dsh-plugin-bridge@0.4.0`, unchanged. Bridge 0.4.1 updates its support declaration; it does not change server/client code, generated lib, dependencies or the SDK baseline.

All tests use an isolated DSH home and public synthetic workspaces. No existing user conversation or vault is modified. The official DeepSeek credential previously authorized for testing is held in process memory; no key is recorded here. No local AI model is downloaded.

## Upstream surface

The release removes runtime invariant entries, changes subpath metadata lookup and fixes plugin style teardown. Bridge ships no runtime invariant import and does not depend on separate client-subpath package metadata. Its public plan-review action, command view, typed host ports and WebUI navigation remain available.

## Verified behavior

| Gate | Evidence | Result |
| --- | --- | --- |
| Registry install and startup | Fresh official Web profile installs published Bridge 0.4.0 and starts with the existing configuration schema. | PASS |
| Semantic host surface | `/bridge --doctor` executes through the actual command service; typed controllers report 13/13, with PTC, minimal and cordis targets. | PASS |
| Model-backed preview | A standard source supplies synthetic context; the summary worker returns a rendered five-section handoff. | PASS |
| Text/Markdown editing | Edit the next-step plain field, toggle text → Markdown → text → Markdown; the Markdown is unchanged on the round-trip. Confirm button is visible and center-hit-testable at the default 1280 × 720 viewport. | PASS |
| Ordinary migration | A real UI confirmation automatically opens the PTC target. Its prompt and paused goal contain the exact 484-character edited handoff. One kickoff is admitted, source transcript prefix stays unchanged, target makes no tool calls. | PASS |
| Worker cleanup | The worker is stopped and is in the durable Workspace Registry archive set after a restart; raw Session listing may still include its retained log. | PASS |
| Native approved plan | Model submits `exit_plan_mode`; before approval the fixture file is absent. The original native approval and feedback controls coexist with Bridge's action. A real Bridge click stops the source planning turn and opens a new standard execution conversation. | PASS |
| Full-plan handoff and execution | The complete 2048-character plan is included in the one kickoff. The target creates `proof.txt`, reads it and checks its exact 18 bytes. Independent comparison agrees; README hash is unchanged, source remains in plan mode, target is out of plan mode and its handoff goal stays paused. Execution tool errors: zero. | PASS |
| Live disable and enable | Own stylesheet count is 1 → 0 → 1; hashes of all other styles on the Plugins surface stay unchanged. The command disappears while disabled and doctor returns to 13/13 after enabling. | PASS |
| Uninstall and restart | WebUI removal deletes the package and dependency declaration; the command is absent. Restart succeeds and preserves test conversations. | PASS with known disk residue |
| Browser errors | No console error is reported during the verified editor, navigation, plan-action and lifecycle flow. | PASS |

## Important boundaries

- DSH normalizes goal objectives by trimming edge whitespace. This sample's native plan has a trailing LF: the kickoff retains all 2048 characters, while the host goal stores 2047 characters. Internal plan content is unchanged. Goal normalization is not a Bridge summary rewrite.
- The initial worker summary used a broad no-environment-operation statement; the human editor explicitly restated tool/file/network prohibitions before confirming. This is not a new claim that every source constraint is automatically preserved by the existing narrow heuristic.
- Optional components were skipped and required official native ARM64 packages were supplied separately. Optional ripgrep search failed during planning; the model recovered through file read. The approved executor completed with zero tool errors. This is not full default-optional installation evidence.
- The package and dependency entry are removed, but pnpm/host removal still leaves a dangling `node_modules/.bin/dsh-bridge` symlink and package-manager metadata. This is not zero-disk-trace uninstall; retained host session logs and user-created files are intentional, not deleted by Bridge.
- Image transfer/text fallback, native Desktop, full responsive/a11y gates and arbitrary UI/plugin combinations were not re-run. Existing regression coverage remains in place, but it is not a fresh model-backed image acceptance claim.
- This run supports only the named alpha.1; it does not certify later alphas or stable DSH 0.2.0/0.2.1. Post-publication registry verification is reported separately in the Release receipt.

## Local/release gate

`npm run verify` covers build, typecheck, 234 tests, generated-artifact consistency, datasets and tarball install/import. The manifest loading target is RED before the declaration change (15 pass / 1 fail), then GREEN (16/16). No runtime coverage percentage is claimed for this metadata-only change. See the [TDD receipt](https://github.com/Totoro-qaq/dsh-plugin-bridge/blob/v0.4.1/.github/tdd/dsh-0.2.1-alpha.1.tdd.md).
