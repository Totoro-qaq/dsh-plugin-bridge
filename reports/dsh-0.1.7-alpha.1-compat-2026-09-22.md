# DSH 0.1.7-alpha.1 compatibility acceptance

Date: 2026-09-22 (Asia/Shanghai). **The published npm Bridge 0.3.9 was tested unchanged.** Core compatibility passed; no Bridge runtime, dependency or version change was needed. Runtime removal passed, with the disk-residue qualification below. This is compatibility evidence, not a new Bridge release.

中文结论：已发布的 Bridge 0.3.9 通过本轮隔离实机验收，无需改实现或另发 npm。卸载清除了插件包、命令和样式，但仍有失效 CLI 链接及包管理记录；不能称为磁盘完全零痕迹。

## Environment and upgrade fixture

- Official npm `@deepseek-ai/dsh@0.1.7-alpha.1`, installed in a separate prefix; macOS, Node 22.23.1, real Chrome.
- Copied the earlier official DSH 0.1.6-alpha.2 synthetic test home: 13 V3 sessions, 12 existing titles, messages and archived-session records. Installed registry `dsh-plugin-bridge@0.3.9` in the copy before booting the new host.
- Original session files and key profile configuration were hashed before and after the run and remained unchanged. The daily-use DSH home was not upgraded.
- Old sessions retained their references to the earlier empty test workspace; the image case used another isolated empty workspace. Test tasks prohibited tools and task-file access; target logs confirmed no tool calls.
- Credentials were supplied only to the isolated child process environment. Speech transcription was not enabled and no recognition model was downloaded.

## Model-backed migration

The source was a short Chinese conversation with exact port/database/file conventions and a deferred arithmetic step. Each native-card run selected `ptc`, generated a real summary, edited ordinary text fields, switched to Markdown and changed the port, then returned to text editing before confirmation.

| Check | Wait for confirmation | Continue directly |
|---|---|---|
| Target picker and real summary worker | PASS | PASS |
| Text → Markdown → text edits retained | PASS | PASS |
| Default choice remains wait | PASS | PASS; continuation selected explicitly |
| Submitted summary and target goal objective match the edited text exactly | PASS | PASS |
| Automatic target opening | PASS | PASS |
| Target behavior | Restates and waits; no calculation result | Restates and returns `RESULT=385` in the same turn |
| Goal | `paused`, `roundsStarted=0` | `paused`, `roundsStarted=0` |
| Source user/assistant content | Unchanged | Unchanged |
| Worker after completion | Archived, not running | Archived, not running |

The card's long body scrolled without horizontal overflow; its confirmation button stayed in position while the body scrolled (1280×900 viewport). No page/console errors were recorded. Picker-to-preview times were about 18.8 s and 20.3 s: two fixed samples, not a latency benchmark or population reliability guarantee.

## Upgrade, failure paths and images

| Check | Result |
|---|---|
| V3 → V4 restoration | 13/13 sessions restored as V4; user/assistant content preserved and 12/12 titles matched |
| Prior physical generation | V3 files retained with their baseline hashes in the copy |
| `/bridge --doctor` | 13/13 |
| Cancel a running summary worker | Reports cancellation and a retry instruction; `turn/end` is `aborted`; worker archived and no migration target created |
| Force a very short preview timeout | Only the test process used `previewTimeoutMs=1`; returns a timeout/cancellation error after about 3.43 s; worker ended and was archived, with no migration target |
| Read an unresolved image from V4 | Recorded `eval/fixtures/rc11-vision.png` as a real user image, then cancelled the source turn before a visible assistant answer. Attachment gateway bytes matched the fixture's SHA-256 |
| Migrate to the official text-only model | Selected `deepseek-v4-pro` on the source. Bridge copied that choice; the host rejected image admission with `session/attachment-invalid`, and Bridge sent a text fallback |
| Image fallback result | One accepted target user prompt, no image blocks, no tool calls, paused goal; the target explicitly said it could not determine the absent image's contents |

Cold history reads did not immediately publish all V4 files. Resolving an Agent did: after checking that no fixture goal was active, listing commands resumed the remaining fixtures without requesting model work. This distinction is part of the upgrade evidence, not a Bridge repair.

## Plugin lifecycle

One live disable/enable cycle from the Plugins page changed Bridge's style count **1 → 0 → 1**. Its command disappeared and returned; doctor passed 13/13 after re-enabling. No page errors occurred.

The official CLI removal command was followed by a host restart. Bridge's package dependency, bundle registration, package directory, command and CSS were absent. The host still started, and user/assistant message hashes for all **23 V4 sessions** present at that point were unchanged.

### Removal residue

Both the upgraded profile and a separately initialized clean profile retained this dangling symbolic link after official CLI removal:

```text
node_modules/.bin/dsh-bridge -> ../dsh-plugin-bridge/lib/cli.js
```

The target and `node_modules/dsh-plugin-bridge` package directory were gone: `lstat` saw the link, while following it with `existsSync` returned false. It is not executable Bridge code left loaded in the host.

Installation-operation logs and the exact `dsh-plugin-bridge@0.3.9` `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml` also remained. Output identified pnpm 11.22.0. The clean-profile control reproduced the dangling link, but this run did not isolate whether DSH's removal logic or the invoked package manager owns the defect.

Existing sessions, historical command results and exported handoff files were not deleted. No self-deleting Bridge hook or host-directory cleanup was added. **Runtime removal passed; zero disk traces were not claimed.**

## Driver adjustments and evidence boundaries

- The 0.1.7 Remote command wire arguments are `agentId`, `line` and `submittedAttachments`. The standalone driver was corrected from its old `sessionId` / `images` request. Native-card execution passed without changing Bridge.
- A V4 cached projection watermark is not a session-event cursor. The audit read the isolated home's complete durable logs, decoding every concatenated Zstd frame, rather than treating that watermark as an event position.
- Raw JSON, drivers, screenshots, credentials and temporary homes remain outside the repository. The table above records the bounded acceptance; the package was not modified to pass it.

## Not covered

- Migration of legacy custom directory presets, arbitrary third-party UI/plugin combinations, Windows, long/compacted-history fidelity, or visual-model recognition accuracy.
- First installation or package upgrades through the WebUI without restarting. The lifecycle evidence covers CLI installation/removal and Plugins-page disable/enable only.
- Every possible cleanup race: worker exits covered normal completion, explicit cancellation and the forced short timeout.

Both isolated profiles had Bridge removed at the end, the test host was stopped, and the original profile hashes were rechecked. This documentation-only compatibility update does not require another Bridge npm release.
