# Native Bridge workbench — TDD evidence

## Source and user journeys

No plan file was supplied. The journeys came from the requested product scope:

1. As a Bridge user, I see immediate progress while a preview worker runs instead of a silent 20–60 second wait.
2. As a Bridge user, I can read Markdown or a complete JSON document, edit the exact handoff, and confirm without maintaining a second WebUI.
3. As a Bridge user, I land in the created target session after confirmation while the source remains untouched and the target goal remains paused.
4. As a maintainer, I have repeated installed-WebUI release evidence and regenerated demos/docs that describe the current behavior.
5. As an older-client user, the server command, file editor, title, and session-ID fallback remain complete when the optional client half is unavailable.

## RED → GREEN evidence

| Behavior | RED checkpoint and evidence | GREEN checkpoint and evidence |
|---|---|---|
| Edited WebUI payload and pure card contract | `20742c4`: missing `src/client-contract.ts`, absent `recordInput: false`, and unknown `--summary64` produced the intended failures | `a0f4821`: parser, bounded base64url payload, host fail-closed validation, native bundle, and focused tests passed |
| Official client bundle delivery | `cf6225a`: package had no `dsh.client` declaration or self-registering bundle | `a0f4821`: generated `lib/client.js` self-registered with the official module table and occupied the command slot |
| rc.2 parent Remote guard | `9c9991d`: installed official WebUI failed with `cannot get property "remote" without inject` | `cd9cf6b`: both `remote` and `remote.commands` are declared; installed WebUI loaded |
| rc.2 command wire | `2e45901`: generated command Remote requires the image-array argument | `354013c`: native confirmation sends an explicit empty image batch |
| Running-state language | `2c6aa56`: private command input means `--lang` is unavailable before settlement | `ba7f501`: progress copy is short bilingual text; settled cards still follow the summary language |
| WebUI-locale running copy | `d3f5088`: unit and bundle assertions reject mixed running copy and require `en` / `zh-*` document-language mapping | `43ded74`: the running card reads the official `<html lang>` and renders one language only |
| Persisted-preview confirmation language | `7e804ee`: confirmation omitted `--lang`, so an English persisted preview could produce a Chinese kickoff after restart | `4208b11`: the edited confirmation command carries the card's explicit language |
| Untrusted command-output parsing | GitHub CodeQL check `97607559158`: two high-severity polynomial-regex alerts in preview/target parsing | Replaced both patterns with bounded `startsWith` / `indexOf` / `slice` scans and added a 120K-character adversarial regression fixture |

## Automated guarantees

| Guarantee | Test or gate | Result |
|---|---|---:|
| Chinese/English preview parsing removes transport chrome while retaining exact summary text, route, warnings, and stats | `test/client-contract.test.mjs` | PASS |
| Complete JSON is claimed by the JSON renderer; Markdown containing a JSON fence is not misclassified | `test/client-contract.test.mjs` | PASS |
| Edited summaries are bounded, base64url-safe, language-preserving, and contain no shell quoting | `test/client-contract.test.mjs` | PASS |
| Invalid or oversized WebUI payloads create no target and fail closed | `test/command.test.mjs` | PASS |
| Edited WebUI text becomes the goal's exact source of truth and is not written as command input | `test/command.test.mjs` | PASS |
| Package manifest, optional client graph, module-table wrapper, official primitives, parent Remote guard, and image wire are present | `test/load.test.mjs` | PASS |
| Built tarball contains both halves and the native acceptance report, installs, and imports | `npm run package:smoke` | PASS, 41 packed files |
| Full fake-host, CLI, contract, package, and dataset gate | `npm run verify` | PASS, 142/142 |

## Installed official-WebUI evidence

An isolated `@deepseek-ai/dsh@0.1.1-rc.2` profile loaded the locally packed tarball and exercised the real browser module graph.

- `/bridge --doctor`: 13/13.
- Immediate running card: visible with elapsed time and source-untouched copy, following the WebUI document language.
- Markdown: rendered with the official primitive.
- JSON: complete document rendered as the official expandable tree.
- Editing: `8118（用户在 WebUI 校对）` appeared exactly in the target goal and first target response.
- Navigation: target selected automatically after confirmation.
- Safety: target goal visibly paused; source remained selectable and unchanged.
- Repeat gate: three fixed real-model runs preserved 5/5 facts in preview and 5/5 in the target; worker time 7.421–12.846 seconds.
- Responsive check at 430×900: document `scrollWidth` equaled 430; card width 302 and editor width 272, with all controls reachable.
- English and Chinese demo recordings followed Discover → Rehearse → Record; both final GIFs were reviewed at progress, edit, confirm, target-open, and target-restated frames.

Detailed counters: [`reports/native-workbench-2026-08-25.md`](../../reports/native-workbench-2026-08-25.md).

## Coverage and known gaps

`node --experimental-strip-types --experimental-test-coverage --test-coverage-include='src/**/*.ts' --test test/*.test.mjs` passed with 93.92% lines, 77.08% branches, and 88.04% functions.

- Branch coverage remains below 80% because legacy CLI/display and adapter error branches are integration-only; this pre-existing repository-wide gap is not hidden.
- `src/client.tsx` is a browser-only React entry and is not executed by Node's coverage collector. Its user-visible branches were exercised in the installed official WebUI at wide and narrow sizes.
- The three-run paid gate is release evidence, not a statistical latency or reliability guarantee.

## Squash/merge evidence

The PR body must preserve the checkpoint mapping above if GitHub merges these commits with squash. No claim should collapse automated tests, installed-WebUI behavior, repeated model evidence, and generated visual assets into a single undifferentiated “tested” statement.
