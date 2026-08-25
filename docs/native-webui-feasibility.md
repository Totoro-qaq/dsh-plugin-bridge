# Native WebUI migration card: implementation boundary

Status: **implemented on main; the server command remains the compatibility fallback**.

## Verified extension path

The official rc.7 through `0.1.1-rc.2` WebUI contract supports third-party browser modules through a package-level `dsh.client` manifest. Its client runtime exposes a slot registry, and official plugins register occupants such as conversation views, input docks, settings items, and command renderers. Bridge uses that path; it does not patch the DOM or fork the WebUI.

The host half still injects `commands` and `apiProxy`. The client half registers the `bridge` key in `conversation.chat.commandview`, parses only the host result, renders Markdown or complete JSON, offers lossless five-section Text/Markdown editing, and sends the reviewed summary back through `/bridge --go --summary64`. `recordInput: false` keeps that encoded payload out of the durable command log.

## Product shape

The native surface expresses migration verification rather than copying a generic dashboard:

1. the ordinary `/bridge <preset>` command chooses the target and starts the preview;
2. the running command row immediately shows elapsed time and states that the source is untouched;
3. the settled card renders the five-section handoff and its warnings;
4. the user can switch among rendered Preview, non-developer Text fields, and exact Markdown source;
5. explicit confirmation invokes the same host command and then opens the created session through `ctx.sessions.open`.

The server result always retains the created title and session ID, and the file-edit path remains available to older clients and the CLI.

The package also exports `dsh-plugin-bridge/client-contract`, a React-free card/parser/editor model. A custom UI that implements the official keyed command-view slot receives the packaged card; another UI can map the pure contract to its own components. A UI that implements neither path still receives the complete server text and file fallback. Bridge never patches an unknown UI DOM to simulate compatibility.

Custom clients do not need React or any DSH browser package to reuse the wire:

```ts
import {
  buildBridgeMigrationCommand,
  parseBridgeCard,
  parseBridgeTextProjection,
} from 'dsh-plugin-bridge/client-contract'

const card = parseBridgeCard(commandOutcome)
if (card.phase === 'preview') {
  const textFields = parseBridgeTextProjection(card.summary) // undefined => keep raw Markdown
  const confirmLine = buildBridgeMigrationCommand(
    card.targetPreset,
    reviewedSummary,
    card.lang,
    card.previewId ?? '',
  )
  // Dispatch confirmLine through this UI's ordinary slash-command transport.
}
```

`previewId` binds confirmation to the exact preview that produced the card. Custom UIs should not cache or invent it; an absent ID means the server/client pair is too old for in-card confirmation and should use the printed file workflow.

## Compatibility boundary

- Client packages and slot contracts remain prerelease and version-coupled. They are optional peers; rc.6 and clients that cannot load the browser half retain the complete server command result.
- rc.2 guards both the parent `remote` face and `remote.commands`, and its generated command wire requires an explicit image array. Bundle tests pin both details.
- The browser does not own a second migration engine. History folding, summary generation, attachment policy, target creation, goal pause, and rollback remain host-authoritative.
- Edited summaries are bounded to 24,000 characters and base64url-encoded for one command invocation. Malformed or oversized payloads fail closed before target creation; emptiness checks do not trim the transmitted Markdown.
- A WebUI payload is accepted only while the exact preview ID for the matching source session and target preset is pending and unexpired. The preview is consumed before migration; retrying the same completed payload returns the first target result instead of creating another session, even if a newer preview has since been generated.
- Once a target session exists, an unconfirmed kickoff is returned as that same navigable target with a warning and cached result. Bridge does not restore the preview and create a second target when prompt delivery is ambiguous.
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
