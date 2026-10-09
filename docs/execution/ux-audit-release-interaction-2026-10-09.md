# Release interaction review — 2026-10-09

## Scope and evidence

This is a repair review of the first complete attachment/recovery release CI,
not a new full-product redesign. The audience is ordinary readers using the Web
app on desktop and mobile. Source is `eca207ffe14dd117aa3a938878777ae45a385500`;
[CI 37889682904](https://github.com/foolkking/chat-reader/actions/runs/37889682904)
supplies synthetic Chromium failures at 375px and 1440px. The adjacent
[evidence summary](ux-audit-release-interaction-2026-10-09-evidence/first-ci.json)
retains the run, original artifact IDs and sanitized failure excerpts.

No local browser/service was started, no production UI was visited, and no
screen-reader, device CPU/RSS or accessibility-conformance claim is made.
Exact pointer hit-testing after the failing double-click was not recorded;
the distinction between the observed failure and its inferred hit target is
kept below. Existing audit ledgers remain immutable.

## What matters most

One real interaction hazard is exposed by the new browser gate: moving a
conversation removes the submit action while the pointer may still be clicking.
The controller prevents duplicate requests, but the dialog can disappear before
the held request is released. This is separate from test setup mistakes, which
must not be fixed by changing correct product behavior. Routine autosave tests
need to inspect the auth-disabled fixture's actual legacy database, not invent
an authenticated owner. Mobile tests need the real action menu, uncovered
backdrop, and an upward gesture to reveal the intentionally hidden Reader header.
The settings annotation test must choose all annotations when it intends to edit
a known annotation independently of the current reading message.

## Finding: FBK-RELEASE-01 — a moving action becomes a dismissal target

| Field | Evidence-backed assessment |
| --- | --- |
| Kind / dimension | Defect; feedback, error prevention and focus management |
| Severity / effort | Medium / S — a manual move is still recoverable, but its result surface unexpectedly closes |
| Confidence | Observed (CI failure and code); precise second-click target inferred |
| Location | `apps/web/features/conversations/conversation-placement.tsx`: pending transition in `send`, dialog backdrop and footer; `apps/web/e2e/ux-recovery-followup.spec.ts`: sidebar placement case |

**Evidence.** In the 1440px CI case, a real double-click sends exactly one PUT,
whose response is held. The subsequent `Close` focus assertion finds no dialog.
The source removes the picker and submit button when `phase` changes to
`moving`; `Back` can shift into the vacated footer space and the always-active
backdrop can receive a click outside the newly shortened dialog. The snapshot
shows the Reader instead of an open move dialog. It does not identify which of
those dismissal targets received the second click.

**User consequence.** A reader who repeats a click while waiting can lose the
move dialog and its immediate context without having deliberately closed it.
The retained recovery prevents data loss, so this is not graded as a blocker.

**Recommendation.** Keep the submit control's footprint and label during a
pending write, disable resubmission, and ignore backdrop dismissal while a
request is pending. Keep explicit Close, Back and Escape available; closing does
not cancel the server request. Recover only lost focus. Retain the double-click,
one-PUT, pending-focus, independent-refresh and unchanged-Reader assertions in CI.

**Design rationale.** This is the existing quiet archive workbench, not a new
screen. Preserve its paper/graphite/sea-green tokens, subtle border depth,
raised dialog surface, existing font stack and 4px spacing scale. A stable
disabled action is preferable to removing it into another hit target. Blocking
every exit would unnecessarily trap users during network waits. No dependency,
animation, polling loop or new design token is needed.

## Test repairs, not product findings

| Cases in first run | Evidence / required correction |
| --- | --- |
| 2 manual-source mobile cases | Hidden desktop controls were clicked without opening `mobile-message-actions-trigger`; use the actual mobile menu and preserve exact Markdown assertions. |
| 4 quiet-autosave cases | `localReadingSnapshot` required `offline-active-user-v1`, but the auth-disabled fixture uses the existing legacy database with no owner binding. Resolve that explicit fixture branch without creating a DB or weakening position/outbox assertions. |
| 5 mobile sidebar-close cases | The full-screen backdrop's center is covered by the 86vw sidebar. Click its measured uncovered edge with normal hit-testing, not force or an invented Escape handler. |
| 2 desktop recent-open cases | The injected 503 is safely mapped to `服务暂时不可用，请稍后重试。`; do not expect arbitrary upstream detail to be exposed. Keep the 503, revision, one-open and unchanged-source checks. |
| 2 project-picker read cases | The page had already filled the shared projects cache (15s Query default; 10s page observer). The late route interception did not cause a request. Install the failure before navigation and assert an actual failed read before recovery. |
| 1 mobile sidebar-placement case | A downward reading gesture hid the header. Use the same real upward reveal gesture as the detail-recovery case, then record the scroll position to preserve. |
| 4 merge-reentry cases | `allTextContents()` includes the visible order number as well as the title. Verify the exact title attribute, text and ordinal separately; keep order, receipt and original-key assertions. |
| 1 settings annotation-conflict case | The snapshot has the Current/All/Notes controls and an empty Current view. The fixture's bookmark belongs to its first message; `AnnotationWorkspace` filters Current by the actual active message. Explicitly select All before editing and after reload; assert the initial comment before creating the real conflict. This does not change the annotation filter or claim browser reacceptance. |

## Priorities, preserved behavior and next checks

First add local pending-action regressions, observe their failure, then repair
FBK-RELEASE-01. Correct the test paths above without removing coverage. Run the
existing Node checks, lint, nonincremental typecheck, bounded build and discovery;
then submit the repair to the same authorized complete CI cycle. Do not increase
the mutation gate's 20-minute limit merely to hide failed waits.

Preserve the existing server request/revision contract, explicit unknown-result
checking, actual reading anchors, user-triggered header reveal, authenticated
offline ownership and source-fidelity assertions. Source review suggests future
copy opportunities in the Current-annotations empty state and English generic
API failures; these are follow-on audit candidates, not additional accepted
repairs in this checkpoint. Full browser geometry and the attachment/PDF gates
remain pending. API passed 1,239 with 3 skips; settings passed 438 and failed one,
so its fresh-instance follow-up did not run. No image or deployment is accepted.

## Repair checkpoint

The [baseline](ux-audit-release-interaction-2026-10-09-evidence/pending-placement-baseline.json)
records 61 passes and five failures before the product edit. The final placement
suite passes 68, including live state before rerender and browsers that keep focus
on disabled buttons. The compact body may still resize; the footer footprint and
pending backdrop guard prevent that change from becoming an accidental dismissal.
This is not a claim that the entire dialog has fixed geometry.

The [local ledger](ux-audit-release-interaction-2026-10-09-evidence/local-verification.json)
records 609 integrated Node passes, lint/types/bounded build and 129 discovered,
unexecuted browser cases. Original CI failures remain failures pending the next
complete run. No rendered checklist score is assigned before synthetic screenshot
review and browser reacceptance.
