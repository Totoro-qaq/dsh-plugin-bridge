# Bridge design and evidence

Bridge treats a preset as a complete tool-and-prompt assembly, not a style selector. A produced session therefore stays locked to the assembly that created its tool history. Migration opens a clean target session and carries a bounded state handoff instead of replaying incompatible calls.

## Migration contract

The handoff has five fixed sections:

1. Goal
2. Current state
3. Key decisions and conventions
4. Key files
5. Next step

The preview is a user-visible protocol step, not debug output. It is written to a file so numbers, paths, and decisions can be corrected before the target exists. Tool traces from the source preset are intentionally omitted.

```text
fold source history -> generate five-part handoff -> preview/edit
                    -> create clean target -> pause stored goal
                    -> inject handoff -> restate -> wait or continue
```

The source session is never rewritten. A failed or unsatisfactory target can be archived while the source remains available.

## Safety boundary

- Preview creates and archives a temporary summary worker, but does not mutate the source or create the target.
- Migration creates a blank target under the selected preset.
- A resumable goal may store the handoff, but Bridge pauses it before kickoff. Goal mutation alone does not inject model context, so the kickoff also contains the reviewed handoff.
- If goal pause fails, Bridge attempts the optional `goal.clear`, cancels the target, and sends no kickoff.
- `goalRounds` defaults to 1 as a second bound against an upstream autonomous goal loop.
- Installing Bridge adds no model tool, skill, or persistent prompt text. Ordinary sessions therefore receive zero Bridge prompt tokens.

## Confirmation and cost

The default flow favors verification: the target restates the handoff in one short request and waits. `--continue` asks the same target request to restate and begin the next step.

Across the fixed six-pair release acceptance, confirm used one more target request than `--continue`. Its nominal extra for summary plus first useful work had a paired median of **+8.1%** and a range of **-47.9% to +206.7%**. The summary worker represented **20.74%** of the clean acceptance components by nominal tokens. That share is composition, not causal overhead versus a no-Bridge baseline.

`Nominal = uncached input + output`. The processed sensitivity measure also counts cache reads and writes equally; it is not a bill. Preset size, response length, and cache state caused wide variation, so Bridge claims a stable request-shape difference rather than a universal saving percentage.

See the [release acceptance report](../reports/v0.2.3-e2e-report.md) and [raw JSON](../reports/v0.2.3-e2e-2026-08-20T13-19-13-924Z.raw.json).

## Image evidence policy

Image-derived information does not share the compressed-summary budget:

- If an image already has an associated assistant response, Bridge copies that response verbatim under `Visual evidence`. The summary worker cannot rewrite it, and the raw image is not resent by default.
- If no assistant response follows the image, Bridge marks it unresolved. On hosts with durable attachment recovery, it reads the original attachment and tries to include it in the target kickoff.
- Before kickoff, Bridge copies the source provider, model, and reasoning effort to the blank target. This prevents the summary worker or host default from silently replacing a vision route.
- A vision-capable target receives the raw image. A text-only target rejects it during prompt admission; Bridge then sends the text handoff with an explicit unresolved warning.

The normal summary is capped by `summaryCharBudget` (2,400 characters by default). Verbatim visual evidence has a separate 60,000-character budget and is admitted as complete blocks; an older block may be omitted with a warning, but is never cut mid-statement.

The rc.2 visual acceptance used facts visible only in a PNG. Existing visual evidence passed **5/5** without resending the image; the unresolved-image path passed **5/5** with one raw image sent to `deepseek-v4-flash-vision-exp`. See the [vision report](../reports/v0.2.6-rc11-vision-report.md).

## Accuracy evidence

The repair-driven release gate covered six frozen fixtures and twelve target sessions:

| Measure | Result |
|---|---:|
| Summary facts | 30/30 |
| Target restatement facts | 60/60 |
| First useful work facts | 60/60 |
| Critical facts | 90/90 |
| Obsolete-value resurrection | 0 |
| Exact confirm / continue request count | 6/6 / 6/6 |

This is a regression gate, not a population-level accuracy guarantee. Three sources reused real compaction material and three were short sources; targets covered minimal, standard, and code presets. The earlier compression-tier study remains in [benchmark.md](benchmark.md) with its sampling and scoring limitations.

## Why not switch in place?

Stored tool calls are valid only under the preset composition that produced them. DeepSeek Harness therefore permits `agentPreset.select` only while a session is blank. Bypassing that lock would leave ghost calls that the new tool set cannot execute. Bridge keeps the lock and transfers state to a clean target.

Model and reasoning-effort changes are separate from preset migration and may still happen within one session.

## Upstream coupling

Bridge deliberately uses a narrow host contract. `/bridge --doctor` checks thirteen required gateway methods and names missing methods after a Harness upgrade. Attachment recovery and `goal.clear` are optional enhancements and do not raise that baseline.

The server-side slash command remains the compatibility core. A native WebUI card is feasible but would depend on prerelease client-module and slot contracts; the current decision is documented in [native-webui-feasibility.md](native-webui-feasibility.md).
