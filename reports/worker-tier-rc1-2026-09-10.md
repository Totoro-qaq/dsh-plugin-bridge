# Summary worker tier on DSH 0.1.5-rc.1

Date: 2026-09-10 (Asia/Shanghai). This report is why Bridge 0.3.5 changes the default `modelTier` from `pro` to `current`, so the summary worker uses the source conversation's own model.

## Why the default was `pro`

The [2026-08-17 benchmark](../docs/benchmark.md) compared `deepseek-v4-flash` with `deepseek-v4-pro` as the summary worker. The difference was not in the summaries: it came from probing the migrated target. Flash averaged 80% probe accuracy against 95% for pro, all of it from whole-run wipeouts. Two of three flash migrations into `minimal` lost every fact. `pro` became the default to remove that tail risk.

DSH 0.1.5-rc.1 adds `deepseek-flash` (DeepSeek-V41-Flash) and makes it the default model for new sessions. The same catalog still offers `deepseek-v4-flash` and `deepseek-v4-pro`. No earlier DSH release offers V4.1-Flash; 0.1.1-rc.2 through 0.1.5-alpha.1 list only `deepseek-v4-flash`, `deepseek-v4-pro` and `deepseek-v4-flash-vision-exp`.

## Environment

- Official npm `@deepseek-ai/dsh@0.1.5-rc.1`, isolated `DSH_HOME`, published Bridge 0.3.4, Node 22.23.1.
- WebUI driven by headless Google Chrome with a throwaway profile; the repository owner entered the DeepSeek key in the isolated WebUI.
- Sources: all five themes from `datasets/test.json` and `datasets/validation.json`. Each source received the dataset's plant message and then a port change that voids the original port, so stale values can be detected. The workspace held only a README, so targets could not read the dataset.
- Tiers resolved as `pro` → `deepseek-v4-pro`, `current` → `deepseek-flash` (the source model), `flash` → `deepseek-flash` (first flash-like id in the catalog). The worker receives provider and model only, so every worker ran at `high` reasoning effort even though the conversations used `max`.

## Summary layer: previews

24 previews, no target sessions. A fact counts when the summary contains the expected value, with the new port replacing the dataset's original port.

| Tier | Model | Runs | Facts | Stale port | Median worker model time | Median output tokens |
|---|---|---|---|---|---|---|
| `pro` | deepseek-v4-pro | 10/10 | 50/50 | 0 | 24.4 s | 1,622 |
| `current` | deepseek-flash | 10/10 | 50/50 | 0 | 12.7 s | 2,238 |
| `flash` | deepseek-flash | 4/4 | 20/20 | 0 | 11.7 s | 1,963 |

Every summary kept all five sections, stated the ban as a prohibition, copied the path exactly, and contained no unexpected numbers.

## Probe layer: migrations into `minimal`

This repeats the condition where the old flash failed. Each of the five themes was run twice. Within a source, `pro` and `current` each previewed and confirmed a migration into `minimal`, with alternating order between repetitions. The dataset's probe then asked the target five questions. Answers were scored from the saved replies, with 英文 accepted for `English` and Chinese for `中文`; the dataset's literal expectation otherwise marks the correct answer "提交信息使用英文" as a miss.

| Tier | Model | Migrations | Probe facts | Without the language fact | Wipeouts (≤ 1/5) | Old port in answer |
|---|---|---|---|---|---|---|
| `pro` | deepseek-v4-pro | 10/10 | 50/50 | 40/40 | 0 | 0 |
| `current` | deepseek-flash | 10/10 | 50/50 | 40/40 | 0 | 0 |

Paired by source: 0 wins, 10 ties, 0 losses.

## Reading the result

- On DSH 0.1.5-rc.1, following the conversation model gives the same measured accuracy as `pro` at about half the summary time, and the old flash-into-minimal wipeout did not occur.
- Both tiers scored 100%, so this set cannot show which model is better on harder material. Long or compacted sources were not tested for either tier.
- Zero failures in ten runs per tier lowers, but does not exclude, a rare wipeout.
- V4.1-Flash wrote more output tokens, up to 4,615 in one preview. Prices were not compared.
- On DSH before 0.1.5-rc.1, `current` usually means `deepseek-v4-flash`, the model behind the old wipeouts. Users on those hosts should set `DSH_BRIDGE_TIER=pro` or pass `--tier pro`.

Run artifacts, drivers and screenshots stayed outside the repository.
