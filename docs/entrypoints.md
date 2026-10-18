# Bridge entrypoints and human confirmation

Bridge's migration protocol stays the same: choose a target, prepare a handoff,
review or edit it, then explicitly confirm. The entrypoints below reuse that
protocol; none adds an in-place preset switch or grants a model confirmation
authority.

## Start a handoff

- **Session menu:** open the current conversation's sidebar `⋯` menu and choose
  **Hand off session**. This uses a uniquely owned public list contribution,
  not a permanent header button. It is limited to the currently open
  conversation, so selecting an unrelated sidebar row cannot retarget a draft.
  The composer's existing Bridge item is also enhanced where available; DSH
  hides argument-taking commands from its inline `+` menu when a draft already
  has text. Bridge preserves its argument declaration rather than breaking
  typed `/bridge <preset>` calls or modifying the Host's private command list.
- **Keyboard:** find `Bridge: Hand off current session` in DSH keyboard settings.
  Its command ID is `dsh-plugin-bridge.open`. It starts unbound so users can pick
  a binding without Bridge taking a shortcut from DSH, their editor, or another
  plugin. The Host owns binding persistence and conflict handling.
- **Natural language:** for example, “Hand this conversation off to PTC; let me
  review the summary first.” A tool-capable model can call `bridge_prepare`.
  Omitting the target opens the target picker rather than guessing a mode.
- **Existing command:** `/bridge`, `/bridge <preset>`, `--doctor`, the explicit
  `--go`/`--continue` flows, and file-based fallback remain available. An
  argument-bearing command must not be swallowed by the menu decoration.

The menu and shortcut open a target picker. They do not create a target, invoke
a model merely to open that picker, replace the current draft, or submit the
composer's pending attachments. The shortcut is limited to the visible
conversation: not another main panel, an open modal, or an embedded frame.
Repeated activation shares in-flight work instead of submitting duplicate
requests. Transport errors remain visible and retryable without a permanent
extra control on the page.

A known empty conversation instead receives a localized explanation to open
an existing conversation. Command-line usage remains available under a
collapsed help disclosure; it is not the primary target-selection interface.

## Natural-language authority and cost

`naturalLanguage` defaults to `true`. Set it to `false` in Bridge configuration
to keep direct menu, keyboard and slash entrypoints without registering the
model tool. The optional tool service is not a required dependency of the
command or client renderer.

`bridge_prepare` accepts only an optional exact target preset ID and optional
language. The calling session comes from the Host execution context, never a
model-supplied session ID. Commands, confirmation flags, continuation flags,
summary text and file paths are not tool parameters. The tool delegates to the
same command instance, including the same pending-preview table, rather than
creating a second migration implementation. Bridge's own summary-worker
sessions cannot recursively call this entrypoint.

The native tool result gives the model a compact preparation status and stops
that successful preparation turn where supported. A versioned, Host-owned
tool-result presentation renders the existing Bridge card. A Bridge-owned,
nonexclusive conversation node also projects a verified result outside the
Host's collapsed process details without changing global collapse settings.
The original tool log remains intact. Native results need their matching
`bridge_prepare` call header; older PTC logs without trusted metadata keep the
command fallback rather than inventing a preview. Canonical tool data
contains the result text, so a PTC program can still read it; this is not a
promise to hide the handoff from all model-tool runtimes. If the client lacks
the optional tool view, the result supplies `/bridge` as the visible fallback.
No tool call authorizes migration by itself.

Enabling natural language adds tool-description tokens. Preview creation still
uses the existing summary worker, and explicit confirmation still uses the
existing target request. The former unconditional “zero prompt tokens after
installation” claim applies only to command-only releases/configurations, not
to this default tool-enabled configuration.

## Confirmation, isolation, and lifetime

All editable cards retain their source session, target preset and preview ID.
The confirm click submits the actual edited text through the existing guarded
command path. Switching conversations must not retarget an old card to the new
active session. Replayed or cross-session confirmations keep the established
rejection and duplicate-submission behavior.

Client contributions use Bridge-owned IDs in public list/keyed extension
surfaces. New shortcut, command-UI and tool-view services are optional child
scopes; their absence must not make the entire plugin wait or prevent the old
slash card from loading. Bridge installs no global keyboard listener, replaces
no single-owner slot, and does not edit another plugin's styles or bindings.

Disable/unload removes Bridge's runtime tool, menu decoration, view, transient
error contribution and shortcut-command registration. The Host may retain a
user's binding preference for reinstallation; Bridge does not erase global
keyboard settings. Owned preparations are cancelled and drained; cancelled
late results must not become confirmable previews. No user notes, source
history or Host database is deleted by this feature.

Cancellation interrupts Bridge's polling, sleeps and cancellable reads. A
separate cleanup signal bounds worker-status reads and waits to five seconds;
the typed Host's write APIs (including cancellation and archiving) do not expose
a cancellation contract and are still fully awaited. This does not promise a
five-second unload for an arbitrarily stalled Host write. If worker cleanup
fails, the worker identity guard is retained and the command path reports the
failure instead of marking cleanup successful. An already-aborted NL call may
surface the original cancellation rather than that command's detailed cleanup
message; this remains a diagnostic limitation, not evidence of successful cleanup.

## Verification scope

The task's version-specific acceptance record is the evidence for observed
interaction and lifecycle behavior. Source/type checks alone do not certify
native Desktop keyboard dispatch, arbitrary third-party UIs, every model, or
every plugin combination. Historical package-manager cleanup limitations are
separate from removal of these runtime contributions.
