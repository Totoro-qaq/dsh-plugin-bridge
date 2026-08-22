# Native WebUI migration card: feasibility note

Status: **feasible, intentionally not shipped in v0.2.10**.

## What was verified

The official rc.8 WebUI supports third-party browser modules through a package-level `dsh.client` manifest. Its client runtime exposes a slot registry, and official plugins register occupants such as conversation views, input docks, settings items, and command renderers. This provides a real extension path; DOM patching or a forked WebUI is not required.

The existing Bridge package is host-side only. It injects `commands` and `apiProxy`, and that slash-command path already works in the official WebUI. A client face could call the same host RPCs and render the same five-section preview without changing migration semantics.

## Product shape

A Bridge-native surface should express migration verification rather than copy a generic dashboard:

1. choose a target preset;
2. generate the five-section preview;
3. show number, path, image, and truncation warnings beside the preview;
4. require explicit confirmation;
5. show the created title and session ID, with copy/open actions only when the host exposes stable navigation.

The slash command remains available as the universal fallback.

## Why it is not a P0 dependency

- The client packages and slot contracts are still prerelease and version-coupled to the Harness WebUI.
- Adding a browser face introduces React and multiple DSH client peer dependencies to a package that currently needs only the host contract.
- A UI must not create a second migration implementation. The host-side preview, safety checks, and fail-closed behavior need to stay authoritative.
- Current WebUI navigation does not provide Bridge with a stable, documented way to jump to the newly created session, so a card cannot yet promise seamless navigation.

## Recommended implementation boundary

When the client contract stabilizes, prefer either an optional client entry in this package or a thin `dsh-plugin-bridge-ui` companion. Both should consume Bridge RPC results and never reimplement history folding, summary creation, attachment policy, or goal safety in the browser.

Prototype acceptance criteria:

- loads and disposes through the official client-module lifecycle;
- works on both wide and narrow official WebUI layouts;
- exposes the exact same preview file and warnings as `/bridge`;
- creates no target before confirmation;
- proves cleanup after plugin removal and restart;
- keeps `/bridge --doctor` and the host command usable when the client face fails;
- pins and tests every supported DSH client-package version.

Until those criteria can be maintained across releases, the official slash command is the more stable and lower-cost product surface.
