# DSH alpha.5 ordered-list text mode — TDD evidence

## Source and user journey

No plan file was supplied. The journey came from an installed DSH `0.1.2-alpha.5` WebUI failure:

> As a non-developer reviewing a generated five-section handoff, I can open a flat numbered Markdown list in Text mode, edit its rows without typing Markdown, and return to Markdown without losing its numbering or continuation lines.

The compatibility gate also required an existing titled alpha.3 profile to survive an alpha.5 upgrade, complete a real `standard` to `ptc` migration, fall back visibly when a text-only target rejects an unresolved image, and remove Bridge without runtime residue.

## RED → GREEN

| Stage | Commit | Command | Result |
|---|---|---|---|
| RED | `52fac07` | `node --experimental-strip-types --test test/client-contract.test.mjs` | 20 passed, 2 failed because flat ordered lists produced no text projection |
| GREEN | `7180925` | same focused command | 23/23 passed after adding ordered markers, item edits, ordinal append, and unindented continuation coverage |
| Generated artifacts | `4c9c670` | `npm run build` | `lib/client-contract.*` and the shipped `lib/client.js` bundle matched the source implementation |

## Test specification

| # | Guarantee | Evidence | Type | Result |
|---|---|---|---|---|
| 1 | `1.` and `7)` lists enter Text mode without rewriting source bytes | `model-produced ordered decision lists remain losslessly editable in text mode` | Unit | PASS |
| 2 | Editing one ordered item preserves its exact marker | `ordered list item edits preserve markers and append the next ordinal` | Unit | PASS |
| 3 | Adding a row after `8)` produces `9)` | same test | Unit | PASS |
| 4 | A model-produced value on the next unindented line remains part of its ordered item | `ordered list continuations keep the model-produced unindented value line` | Unit | PASS |
| 5 | Existing unsupported nested or mixed Markdown structures still fail closed | existing unsafe-block and nested-list tests | Unit | PASS |
| 6 | The packed client renders ordered rows as ordinary fields and writes a new row as `6.` | installed alpha.5 WebUI interaction | E2E | PASS |
| 7 | The edited ordered document reaches the target session unchanged | installed alpha.5 `ptc` migration and paused-goal inspection | E2E | PASS |

## Repository verification

- `npm run verify`: 170/170 tests; build, typecheck, generated-`lib` drift check, datasets, and 44-file package smoke all passed.
- Source/test coverage excluding duplicated generated `lib/`: 96.09% lines, 82.69% branches, 91.83% functions.
- Changed parser file `src/client-contract.ts`: 98.20% lines, 82.28% branches, 98.31% functions.

## Installed alpha.3 → alpha.5 evidence

- Built a local Bridge tarball from the branch: SHA-1 `b748128cc973eea02ccd43a4c7cd7a50bbb41178`; 44 files.
- Installed a coherent official alpha.3 graph: 214 DSH packages at exactly `0.1.2-alpha.3`, then installed the tarball into an isolated Web profile.
- Created an alpha.3 titled session and confirmed an on-disk `session_projcache` v4 record named `ORBIT-A5-FIX关键信息复述`.
- Upgraded the same runtime to 213 packages at exactly `0.1.2-alpha.5`; WebUI started, retained the old title, and reported no browser-console errors.
- `/bridge --doctor` reported `dsh-typed-controllers` with 13/13 required capabilities.
- In the packed WebUI, a five-section summary was changed to a flat `1.` list whose port value occupied the next unindented line. Text mode exposed every row, preserved the continuation, appended row `6.`, and synchronized the edited Next step back to Markdown.
- Confirmation auto-opened a PTC target, retained the fixed facts and ordered edits, and displayed a paused goal.
- A separate Web-created Standard source contained a genuinely unresolved image. After switching the source back to text-only DeepSeek V4 Flash, `standard` to `ptc` migration omitted the raw image, preserved the explicit unresolved-image warning, restated the facts without guessing, auto-opened the target, and kept the goal paused.
- After removal and restart, the profile had no Bridge dependency, bundle row, package directory, command-menu entry, client resource, or `.dsh-bridge-card`; historical sessions remained readable and the fresh page had zero console errors.

## Boundaries

- The runtime used isolated temporary profiles and a temporary credentials copy; both were deleted after verification.
- This validates the branch tarball that became the `0.3.2` release candidate; npm `0.3.1` does not contain the ordered-list fix.
- Alpha.4 was not tested as a standalone target; the verified upgrade path was alpha.3 directly to alpha.5.
- No screenshot baseline was committed, so visual regression outside the exercised interaction states remains inconclusive.

## Merge evidence

Preserve the RED, GREEN, generated-artifact, 170-test release gate, and installed alpha.5 evidence above if the three implementation commits are squash-merged.
