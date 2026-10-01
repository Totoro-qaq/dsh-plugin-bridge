# Approve a plan and execute it in a new session

Bridge 0.4.0 adds an optional action to the official DSH plan-review card. It sends the plan you approve to a fresh execution conversation, so planning history and implementation remain separate and inspectable.

## Use the native approval card

1. In a normal DSH conversation, enter `/plan` with the task you want planned.
2. Wait for the model to submit the complete plan through `exit_plan_mode`. Review the original Markdown in the host's sidebar.
3. Click **批准并在新会话执行 / Approve in new session**. The accessible name is **批准计划并在新会话执行 / Approve plan and execute in a new session**.
4. Bridge stops the original planning turn, creates an independent session in the current preset and workspace, copies the selected provider/model/reasoning effort when available, transfers the approved plan verbatim, starts implementation, and opens that session automatically.

The original conversation retains its planning history and remains in plan mode. Its stopped `exit_plan_mode` invocation is not an in-place approval: the durable Bridge command outcome links to the separate execution session. The host's existing **同意执行 / Approve** control still executes in the original conversation; **要求修改 / Request changes** still belongs to the host.

The complete approved plan is the execution scope. Planning-stage waits are satisfied by this explicit action; independent tool permissions, safety restrictions and separate approvals remain in force. Bridge does not grant new permissions or run shell commands on the model's behalf.

## What is transferred

The plan body is preserved exactly, including Unicode, line endings, numbered steps and its acceptance criteria. No summary worker rewrites it, and the regular `summaryCharBudget` does not truncate it. Up to 128,000 characters are accepted; larger plans must be shortened and resubmitted rather than silently cut.

Quoted recent user requests provide bounded background and persistent constraints. Old tool-call history is not inherited. The default `inject: both` also stores the full plan as a paused handoff goal; the explicit kickoff starts one normal execution turn without activating extra autonomous goal rounds. Completion depends on the selected model, tools and host limits, as with ordinary native plan execution.

## Failure and retry

- Altered plan text, a different review identity or source session, and a review that already settled cannot authorize a new target.
- Duplicate clicks share the same in-flight operation and completed result. They do not create another target or send another kickoff.
- Bridge must stop the original planning turn before admitting implementation. An explicit cancellation rejection prevents target creation.
- If target creation fails, the command outcome includes `/bridge --approved-plan <receipt>`. Run it in the original source conversation to retry the already-approved plan. It does not cancel later work in that source; changed user requirements invalidate the retry.
- Once a target exists, an uncertain prompt delivery is not retried automatically. Open the named target and inspect it; another execution session is not created.

Approval/retry receipts are in-memory, retaining up to 64 completed or ready-to-retry entries for 30 minutes; in-flight handoffs are not evicted. They disappear on host restart or Bridge unload. The original plan remains in DSH's own native tool log; Bridge does not introduce a separate database or delete source/target conversations when uninstalled. Unloading an unclaimed review keeps the host's ordinary answerer flow intact.

## Integration and verification boundary

The server observes the public `user-questions/request` waterfall and delegates ordinary decisions unchanged. The client contributes one uniquely named entry to `conversation.plan-review.actions`; it does not replace native approval controls or another UI plugin's entry. The feature uses the existing Bridge host port. Hosts without this UI slot can continue ordinary Bridge migration; compatible custom UIs can reuse `buildBridgePlanApprovalCommand` from `dsh-plugin-bridge/client-contract` with the exact current native review.

Candidate testing used official npm DSH 0.2.0-rc.2 on macOS ARM64, Node 22.23.1 and an isolated WebUI/profile. A real DeepSeek model submitted a plan; a real UI click created and opened a different session; that executor wrote `PLAN-8472\n` to a new file, read it back and checked its exact ten bytes. The source remained in plan mode, the target did not enter plan mode, the plan matched the initial prompt and goal exactly, and one kickoff was admitted. Native Desktop wrappers, arbitrary custom UIs and statistical reliability are outside that fixed-scenario test.

The isolated runtime omitted optional components and supplied the required official ARM64 native packages separately. Its optional ripgrep search was unavailable during planning; native file read and shell operations worked, and the executor completed all approved file and byte-verification steps without tool errors. No local AI model was downloaded.
