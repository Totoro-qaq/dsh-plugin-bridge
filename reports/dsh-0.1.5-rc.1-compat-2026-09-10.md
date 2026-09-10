# DSH 0.1.5-rc.1 compatibility acceptance

Date: 2026-09-10 (Asia/Shanghai). **Published Bridge 0.3.4 from npm**, unchanged. No Bridge code, dependency range or build changed for this run: the 0.3.4 peer term `^0.1.5-alpha.1` already matches `0.1.5-rc.1` and the future `0.1.5` final under npm semver. DSH made `0.1.5-rc.1` its npm `latest` on release day.

## Environment

- Official npm `@deepseek-ai/dsh@0.1.5-rc.1` in a scratch prefix (521 packages, Node 22.23.1, pnpm 11.22.0), isolated `DSH_HOME`, seeded scratch workspace. No user profile, session or credential file was read or modified.
- `dsh plugin --profile web add dsh-plugin-bridge@0.3.4` from the registry: no peer warnings; Bridge joined the profile bundle layer after `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app`.
- The WebUI was driven by headless Google Chrome 152 through `playwright-core` with a throwaway browser profile. Unlike the in-app browser used for the 0.1.5-alpha.1 smoke, it held the `remote.mux` WebSocket, so the native card was rendered and inspected.
- The repository owner entered their DeepSeek key in the isolated WebUI; it was stored only in that isolated `DSH_HOME` (`refs.DEEPSEEK_API_KEY`). Default model: `deepseek-flash` (DeepSeek-V41-Flash, image-capable), reasoning effort max. The Bridge summary worker used its `pro` tier (`deepseek-v4-pro`).
- All Session content was synthetic.

## Upstream contract

Type declarations of every package Bridge pins or calls structurally were diffed between `0.1.5-alpha.1` and `0.1.5-rc.1`. Nothing Bridge uses changed:

| Change | Effect on Bridge |
|---|---|
| Top-level `conversation` panel slot moved to `main.conversation` | None; Bridge registers `conversation.chat.commandview`, which is unchanged |
| `forClosing(owner, sessionId)` file-mention hook; `DocumentFileIcon` replaced by `FileTypeIcon`; `CodeBlock`/`Menu` gained optional props | None; the card uses `MarkdownText` and `JsonTree` only |
| Session controller gained `revealPath`/`workspaceDesktop` | None; the 13 methods Bridge probes are unchanged, `commands.execute(sessionId, line, attachments)` unchanged |
| Session lifecycle: `SessionHandle`, per-process session lock | None observed; Bridge reads history through `inspect` and never opens logs |
| Default model DeepSeek-V41-Flash accepts images | Changes which image path is common; see the image run below |
| Pausing a goal aborts the active turn; only the user may resume | Bridge pauses before kickoff; the targets below all stayed paused with zero goal rounds |

## Credential-free checks

| Check | Result |
|---|---|
| `/bridge --doctor` | `dsh-typed-controllers · 13/13`, targets `ptc · minimal · cordis` |
| Native card | Rendered for doctor, usage and error results; no page errors; no horizontal overflow at 1280 px |
| `/bridge ptc` with no key configured | Failed closed with `worker-empty`; no target Session was created and the summary worker was archived |

A Session that contains only command runs stays blank and keeps the empty-workspace hero view, so no command row or card appears there. One ordinary message first makes the Session non-blank.

## Model-backed migration

Three real migrations from a `standard` source to `ptc`, each on a fresh source Session:

| Check | Run 1 | Run 2 | Image run |
|---|---|---|---|
| Source seed turn | 7 s | 6 s | Image admitted; turn stopped before any assistant analysis |
| Preview facts (project code, PostgreSQL, port, planned `src/migration.ts`, MongoDB ban) | 5/5, 24 s | 5/5, 20 s | Project code kept; image reported as `未解析 1 条` |
| Text mode | Five-section form, 5 fields | Five-section form, 5 fields | — |
| Markdown edit of Next step | Reached target byte-exact | Reached target byte-exact; also visible back in Text mode | — |
| Confirm | One target, auto-opened in PTC | One target, auto-opened in PTC | One target; confirmation says the unresolved original was carried to the vision target |
| Target goal (projection cache) | `paused`, `maxGoalRounds 1`, `roundsStarted 0` | `paused`, `maxGoalRounds 1`, `roundsStarted 0`, objective contains the edit | Paused goal bar shown |
| Target reply | Restated facts, ran no tools | Restated facts including the edited step as the next action, ran no tools | Read `IMG-4821` and the blue triangle from the carried image, restated, stopped |
| Target turn usage | 10.8K tokens, cache 0% | 10.3K tokens, cache 83% | 23K tokens, cache 86%, 2 steps |
| Page errors | 0 | 0 | 0 |

Findings:

- **Run 1's edit was a test artifact, not a product defect.** The edit line was labeled `EDIT-MARK-7731`. The kickoff tells the target to disregard anything "标记为已作废", and the target declined to treat the "MARK" line as confirmed, while still carrying it verbatim. Run 2 used a natural sentence and the target adopted it as the next step.
- **Image kickoff costs one extra tool step in PTC.** The target already saw the attached image, then followed Bridge's note "请直接检查原图" by calling a read-only image tool before restating. No file was written and the goal stayed paused, but this is not the strict "restate and wait without tools" behavior, and it roughly doubled that turn's tokens. A wording change that says the image is already attached and needs no tool call is a candidate follow-up.
- **Default-model image behavior changed.** With an image-capable default model, unresolved source images now normally travel as raw images to the target instead of falling back to text.

## Not covered

- The text-only image fallback was not re-run on rc.1; it requires switching the target to a text-only model. The 0.1.3-alpha.2 report remains the latest evidence for that path.
- English UI, Node 24, `--go --continue`, and a `dsh plugin remove` plus restart cycle were not repeated.
- Three runs are release evidence, not a statistical guarantee.

The isolated install, profile, browser driver and screenshots stayed outside the repository.
