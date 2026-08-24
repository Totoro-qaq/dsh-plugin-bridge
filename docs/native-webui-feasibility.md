# Native WebUI migration card: implementation boundary

Status: **implemented on main; the server command remains the compatibility fallback**.

## Verified extension path

The official rc.7 through `0.1.1-rc.2` WebUI contract supports third-party browser modules through a package-level `dsh.client` manifest. Its client runtime exposes a slot registry, and official plugins register occupants such as conversation views, input docks, settings items, and command renderers. Bridge uses that path; it does not patch the DOM or fork the WebUI.

The host half still injects `commands` and `apiProxy`. The client half registers the `bridge` key in `conversation.chat.commandview`, parses only the host result, renders Markdown or complete JSON, and sends an edited summary back through `/bridge --go --summary64`. `recordInput: false` keeps that encoded payload out of the durable command log.

## Product shape

The native surface expresses migration verification rather than copying a generic dashboard:

1. the ordinary `/bridge <preset>` command chooses the target and starts the preview;
2. the running command row immediately shows elapsed time and states that the source is untouched;
3. the settled card renders the five-section handoff and its warnings;
4. the user can switch between rendered preview and an exact text editor;
5. explicit confirmation invokes the same host command and then opens the created session through `ctx.sessions.open`.

The server result always retains the created title and session ID, and the file-edit path remains available to older clients and the CLI.

## Compatibility boundary

- Client packages and slot contracts remain prerelease and version-coupled. They are optional peers; rc.6 and clients that cannot load the browser half retain the complete server command result.
- rc.2 guards both the parent `remote` face and `remote.commands`, and its generated command wire requires an explicit image array. Bundle tests pin both details.
- The browser does not own a second migration engine. History folding, summary generation, attachment policy, target creation, goal pause, and rollback remain host-authoritative.
- Edited summaries are bounded to 24,000 characters and base64url-encoded for one command invocation. Malformed or oversized payloads fail closed before target creation.
- The client contract shapes for rc.7, rc.8, `0.1.1-rc.1`, and `0.1.1-rc.2` were compared; `0.1.1-rc.2` has installed official-WebUI evidence.

## Acceptance evidence

The 2026-08-25 installed-WebUI gate covered:

- official client-module load and disposal;
- wide and narrow layout behavior;
- server `/bridge --doctor` fallback and native rendering;
- immediate progress, rendered Markdown, editable text, and JSON tree rendering;
- no target before confirmation;
- reviewed-payload migration, paused goal, and automatic target navigation.

Three fixed real-model runs preserved five facts in both preview and target, with worker times from 7.4 to 12.8 seconds. See the [native workbench report](../reports/native-workbench-2026-08-25.md). This is release evidence, not a statistical guarantee.
