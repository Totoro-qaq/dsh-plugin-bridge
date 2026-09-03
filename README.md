# dsh-plugin-bridge

<p align="center">
  <img src="./assets/cover/cover-en.png" width="100%" alt="dsh-plugin-bridge moves a locked session to a new preset through a previewable five-part handoff">
</p>

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![npm](https://img.shields.io/npm/v/dsh-plugin-bridge?color=cb3837)](https://www.npmjs.com/package/dsh-plugin-bridge)
[![ci](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node ≥22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![dsh rc.6 → 0.1.2-alpha.5](https://img.shields.io/badge/dsh-rc.6%20%E2%86%92%200.1.2--alpha.5-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![Listed in Awesome DSH Plugin](https://img.shields.io/badge/listed_in-Awesome_DSH_Plugin-2ea44f)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![dshfind](https://dshfind.com/api/badge/Totoro-qaq/dsh-plugin-bridge?lang=en)](https://dshfind.com/en/plugins/Totoro-qaq/dsh-plugin-bridge?ref=badge)

English | [中文](README.zh.md)

Halfway through a task and need another tool preset? Switching the produced session in place would leave tool history that belongs to the old assembly. Bridge previews a bounded five-part handoff, opens a clean target, and leaves the original session untouched.

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-demo.en.gif" width="880" alt="A real Bridge migration in the official DeepSeek Harness WebUI">
</p>

[Quick start](#quick-start) · [Why Bridge](#why-bridge) · [Evidence](#evidence-at-a-glance) · [Decisions](#migration-decisions) · [Compatibility](#compatibility)

## Quick start

Install from npm:

```bash
dsh plugin --profile web add dsh-plugin-bridge
# restart dsh web once
```

Pinned GitHub fallback:

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#v0.3.1
```

Then type in the official WebUI:

```text
/bridge                       list target presets
/bridge --doctor              check the host contract after a DSH upgrade
/bridge code                  preview the handoff; change nothing
/bridge code --go             migrate, restate, then wait
/bridge code --go --continue  restate and start work in the same target request
```

On DSH rc.7 and later, the official WebUI renders `/bridge` as a native card. **Text** exposes the fixed five sections as ordinary fields and flat bullet or ordered-list rows while preserving their Markdown markers; **Markdown** preserves full source freedom; **Preview** renders Markdown or a complete JSON tree. Long content scrolls inside the card while the action bar stays reachable. **Confirm migration** opens the created target session.

UIs that implement the official `conversation.chat.commandview` slot receive the same card automatically. Other custom UIs retain the complete server result, summary-file workflow, and target title/session-ID fallback; UI authors can reuse the framework-free `dsh-plugin-bridge/client-contract` export instead of reimplementing the wire. On an older or non-slot client, correct the printed summary file and run:

```text
/bridge code --go --file <path>
```

Preview edits are temporary until migration is confirmed. Restarting the client or system may discard them; the source session remains untouched, and you can regenerate the preview.

Uninstall with `dsh plugin --profile web remove dsh-plugin-bridge`, then restart `dsh web`.

## Why Bridge

| Promise | What it means |
|---|---|
| **Preview before execution** | `/bridge <preset>` creates no target and changes no source session. Review or edit the five-section handoff first. |
| **Move state, not tool traces** | Decisions, paths, current state, and next steps move to a clean preset. Incompatible calls from the old tool assembly do not. |
| **Fail closed** | The target goal is paused before kickoff. If that cannot be guaranteed, Bridge clears/cancels the target and sends no model request. |

Installing Bridge adds **zero prompt tokens** to ordinary sessions. It is a host slash command, not a model tool or skill.

## Evidence at a glance

The release gate is intentionally small and reproducible; these are regression results, not population guarantees.

| Gate | Result |
|---|---:|
| Five-part summary facts | **30/30** |
| Target restatement / first useful work facts | **60/60 · 60/60** |
| Critical facts / obsolete-value resurrection | **90/90 · 0** |
| Existing image evidence / unresolved raw image | **5/5 · 5/5** |
| Confirm / `--continue` target request shape | **2 · 1** to first useful work |
| Confirm extra, paired nominal median | **+8.1%** vs `--continue` |
| Summary worker share of clean acceptance components | **20.74% nominal** |
| Native WebUI repeat gate (preview / target facts) | **3/3 · 3/3**, five facts each |
| DSH 0.1.2 alpha.2 / alpha.3 / alpha.5 installed WebUI | **13/13 · ordered-list edit · PTC paused · image → text fallback** |

The token percentage varies widely with preset, response length, and cache state. The worker share is composition, not causal overhead versus no Bridge; the stable product claim is one additional confirmation request. Read the [design and evidence boundaries](docs/design.md), [full release report](reports/v0.2.3-e2e-report.md), and [vision report](reports/v0.2.6-rc11-vision-report.md).

## How it works

```text
fold history -> five-part handoff -> preview/edit -> clean target session
             -> pause stored goal -> inject -> restate -> wait or continue
image history -> verbatim assistant evidence; unresolved originals use the attachment gateway
```

The five sections are Goal, Current state, Key decisions and conventions, Key files, and Next step. The original session is never rewritten; archive the target and return to the source if the handoff is unsatisfactory.

## Migration decisions

| Situation | Bridge behavior | Cost / fidelity effect |
|---|---|---|
| Plugin installed, no `/bridge` call | No prompt injection or model tool | **0 Bridge prompt tokens** |
| `/bridge code` | One bounded summary worker; preview only | No target session is created |
| Default `--go` | Target restates and waits | One explicit confirmation request before useful work |
| `--go --continue` | Restate and work in one target request | Lower request count; no background goal round |
| Image already has assistant analysis | Copy that response verbatim | No raw image is resent by default |
| Image is unresolved and target accepts images | Copy the original attachment and preserve the source VLM | Vision pricing comes from the selected provider |
| Image is unresolved and target is text-only | Prompt admission rejects the image; Bridge sends a visible text fallback | No hidden local VLM and no silent claim of visual understanding |

## Compatibility

| DSH baseline | Server handoff | Native card | Verification boundary |
|---|---:|---:|---|
| 0.1.0-rc.6 | Yes | No | Narrow RPC contract and text compatibility tests |
| 0.1.0-rc.7 / rc.8 | Yes | Contract-checked | Client-module/command-slot contract plus server fallback |
| 0.1.1-rc.2 | Yes | Yes | Installed official WebUI: doctor 13/13, edit/confirm/auto-open, three-run repeat gate |
| 0.1.2-alpha.2 / alpha.3 / alpha.5 | Yes | Yes | Official DSH npm hosts: typed controllers 13/13 and PTC auto-open; the alpha.5 gate installed the branch tarball, retained alpha.3 titles, edited ordered lists, fell back from unresolved image to text, and removed cleanly |

CI covers Node.js 22 and 24. Run `/bridge --doctor` after every Harness upgrade; it names missing required gateway methods instead of failing vaguely.

Current limits:

- installation needs one WebUI restart;
- the native card auto-opens the created target through the official Session runtime; older clients still receive the title and session ID fallback;
- progress appears immediately while the worker runs; the current fixed three-run sample took 7.4–12.8 seconds of worker time, while `previewTimeoutMs` remains the hard bound;
- text-only models cannot inspect unresolved images;
- the native-card repeat gate is still only three fixed runs, so it is release evidence rather than a statistical guarantee.

The server command stays the compatibility core. The same package now adds an optional official client half for rendered editing and navigation; if that prerelease client contract fails to load, `/bridge` still returns the complete server result. See the [implementation boundary](docs/native-webui-feasibility.md).

## Documentation

- [Design, safety, image policy, cost, and evidence](docs/design.md)
- [Chinese install, configuration, rollback, and FAQ](docs/guide.zh.md)
- [Release acceptance report](reports/v0.2.3-e2e-report.md)
- [Vision migration report](reports/v0.2.6-rc11-vision-report.md)
- [Native WebUI repeat acceptance](reports/native-workbench-2026-08-25.md)
- [DSH 0.1.2-alpha.2 compatibility acceptance](reports/dsh-0.1.2-alpha.2-compat-2026-08-31.md)
- [Historical compression benchmark](docs/benchmark.md)

## Development

```bash
npm ci
npm run verify
```

`verify` builds and type-checks both plugin halves, runs 170 tests, checks generated `lib/` and datasets, then packs, installs, and imports the actual npm tarball. Tests spend no model tokens. `prepublishOnly` runs the same gate; GitHub releases also require the tag to match `package.json` before trusted npm publishing.

Community listings: [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) · [Awesome DeepSeek Harness](https://github.com/Dominic789654/awesome-deepseek-harness)

Ecosystem discovery: [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI). Bridge remains a standard DSH plugin; TUI/std conformance is tracked separately.

## License

MIT
