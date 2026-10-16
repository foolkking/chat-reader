# UX quick review — conflict resolution recovery and visit ownership

2026-10-15 · source evidence recorded before this batch's product edits.

## Scope and evidence

Web app; ordinary readers recovering from annotation/notebook conflict
resolution failures. This continues the full ordinary-user goal after the
separate merge-draft refresh repair, not a new receipt/outbox design. Scope:
the component's post-failure status read and already-waiting confirmation/
resolution completions when the conflict visit is retired. Content may be
sensitive, so no real draft, identifier or transport detail is recorded.

SEEN: `apps/web/components/offline-conflict-review.tsx:21–71,94–97`,
`apps/web/lib/offline-conflicts.ts:59–162`, the parent resolver branch in
`offline-sync-center.tsx`, existing settings conflict browser scenarios, and
neighboring `PendingChangesPanel`/`ReadingPositionSyncStatus` recovery guards.
NOT SEEN: mounted React, actual Dexie failures, confirmation/focus/navigation
in a browser, cross-tab writers, production or device-resource behavior.
Code facts are observed; rendered consequences are inferred. No accessibility
conformance or resource claim is made.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| ERR-CONFLICT-STATUS-01 | Defect / error recovery; truthful state | Medium | Observed (code); rendered consequence Inferred | S |
| ERR-CONFLICT-VISIT-01 | Defect / error recovery; navigation | Medium | Observed (code); rendered consequence Inferred | S |

**ERR-CONFLICT-STATUS-01.** In `submit`'s catch branch, the status lookup
`await offlineDb.settings.get(conflictKey)` has no catch of its own. If the
resolution operation and that recovery read both fail, the event's discarded
promise rejects and the old Boolean still chooses between “Retry resolution”
and the comparison/choice controls. A reader cannot tell whether a saved
request exists, and can be shown a confirmed pending state or fresh-choice
path that was not established by that read. The neighboring pending-change
panel already contains its fallback read failure. Add an explicit unconfirmed
status, retain merge memory/dirty protection, contain the second failure and
offer a read-only status recheck before any new choice or request retry.
An initial marker-read failure needs the same unconfirmed-state boundary.

**ERR-CONFLICT-VISIT-01.** `submit` has no visit/generation checks around its
confirmation, prepare, retry, invalidation or recovery lookup awaits.
The existing key/unmount cleanup retires reads and draft-save completions,
but a late resolution can still call the old `onBack`, clear busy or publish
error/pending state into a later conflict visit. A reader who has moved on can
have that new view closed or relabeled by the older operation. Apply the
existing generation guard to an invocation before it waits and after each
await. Do not send the next resolution step or navigate after retirement.
An already-started storage/network operation is not cancelled or undone.

## Ordered repair and acceptance

1. Distinguish unknown, confirmed-pending and confirmed-comparison status.
   Preserve finite localized feedback; no raw exception detail. A recheck
   reads the marker and, when no pending request exists, current comparison;
   it must not prepare, submit or acknowledge a resolution.
2. Guard already-waiting submit continuations with the existing generation,
   including nested recovery read, busy cleanup and `onBack`.
3. Extend the actual-component controlled regression with initial/post-failure
   status-read failures, read-only recovery to comparison/pending/STALE,
   locale/draft retention and retired confirmation/prepare/retry/status-read/
   invalidation cases. Author only; leave unexecuted in the current boundary.
4. After authorization, run the focused Node file and relevant Web gates,
   then real Dexie double-failure, pending receipt retry, conflict switching,
   closing/reopening, locale, draft protection and focus acceptance.

## What's working and left alone

Keep the merge-refresh preservation, existing confirmation, local/server/merge
choices, original-operation receipt retry, server/copy revision checks,
descendant rebase and pending export/cleanup protection. Do not change draft
keys, stored records, API, schema, packages, dependencies or background managers.
This is not a new submit queue, cross-tab reconciliation, cancellation,
confirmed-success refresh redesign or protection against every arbitrary
retained handler invoked only after retirement. Those are separate scopes.

## Implemented source checkpoint

- `pendingResolution` now explicitly distinguishes unconfirmed status from
  confirmed pending/comparison. Initial marker failures and contained nested
  recovery-read failures select unconfirmed status and finite localized
  feedback. The view offers `Recheck resolution status` rather than choices
  or request retry. The existing loader reads the marker and only then any
  eligible comparison; it has no resolution write/admission call.
- A successful recheck restores the existing pending retry for a non-STALE
  request, or comparison for no request/STALE. In-memory merge and failed/
  pending save state are not reset. The copy makes no promise that an unknown
  operation failed or that storage was untouched by already-started work.
- Submit captures the existing generation before confirmation and checks it
  before later steps and publication after awaits. Retired confirmation,
  prepare, retry, recovery lookup and invalidation continuations do not move
  the new visit or call the old return callback. Started work may complete;
  this is not network/storage cancellation or a new submit serialization
  mechanism.
- The shared `scripts/ux/offline-conflict-merge-draft-refresh.test.mjs` is
  expanded with controlled reads/actions and the proposed recovery/retirement
  cases. It remains **unexecuted** in full. These hook/storage adapters do not
  establish actual React, Dexie, receipt, browser, focus or resource results.
- Current project state, architecture, PWA contract, user flows, testing,
  navigation and documentation inventory are synchronized. No tests/gates,
  services, build, product browser, production action, commit, CI, deployment
  or CPU/RSS measurement ran. The full ordinary-user goal remains active.

Formatting evidence: `git diff --check` on the edited tracked component and
current-fact documents returned 0 without whitespace errors. Existing
LF→CRLF warnings remain; no line-ending normalization was performed. This
does not validate behavior or cover the untracked report/shared regression.
