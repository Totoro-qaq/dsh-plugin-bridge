# dsh-plugin-bridge

[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![ci](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/Totoro-qaq/dsh-plugin-bridge/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node ≥22](https://img.shields.io/badge/node-%E2%89%A522-339933)](package.json)
[![dsh 0.1.0-rc.6 · rc.7](https://img.shields.io/badge/dsh-0.1.0--rc.6%20%C2%B7%20rc.7-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)
[![presets](https://img.shields.io/badge/presets-standard%20%C2%B7%20code%20%C2%B7%20minimal%20%C2%B7%20cordis-4c8dff)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

> **Tried to switch presets mid-session and found the switch greyed out?** The lock is right (see below) — but it shouldn't be a dead end. This plugin is the exit: it **moves** a session across tool presets with a fixed-schema handoff summary instead of picking the official lock.

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-flow.en.svg" width="880" alt="Bridge flow: original session (preset locked) → compression worker → fixed 5-section summary → your preview → new preset session; the original stays untouched — click back to roll back">
</p>

## Why this exists

### The rule is right: the lock protects you, it is not a defect

A preset is not a "tone dial" — it is a whole assembly: system prompt + tool set + plugins. Every tool call in a session's history (bash, file reads, edits) is legal only under the assembly that produced it. Swap the assembly mid-session and the new one may lack the old tools — leaving "ghost calls" in the history that it cannot execute. A model that sees calls to tools it doesn't have will at best behave erratically, at worst try to invoke things that don't exist.

The official gateway hard-locks mid-session preset switching (`agent-preset-locked`), and upstream says so in as many words:

> The restriction to a produced-nothing agent is **a product rule, not a mechanical one**: swapping tools mid-conversation would leave logged tool calls the new composition cannot make.
>
> — [`packages/preset/agent-presets/README.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/preset/agent-presets/README.md)

`recompose()` could technically swap (unmount, then mount), and they chose not to after thinking it through. Because a swap wouldn't error; it would **silently degrade**: the session keeps running, quality quietly drops, and you never learn why. A hard lock is far more honest than silent degradation. The gateway's own comment on `agentPreset.select` puts the boundary exactly: *"Allowed only while the session is blank — no turn has run."*

The layering follows naturally: **model and thinking effort can switch mid-session** (swapping the "brain" doesn't invalidate history — that's exactly what `session.selectModel` does), **presets cannot** (swapping the "hands" breaks history). This plugin respects that layering exactly, in line with upstream.

### But a dead-end presentation makes it feel like a defect

The frustration doesn't come from the lock — it comes from **discovering it too late, with no exit once locked**: a static badge tells you "this road is closed" without saying what to do next. The rule shouldn't move; the missing piece is an exit.

### Bridge is that exit: move house, don't pick the lock

Compress the history → open a new session under the target preset → hand the fixed-schema summary over → the new session restates what it understood and continues. **The original session is never touched; rolling back is just clicking back to it** (branch, not rollback).

Lossless migration is impossible in principle, so the design settles for practically stable: lossy, but previewable, verifiable, and revertible. The full summary is shown and editable before anything happens, and nothing runs without your confirmation. The summary follows a fixed five-section schema (Goal / Current state / Key decisions & conventions / Key files / Next step), and the new session restates its understanding in the first turn, so missing facts are immediately visible. The original session is an immutable, read-only fact you can return to at any time.

## Installation

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#main
# restart dsh web to take effect
```

`dsh plugin add` puts this package on the profile's `dsh.profile.bundles` layer stack (this package declares `dsh.bundle.patch` in its package.json). `lib/` ships prebuilt in the repo, so git installs need **no** pnpm ≥10 `allowBuilds` entry.

> ⚠️ **Extra token cost**: each migration costs ≈ ~2K tokens to compress + ≤1K tokens to inject (roughly one more message's worth). Measured data in "Token cost" below.

Changed your mind? Uninstall any time:

```bash
dsh plugin --profile web remove dsh-plugin-bridge   # restart dsh web to take effect
```

## Usage: `/bridge`

Install, restart, type `/bridge code`. That is the whole thing.

```
/bridge                    what can this session migrate into?
/bridge code               build the handoff summary and show it — changes nothing
/bridge code --go          confirmed: create the new session and hand over
```

`/bridge` is an ordinary dsh slash command, registered the same way `/compact`, `/goal` and `/plan` are. The host routes it through the command registry — [it never reaches the model](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/host/apiproxy/src/api/sessions.ts), and its output is rendered by the UI rather than entering the conversation. That has three consequences worth stating plainly:

- **No prose, no luck.** The migration doesn't depend on the model deciding to help. It is code, dispatched by you.
- **Works under every preset**, including `minimal` — command dispatch has nothing to do with which tools a preset composes.
- **The original session really is untouched.** Not "we try not to write to it": the command result is not a message.

The engine is in-process. `@deepseek-ai/dsh-host-apiproxy` publishes the whole gateway as `ctx.apiProxy`, so the plugin creates the worker, reads history, and mounts the goal through direct service calls — no port, no `DSH_WEB_URL`, no shell.

The preview writes the summary to a file and prints the path. If something is wrong — a rounded port, a path that never existed — edit that file and run `/bridge code --go --file <path>`. **The file is the source of truth**, not the model's memory of it.

Options: `--tier flash|current|pro` · `--lang zh|en|auto` · `--goal-rounds N` · `--file <edited summary>`

### The CLI (manual / scripted path)

The same engine ships as a `dsh-bridge` binary for the cases a command can't cover — driving a migration from a terminal, scripting a batch, or reusing the orchestration in the evaluation harness. It talks to the gateway over loopback and reads `DSH_SESSION_ID` / `DSH_WEB_URL`.

```bash
dsh-bridge doctor
dsh-bridge preview --to code --session <id>
dsh-bridge migrate --to code --summary-file <path>
```

**TotoroPilot (GUI)**: the same pipeline lives in a BridgeModal — target-preset dropdown, compression tier, editable summary preview, cost estimate, one-click confirm. Here is a real migration recorded in TotoroPilot (isolated demo workspace):

<p align="center">
  <img src="https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-demo.en.gif" width="880" alt="A real bridge: a locked session opens the Bridge modal, a pro-tier worker generates the five-section summary, and after preview the new session takes over in PTC mode">
</p>

A full step-by-step guide: [docs/guide.zh.md](docs/guide.zh.md) (中文).

## Model Experience

**This plugin contributes nothing to the model's prompt.** No skill catalog entry, no tool schema, no system-prompt section. `/bridge` is dispatched by the UI to the command registry; the model never sees the command, its arguments, or its output.

**Token effect.** Zero until you migrate. A migration then costs ~2K tokens in a throwaway worker session plus the injected summary (≤900 tokens) in the new session. The session you migrate *from* accrues nothing.

**KV cache effect.** None. The prompt prefix of every session is untouched by this plugin's presence, so installing it cannot invalidate a warm cache. (The compression worker runs in a separate session and therefore also cannot *reuse* the source session's warm prefix — see "Known limitations".)

A model-facing tool is deliberately *not* registered. Migration is a human decision — the plugin's own principle is "no silent migration" — and a tool schema would cost prompt tokens in every session of every agent, whether or not anyone ever migrates.

## Token cost (measured, 2026-08-17)

A migration adds only two charges: the compression worker (~1.6K input / ~0.7K output) and the injected summary (≤1K tokens). About 2.4K tokens in total, roughly one extra message, and the original session accrues no further cost.

The evaluation (developer's view) burns your own tokens and is not in CI. Measured bills:

| Batch | Size | Uncached input | Cache-hit input | Output | Total |
|---|---|---|---|---|---|
| Full benchmark | 26 runs | 686K | 12.9M | 415K | ≈ 14.0M |
| A/B control | 8 runs | 266K | 5.1M | 112K | ≈ 5.5M |

93% of input hit the provider prompt cache (the planting and compression instructions are highly repetitive), so the billed cost is far below the headline numbers; cache hits are typically ~1/10 the uncached price — convert with your provider's rates.

## Accuracy (2026-08, 26 real runs; full data in [docs/benchmark.md](docs/benchmark.md))

| Metric | Test split T16 | Validation split V6 |
|---|---|---|
| Summary fidelity (facts in the worker summary) | 97.5% | 96.7% |
| **Probe usability (facts recallable after migration)** | **87.5%** (95% CI 78.5–93.1) | **83.3%** (66.4–92.7) |
| Schema compliance (five-section headers) | 100% | 100% |

By compression tier (test split, 8 runs each):

| Tier | Probe usability | Per-run spread | Worker cost |
|---|---|---|---|
| **pro (default)** | **95%** | mean 0.95, **sd 0.09** | ~2K tokens/run |
| flash | 80% | mean 0.80, **sd 0.32** — one total-loss run in 8 | nearly identical |

**Read this as a variance result, not a mean result.** The whole 15pp gap comes from a single flash run that scored 0/5; drop it and flash is at 0.91. At this sample size the difference in means is not significant (Fisher exact on fact-level counts, p = 0.087, and fact-level counts overstate precision because the 5 facts in one run are not independent). What the data *does* support is that flash has an order-of-magnitude wider spread at the same price, and that its failures are total rather than partial — `flash → minimal` wiped out 2 of 3 runs. That is the argument for keeping `pro` the default: not a better average, a missing tail.

More findings: **the source preset has zero effect on fidelity** (control group 4/4 at 5/5) — migration quality depends only on summary quality and target injection. Execution drift concentrates in "number rationalization" (ports completed to common values); paths barely drift. Failure modes are enumerated with mitigations (benchmark §7), and residual risk is absorbed by preview-confirm + the revertible original session.

## A/B: summary migration vs bare restart (2026-08, 4 paired runs)

Design: same fact planting (5 hard conventions), same probes and drift task; the **control arm** opens a new session carrying only the task title (the "restart under another preset" idea), the **treatment arm** runs the full bridge pipeline. Pro tier, code / minimal targets × 2 themes × 2 arms (`reports/ab-2026-08-17.raw.json`).

The result splits cleanly by whether the target preset has tools, and averaging the two hides the mechanism:

| Target | Arm | Probe usability | Conventions carried into execution |
|---|---|---|---|
| **code** (has tools) | bridge summary | 10/10 | 4/10 |
| **code** (has tools) | bare restart | 9/10 | 4/10 |
| **minimal** (no tools) | bridge summary | **9/10** | 6/10 |
| **minimal** (no tools) | bare restart | **2/10** | 0/10 |

- Into a **toolless** target, a bare restart is genuine amnesia — 1/5 per run. That is the honest baseline.
- Into a **tool-bearing** target, a bare restart scores about the same as the summary, but the mechanism is ugly: the agent fired 25+ tool calls in the first turn, digging the conventions back out of host session logs on disk (reproduce with `node eval/inspect-bare.mjs`). One such run burned 2.2M input tokens, hit the 240s turn cap, and still drifted on execution. It works only when tools exist, logs sit on disk, and the model feels like looking — that's luck, not a plan.
- So the summary's value is not "remembering better". It is **remembering at a fixed, budgetable cost under any preset**, instead of at whatever cost the target's tools happen to incur.

⚠️ **This A/B has two known weaknesses, both fixed for future runs but not re-measured yet.** The 2026-08-17 runs shared one workspace, which is exactly how the control arm could scavenge from disk; every run now gets an empty temp workspace. And with n = 4 pairs the comparison is directional, not conclusive. See [docs/benchmark.md](docs/benchmark.md) §10.

## Testing & verification

- `npm test` runs **95 tests**: compression behaviour (including *semantic* budget assertions — "when material is clipped, is the newest still there?"), the session-event folder, summary-schema contracts, **the `/bridge` command end-to-end**, the in-process `ctx.apiProxy` adapter, the full migration pipeline against a fake dsh host, and the CLI end-to-end (real process, real HTTP gateway, real wire envelope). None of it needs a live host or spends a token.
- `npm test` also typechecks `src/` **and** `eval/` — the evaluation harness imports the same modules the command does, so it cannot drift from the product path.
- CI additionally checks: `lib/` is in sync with `src/`, datasets parse, `npm pack` contents are complete, on Node 22 and 24.
- ⚠️ **Not yet verified against a live host.** Every RPC signature, the command-dispatch contract, and the `ctx.apiProxy` service shape were checked against upstream source, and the fake host implements that contract — but no one has yet typed `/bridge` into a running `dsh web`. Do that first; `dsh-bridge doctor` covers the same assumptions from the CLI side.

## Configuration

Set through the profile's `cordis.patch.yml`, or the `DSH_BRIDGE_*` environment variables it reads. Every key is actually consumed — in 0.1 none of them were.

| Key | Env | Default | Meaning |
|---|---|---|---|
| `modelTier` | `DSH_BRIDGE_TIER` | `pro` | Compression worker tier: `flash` / `current` / `pro` |
| `sourceCharBudget` | `DSH_BRIDGE_SOURCE_BUDGET` | `60000` | Material budget (≈30K tokens) |
| `summaryCharBudget` | `DSH_BRIDGE_SUMMARY_BUDGET` | `2400` | Summary budget (≈900 tokens) |
| `goalRounds` | `DSH_BRIDGE_GOAL_ROUNDS` | `1` | Autonomous goal rounds granted to the new session |
| `inject` | `DSH_BRIDGE_INJECT` | `both` | `goal` / `prompt` / `both` |
| `lang` | `DSH_BRIDGE_LANG` | `auto` | Summary language |
| `workerProvider` / `workerModel` | `DSH_BRIDGE_PROVIDER` / `_MODEL` | — | Pin the compression model instead of inferring it from the tier |
| `previewTimeoutMs` | `DSH_BRIDGE_PREVIEW_TIMEOUT` | `180000` | How long `/bridge <preset>` waits for the compression worker |

`goalRounds` deserves a note: upstream's `goal.create` defaults to **256** rounds, and `dsh-goal-round-driver` turns an active goal into `<goal_round>` prompts whenever the agent is idle. Injecting a handoff summary as a goal without capping that is handing the new session an autonomous loop. A handoff needs one round.

## Known limitations and deferred work

- **`/bridge <preset>` blocks while the compression worker runs** (typically 20–60s; capped by `previewTimeoutMs`). A command result is synchronous, so a very slow worker can outlast the client's RPC timeout — the migration engine is unaffected, and the CLI path has no such ceiling.
- **Requires `commands` and `apiProxy`.** Both are in the official `web` profile (base mounts the command registry, the web bundle mounts the API gateway). In a profile without them the plugin pends rather than half-mounting — loud, not silent.
- **The compression worker cannot reuse the original session's KV cache.** Upstream's own compaction backend replays the conversation prefix precisely so the auxiliary call is a real prefix of the last routed request; this plugin instead spins a separate worker session, whose prefix is unrelated. The measured cache hits are cross-run repetition of the instruction, not warm-prefix reuse. Doing this properly means calling `ctx.llm.stream()` in-process — deferred.
- **The material still double-counts what a compaction already summarized.** `session.history` reads the log, so both the checkpoint and the user messages it replaced are collected.
- **Structured output would be better than a markdown contract.** `ctx.subagents` supports a JSON schema per child (plus model, persona, and tool restriction), which would make "five sections" a type guarantee rather than a measured property. Deferred to keep this version verifiable against the shipped rc.
- **Accuracy numbers predate the 0.2 injection change.** They were measured with goal-only injection and no goal-round cap. The current default (summary in the first prompt *and* on the goal) can only make facts more reachable, but it has not been re-measured.
- **The benchmark never exercised a long session.** All 26 runs planted facts in a single message and migrated immediately: `truncated` was false in every run and no run reused a compaction checkpoint. The budget and clipping paths are covered by unit tests only.

## Running the evaluation yourself (burns your own tokens; not in CI)

```bash
# prerequisite: a local dsh web with model credentials configured
npm run eval                             # full 26 runs (~40-60 min)
BRIDGE_ONLY='电商' npm run eval           # subset by id substring
BRIDGE_ARM=guess node eval/run.mjs       # guess baseline: no planting, just probe
BRIDGE_ARM=all BRIDGE_TO='^(code|minimal)$' node eval/run.mjs 2
```

Read the guess-baseline arm first. Scoring is substring matching, so a fact the model can guess without any history inflates every arm equally; subtract that floor before reading any hit rate.

Datasets live in `datasets/` — PRs with new themes are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Engineering notes (learned the hard way)

- A cordis-preset session under open-ended prompts can enter long tool loops (a single turn >10 min); every eval turn has a watchdog that cancels on timeout — and killing the client process does **not** stop the host-side turn.
- The host RPC only archives (`workspace.archiveSession`), never deletes; physical deletion means stopping the host and cleaning `~/.dsh/sessions/`.
- `goal.create` does not put the objective in the model's context. Upstream is explicit: *"Goal mutations do not inject model context."* What makes a goal visible is the round driver rendering it, or the model calling `get_goal`. Anything that depends on a goal being *read* must not assume it is *seen*.

## License

MIT
