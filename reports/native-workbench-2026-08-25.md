# Native WebUI workbench acceptance · 2026-08-25

Environment: isolated official `@deepseek-ai/dsh@0.1.1-rc.2` Web profile, locally packed Bridge `0.2.11` plus the current PR changes. The source, worker, and target sessions were synthetic and isolated from the user's normal DSH home.

## What was exercised

- the client half loaded through the official `dsh.client` module graph and occupied `conversation.chat.commandview`;
- `/bridge --doctor` rendered through the native card and reported 13/13 host capabilities;
- the running row showed immediate elapsed-time feedback without mutating the source;
- completed Markdown rendered through the official primitive, a complete JSON edit rendered as a keyboard-accessible tree, and the textarea round-tripped user changes;
- the reviewed payload was accepted by the host command without being recorded in command input;
- the created goal was paused, the first target turn restated the handoff, and the client automatically opened the target session.

## Fixed repeat gate

Each run carried the same five low-collision facts: port `8118`, PostgreSQL, MongoDB forbidden, `src/orders/router.ts`, and “idempotency tests only.”

| Run | Route | Preview facts | Target facts | Worker time | Target LLM time | Paused | Auto-open |
|---|---|---:|---:|---:|---:|---:|---:|
| R1 | standard → code | 5/5 | 5/5 | 12.846 s | 7.807 s | yes | yes |
| R2 | minimal → code | 5/5 | 5/5 | 9.713 s | 6.175 s | yes | yes |
| R3 | minimal → code | 5/5 | 5/5 | 7.421 s | 5.772 s | yes | yes |

R1 additionally changed `8118` to `8118（用户在 WebUI 校对）` inside the native editor; the exact marker appeared in both the stored target goal and the first target response.

The token counters and per-run records are in [`native-workbench-2026-08-25.raw.json`](native-workbench-2026-08-25.raw.json).

## Boundary

This is a three-run fixed release gate, not a latency distribution or population-level reliability claim. Worker and target latency, token use, and phrasing remain model-, preset-, cache-, and provider-dependent. Automated fake-host tests cover failure and payload bounds without spending tokens; this report covers the installed official-WebUI path that those tests cannot prove.
