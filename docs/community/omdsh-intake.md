# Oh My DSH intake declaration

[简体中文](omdsh-intake.zh-CN.md) | English

This is a proposed author declaration, not an OMDSH review, certification, or Registry admission. The source repository, Issues, releases, and npm publishing remain under Totoro-qaq. No organization role or repository transfer is requested.

## Existing artifact and installation boundary

The existing npm package supplies `dsh.bundle.patch` through `cordis.patch.yml`. `package.json#dshWorkshop` proposes `harness-profile` / `profile-bundle`; it adds no SDK, adapter dependency, or runtime entry.

`transactional`, `generation-rollback`, and `touchesCurrentBeforeActivation: false` describe the requested **Workshop candidate-Profile installation contract**, not the behavior of ordinary `dsh plugin add` in a user's current Profile. No failure-injection evidence is supplied; `failureIsolation` remains null. Workshop must verify its own staging and rollback before granting installation authority.

Activation is conservatively declared `restart-host`: installing or replacing a package may require a restart. Live disable/enable evidence is not a guarantee of restart-free upgrades. `dispose: supported` covers scoped registrations and pending plugin-owned records; it does not erase user sessions, goals, attachments, exported summaries, or Host package-manager metadata. Hot reload is not declared and its evidence remains null.

## Permissions and side effects

- Read source session context, create target and summary-worker sessions, and cancel an explicitly handed-off planning turn through official Host services.
- Invoke the selected model provider to produce a handoff and start a target turn. This can consume paid API tokens and send selected conversation content to the user's configured provider; no new Hub telemetry or translation service is introduced.
- Create a paused goal when configured. Target execution remains subject to the Host's tool and file permissions.
- Write temporary summary Markdown and read an explicitly supplied summary file. Uninstall does not purge those files or user-created sessions.
- Contribute scoped native conversation/plan-review cards and navigation; no replacement WebUI is installed.

## Evidence and compatibility

The manifest names only DSH 0.2.0-rc.2 and 0.2.1-alpha.1. The existing `engines.dsh` range is unchanged. See the [rc.2 record](../compatibility/dsh-0.2.0-rc.2-2026-09-30.md) and [alpha.1 record](../compatibility/dsh-0.2.1-alpha.1-2026-10-04.md) for actual versions, model/UI flows, and limits. `/bridge --doctor` is a concrete diagnostic capability; 13/13 availability alone does not certify migration.

Native macOS Desktop 0.1.7-rc.2 was tested with Bridge 0.3.10 on 2026-09-25. The fresh [Desktop 0.2.0-rc.2 acceptance](../compatibility/desktop-0.2.0-rc.2-2026-10-05.md) verifies the published Bridge 0.4.1 through native controls, including migration, approved-plan execution, toggles, uninstall and restart. This is separate from the WebUI plan-card record.

## Submission gate

1. Review and publish this metadata change at a public immutable commit before generating a v2 submission. Already-published npm 0.4.1 and its release commit do **not** contain this new declaration.
2. Bind the exact artifact/version and complete 40-character commit; validate the v2 JSON with the pinned Workshop validator. Do not use a floating `main`, short SHA, invented commit, or unpushed local change.
3. Show the complete `[Submission]` Issue to the author and obtain specific approval before creating it. Workshop automation creates the pending-review PR; do not edit its Catalog or Registry directly.
4. The inspected Workshop baseline is still DSH 0.1.0-rc.6, outside this package's declared support. Existing modern-Host tests are not current-baseline Harness evidence. Review, verification and installation admission remain pending; do not weaken compatibility to make that old baseline pass.

References: [author submission procedure](https://hub.omdsh.dev/agent-submission-prompt.zh.md), [package schema](https://github.com/omdsh-dev/dsh-hub-workshop/blob/main/package-manifest.schema.json), [intake gates](https://github.com/omdsh-dev/dsh-hub-workshop/blob/main/INTAKE.md).
