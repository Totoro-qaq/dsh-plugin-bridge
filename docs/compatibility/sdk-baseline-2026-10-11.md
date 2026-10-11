# Bridge 0.4.3 development SDK baseline — 2026-10-11

The development SDK now matches the published DSH `0.2.1-alpha.2`:
all eight DSH development packages use that exact version, and Cordis uses
`4.0.5-alpha.1`, as required by that SDK. The previous development baseline was
`0.1.6-alpha.2` with Cordis `4.0.4`.

DSH SDK peers remain host-supplied (`*`, optional), and the existing
`engines.dsh` and named Workshop host declarations are retained. Runtime source,
client injection declarations and generated `lib/` files are unchanged.

## Checks

- The updated dependency guards initially failed on the old SDK pins. They now
  also read installed package manifests to detect stale local types.
- Typecheck uses the actual alpha.2 Chat, Conversation and Slot declarations.
  Bridge's `conversation.chat.commandview` registration still matches the
  official keyed, session-scoped contract and `CommandRowProps`.
- `test/client-slots.test.mjs` loads the official renderer's `SlotRegistry`, real
  `SlotCore` and Cordis, and the built Bridge client. It verifies registration
  before the owner exists, command dispatch with the source session, cleanup
  when the owner collapses, restoration when it returns, and complete plugin
  unload. Visual primitives and DOM mount APIs are stubbed because this test
  does not render a browser view.
- `npm run verify` covers build, typecheck, 281 tests, generated-artifact
  consistency, datasets and installation/import of the packed artifact.

This record covers source and SDK integration. The prior real Web/Desktop
checks remain in [the alpha.2 acceptance record](dsh-0.2.1-alpha.2-2026-10-10.md).

Source contracts: [Chat slots](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/ui-chat/src/client/contract/slots.ts)
and [the renderer registry](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/client/ui-renderer/src/client/registry.ts).
