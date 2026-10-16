# UX quick review — sync-center local read states

2026-10-15 · source-only review, before product edits.

## Scope and evidence

Continuation of the ordinary-reader UX goal. Web app, mainstream readers;
scope is the local-ledger loading/error/empty states in Offline & sync center.
This follows the separate hidden-inspection repair, not a rewrite of local
storage, synchronization, download admission or cleanup.

SEEN: `apps/web/components/offline-sync-center.tsx` state initialization,
complete local-read effect, tab/page/mode controls and all three tab branches;
the protected cleanup panel and conflict-review feedback as local precedents.
Pre-edit center Git blob: `378acb4b0bed122aa44857ebac9af2f05469d53e`.
NOT SEEN: running UI, real Dexie failures, React transitions, focus, device
timing/CPU/RSS or browser storage. Code facts are observed; presentation is
inferred. This is not accessibility or full-settings acceptance.

## What matters

Pending edits and Failures render their zero-initialized counts and empty
messages without checking whether their first local read has finished. Copies
also reports no copies after an initial read failure. Changing page or mode
can temporarily present the preceding result as the new scope. Read errors
share the action-error string, so a later successful live read does not clear
the read failure independently. Keep errors separate from real empty results
and from mutation feedback, with a local read-only retry.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-SYNC-CENTER-01 | Defect / state coverage; system feedback | Medium | Observed (code); presentation Inferred | S |
| ERR-SYNC-CENTER-01 | Defect / error recovery; result ownership | Medium | Observed (code); timing consequence Inferred | S |

**STATE-SYNC-CENTER-01.** `offline-sync-center.tsx:56–66` initializes ledger
arrays/counts to empty/zero. The Pending empty branch (`259`) and Failures
empty branch (`263`) do not consult loading or successful-read state; Copies
(`250`) only checks loading and total. The error callback (`139`) settles
loading without distinguishing a failed read from confirmed empty data.
Someone checking unsynced edits could therefore be told “No pending edits.”
before that is known. Publish read completion for the current tab/page/mode,
show a loading status and suppress unconfirmed empty/count/row views. Keep
the independent preference status and download/catalog controls available.

**ERR-SYNC-CENTER-01.** The same effect (`79–141`) publishes resource/storage
failures through the global action-error string, which success does not reset.
The component retains preceding-page rows in state during a new page/mode
read, without a matching successful-result identity. Its live-query error
callback also leaves already-started asset-inspection promises eligible to
publish. Readers need to know whether they are seeing a verified result or a
failed/unread scope, rather than repeat actions based on stale counts.
Use a small scoped read-result state with finite storage/assets categories;
keep action feedback independent, hide failed or mismatched ledger views,
offer read-only Retry and invalidate prior inspection publication on ledger
error. Retain a matching successful view during a manual refresh with an
explicit loading status; do not clear stored data or replay mutations.

**Local precedents.** The center already has bounded localized errors, manual
Refresh and active/inspection-sequence guards. `pending-changes-panel.tsx:26–33`
keeps prior data on failed re-read rather than fabricating an empty snapshot.
The [admin independent-read repair](ux-audit-admin-access-independent-reads-2026-10-14.md)
also avoids treating failed initial reads as confirmed empty lists. Reuse
existing styles and controls, not a new screen or design system.

## Ordered repair and acceptance

1. Bind successful/error completion to the finite tab/page/mode scope. Publish
   only after the existing read/visible inspection completes. Separate it from
   action errors and fence older inspection callbacks after a ledger failure.
2. Add shared local loading/error feedback and a Retry that only reopens the
   local subscription. Gate ledger-dependent views/empty messages/pagination;
   leave preferences, download/catalog policy and mutations unchanged.
3. Extend the authored extracted-effect regressions with controlled failures,
   late promises, result scopes and actual source-derived view/Retry guards.
   These remain **unexecuted**, not mounted React or real Dexie evidence.
4. When authorized, run the focused suite/gates and validate actual tab/page/
   mode switching, cold empty/error states, background actions and focus.

## Working behavior and limits

Preserve the preceding visible-Copies-only inspection repair, selected-task
navigation, indexed paging, complete draft records, package v1/v2/v3, Dexie v2,
offline access guards and cleanup fingerprints. No new table, cache snapshot,
timer, automatic retry or request. The existing combined bounded local read
still fails as one unit; independent-table recovery is outside this batch.
Real account-lock lifecycle and cross-tab mutations remain separate acceptance.

## Implementation status

Report delivered before product edits. A finite tab/page/mode read-result marker
now distinguishes unread, successful and failed views. Matching successful data
can remain visible during refresh, accompanied by a loading status. Mismatched
or failed ledger views, empty claims and pagination are hidden; independent
preference status and existing download/catalog controls remain available.

Storage/resource read feedback is separate from action errors. A successful
read clears only its own error. Local Retry increments the existing refresh
revision and does not refetch the server catalog, sync or resume a download.
A ledger failure advances the inspection sequence, preventing an older asset
promise from restoring ready status. Entering a different scope retires the
old marker before shared ledger fields are republished, so a quick A–B–A return
cannot revive that marker over another scope's data. All stored rows remain untouched.

The shared `scripts/ux/sync-center-hidden-inspection.test.mjs` now also contains
authored, **unexecuted** checks for source-derived scope/view expressions,
initial storage failures on each tab, matching refresh data, failure fencing,
scope-entry marker retirement, retained in-memory data, successful read recovery, the actual Retry callback
and real JSX empty/pagination guards. It extracts the actual effect/helpers;
its inner Dexie read is captured, not run. Controlled setters/emissions,
expressions and JSX ancestry are not mounted React, browser, real storage,
access-lock or performance acceptance. No passing count is asserted.

After authorization, set task-specific TEMP/TMP and run
`node --test scripts/ux/sync-center-hidden-inspection.test.mjs`, relevant gates,
and actual cold/refresh/error/tab/page/mode and background-action acceptance.
No tests/gates, service, browser, build, commit, CI, deployment or performance
measurement ran. The overall goal remains active.
