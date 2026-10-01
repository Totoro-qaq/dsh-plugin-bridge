# Approved-plan handoff test evidence

The journeys were derived from the requested feature: approve a native DSH plan, execute it in a new conversation, release it, and verify the published package in the real UI. This file records completed implementation/candidate checks; post-publication receipts are recorded with the release.

## Journeys and guarantees

| Journey | Evidence |
|---|---|
| Approve the exact plan and execute it in a fresh same-preset session | `test/approved-plan.test.mjs`: source cancellation precedes target creation, full plan matches the goal and kickoff, and no summary worker is used |
| Keep ordinary approval/feedback working | Native question observer delegates the original answer unchanged; unload of an unclaimed review does not change settlement |
| Prevent stale or foreign approval | Altered text, another call/session, cancelled reviews and invalid payloads admit no target |
| Prevent duplicate execution | Concurrent and completed replay return the same target; one create and kickoff |
| Recover a failed create | Session-bound approval receipt retries the exact approved plan without cancelling newer source work; expiry and changed user requests block it |
| Stop cleanly | Rejected source cancellation and unload during cancellation admit no execution session |
| Keep the full document | Unicode/CRLF fidelity and a plan exceeding the ordinary summary budget are tested |

## RED and GREEN checkpoints

- `1dc43e1`: the new approval flag was rejected by the old parser, the client builder was absent, and the approved-plan factory was unimplemented. The runtime test target executed and failed for these missing feature paths.
- `41441f0`: initial 14 approved-plan tests and real Cordis load tests passed after the core implementation; typecheck/build passed.
- `352a4fa`: cancellation-after-render and unload-during-handoff tests produced RED (14 passed, 2 failed).
- `2d9c7c5`: explicit `accepted: false` cancellation produced RED (20 passed, 1 failed). The implementation now validates cancellation acknowledgement.
- Final relevant test/coverage command: `node --experimental-strip-types --experimental-test-coverage --test test/approved-plan.test.mjs`. The measured 23-test run passed with new-module coverage **100% lines, 84.78% branches, 100% functions**, including long-plan fidelity and retirement of old retry authority. The bounded-history behavior test was already GREEN when added; the later pruning adjustment is an internal refinement, not claimed as another RED reproduction. Final full-suite counts belong to the release checks.

## Real UI candidate evidence

The official DSH 0.2.0-rc.2 WebUI with published Bridge 0.3.11 displayed native plan review but no new-session approval button (UI RED). An isolated source-build 0.4.0 candidate added the button alongside the unchanged native controls. Its center hit-test reached the button and it was in the viewport (115×26.84 px).

Source session: `session-4633e339-00e3-4714-a19d-9580da092be2`. Target session: `session-fb9b35ee-cabc-4100-be7d-e3d91a818bbe`. The real UI click opened the target automatically. Its 1,593-character approved plan matched the initial goal and kickoff exactly; one actual user kickoff was recorded. Six executor tool calls included native write/read and shell byte checks, with no tool errors. The independent file oracle read exactly `PLAN-8472\n` (ten bytes). The target was idle with plan mode off and the handoff goal paused; the source was idle with plan mode still on.

This candidate run preceded the final cancellation-acknowledgement guard and publication. It is not a registry-package acceptance claim. Separate post-publication registry/UI receipts complement the candidate evidence and are recorded with the release. Test drivers, raw session dumps, credentials and test profiles remain outside the repository.

## Limits

The fixed live-model scenario is not a reliability benchmark or a claim about every custom UI/Desktop wrapper. UI layout was inspected at the tested viewport; there is no pixel baseline or WCAG certification. The native host owns plan-mode enforcement and file permissions. Bridge preserves the exact approved document and moves execution, rather than granting broader authority.
