---
title: Moving an Agent Session Without Moving Its Tool History
published: false
description: A previewable, fixed-schema, fail-closed protocol for switching an agent to a different tool environment.
tags: ai, agents, opensource, typescript
---

I wanted to move a half-finished coding task from one agent preset to another without asking the new session to rediscover the project.

This is the result in the official DeepSeek Harness WebUI:

![A real session migration in the official DeepSeek Harness WebUI](https://raw.githubusercontent.com/Totoro-qaq/dsh-plugin-bridge/main/assets/bridge-demo.en.gif)

The source session knows five facts: port `43179`, SQLite, no Redis, a target file, and the next step. Bridge produces a reviewable handoff, opens a clean session under the `code` preset, and asks that session to restate the facts. It does not start implementation until the user confirms.

The interesting part is not the slash command. It is the boundary the command preserves.

## A preset is more than a personality

An agent preset usually combines a system prompt, tools, plugins, permissions, and execution policy. Once a session has used that composition, its history contains tool calls and results that only make sense under that exact environment.

Changing the preset in place looks cheap, but it creates an ambiguous history:

- a tool call may name a tool the new preset does not have;
- the same tool name may now have different semantics;
- old permission assumptions may no longer hold;
- the model sees a continuous transcript even though the executable environment changed underneath it.

DeepSeek Harness avoids this by locking the preset after a session starts. That constraint is useful. The safer migration primitive is not “unlock the preset.” It is “open a clean destination and carry only the state that is still actionable.”

History is environment-specific. State can be portable.

## Move state, not tool traces

Bridge turns the source conversation into a five-part contract:

```text
Goal
Current state
Key decisions and conventions
Key files
Next step
```

That schema is intentionally boring. It forces the handoff to answer the questions the destination needs before acting:

- What outcome are we pursuing?
- What has already happened?
- Which constraints are still in force?
- Which files carry the work?
- What is the next executable step?

Raw tool traces are omitted. Obsolete, revoked, or superseded concrete values are omitted too; only the currently effective replacement remains actionable.

This last rule came from a real failure. An earlier prompt preserved both an old port and the reason it had been replaced. The summary correctly called the old value obsolete, but it still exposed the literal number to future context. That was unnecessary surface area for a later model to misuse. The release gate now checks that obsolete values do not reappear.

## Preview is part of the protocol

Summarization is probabilistic, so a generated handoff should not immediately become an execution instruction.

Bridge separates the operation into two phases:

```text
/bridge code       # generate and preview; change nothing
/bridge code --go  # create the target from the reviewed preview
```

The preview makes numbers, paths, and negative constraints visible before any target session exists. It is also written to a file, so the user can edit it and execute that exact version:

```text
/bridge code --go --file <reviewed-summary-path>
```

This is more than a nicer confirmation dialog. It converts one opaque model step into a human-checkable interface. Ports, IDs, file paths, and “do not introduce X” constraints deserve that treatment because a fluent but slightly wrong summary is often more dangerous than an obvious failure.

## The destination must fail closed

Creating a clean target is not enough. Agent runtimes may have goal drivers that schedule work as soon as a goal changes.

The safe sequence is:

1. Create a blank target under the requested preset.
2. Store the reviewed handoff.
3. Pause the stored goal before sending the kickoff.
4. Send one prompt that asks the target to restate the current state.
5. Wait for user confirmation.

If the pause step fails, Bridge clears the goal when that route is available, cancels the target session, and sends no kickoff. A partially prepared migration must not turn into an autonomous run.

The default path deliberately spends one target turn on restatement. For lower latency, `--continue` combines restatement and the first useful work in the same target request:

```text
/bridge code --go --continue
```

Both paths pause the stored goal. “Continue” changes request shape; it does not enable a background loop.

## Images need a separate evidence path

Image history should not be treated like ordinary summary text.

If an assistant has already analyzed an image, Bridge copies the associated assistant response verbatim outside the compressed five-part summary. The summary worker cannot rewrite that evidence, and the text is admitted as a whole block rather than cut mid-description.

If the image has no associated analysis, it remains unresolved. On a host with durable attachment recovery, Bridge tries to move the original attachment and preserves the source model selection before kickoff. An image-capable destination can inspect it; a text-only destination receives an explicit fallback warning instead of silently pretending the image was understood.

This policy avoids two bad defaults:

- recompressing an existing visual description until details drift;
- resending every image and paying vision cost when authoritative text already exists.

It also avoids a hidden local vision model. The route is visible: either preserved text is reused, or the selected VLM receives the unresolved image.

## Cost is a request-shape decision, not a universal percentage

Installing Bridge adds zero prompt tokens to ordinary sessions. `/bridge` is handled by the host and only invokes a summary worker when migration is requested.

In the fixed 12-cell release acceptance, the default confirmation path always used two target requests to reach first useful work. `--continue` always used one. That request-count difference is stable.

Token percentages were not stable. Across six paired fixtures, the confirmation path's nominal extra cost had a median of `+8.1%`, but the range was `-47.9%` to `+206.7%`. Preset system prompts, output length, and cache state dominated individual totals. A single “Bridge costs X%” claim would be false precision.

The useful product choice is therefore explicit:

- choose the default when a separate accuracy checkpoint is worth one request;
- choose `--continue` when you accept a combined confirmation-and-work turn.

## What the release gate actually proves

The current text migration gate covers six frozen fixtures and 12 target sessions across `minimal`, `standard`, and `code` presets:

| Measure | Result |
|---|---:|
| Summary facts | 30/30 |
| Target restatement facts | 60/60 |
| First useful work facts | 60/60 |
| Obsolete-value resurrection | 0 |
| Confirm request count | 6/6 exact |
| Continue request count | 6/6 exact |

Three source fixtures contain 21 user messages and reuse real compaction output. A separate vision gate uses five non-guessable facts visible only in a PNG; both the verbatim-evidence path and unresolved-image path recovered 5/5 facts.

These are release gates, not population accuracy estimates. Each cell ran once, the suite was repair-driven, and the vision gate covers one PNG fixture and one experimental VLM route. The repository keeps the raw data and limitations next to the headline numbers rather than turning them into a universal reliability claim.

## Try the implementation

[dsh-plugin-bridge](https://github.com/Totoro-qaq/dsh-plugin-bridge) is open source and works directly in the official DeepSeek Harness WebUI.

```bash
dsh plugin --profile web add github:Totoro-qaq/dsh-plugin-bridge#v0.2.9
# restart dsh web once
```

Then run:

```text
/bridge --doctor
/bridge code
/bridge code --go
```

The repository includes the [full text migration report](https://github.com/Totoro-qaq/dsh-plugin-bridge/blob/main/reports/v0.2.3-e2e-report.md), the [vision migration report](https://github.com/Totoro-qaq/dsh-plugin-bridge/blob/main/reports/v0.2.6-rc11-vision-report.md), and raw evaluation artifacts.

The implementation is specific to DeepSeek Harness. The protocol is not: open a clean destination, carry a bounded state contract, expose it for review, stop on partial setup, and make the destination prove what it understood before it acts.
