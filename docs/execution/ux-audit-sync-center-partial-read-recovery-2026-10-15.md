# UX quick review — sync-center partial local reads

2026-10-15 · source-only review, before product edits.

## Scope and evidence

Continuation of the ordinary-reader UX goal. The scope is the existing
Offline & sync center local-ledger subscription after its tab-owned read
scoping and read-state repairs. This batch does not change IndexedDB schema,
download admission, synchronization, cleanup, pagination or package
compatibility.

SEEN: `apps/web/components/offline-sync-center.tsx` local `liveQuery` effect,
tab-specific reads, read-state marker, asset inspection and all three tab
render branches; the preceding sync-center reports and current offline
contracts. Code facts are observed; rendered timing and storage behavior are
inferred. No service, browser, real Dexie failure, device timing or CPU/RSS
measurement was used.

## Finding recorded before product edits

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| ERR-SYNC-CENTER-03 | Defect / error recovery; result ownership | Medium | Observed (code); partial-render effect Inferred | M |

### ERR-SYNC-CENTER-03 — One local-table failure blanks unrelated visible sections

Location: `apps/web/components/offline-sync-center.tsx`, the pre-edit tab-scoped
`liveQuery` callback and shared `Promise.all` result. The current replacement is
at `apps/web/components/offline-sync-center.tsx:120–171` after the separate
inspection-scheduling follow-up.

The current reader still awaits the visible tab's conversation rows/count,
download task records, outbox rows/count, conflict markers, failed rows/count
and draft rows/count as one aggregate promise. A failure in one of those
required reads rejects the subscription before successful sibling reads are
published. The single `localRead` marker then hides the entire tab and offers
one retry. For example, a pending-edits row read cannot be shown when a
draft-prefix read fails, and readable offline copies cannot be shown when the
download-status prefix is temporarily unreadable.

This is distinct from the already repaired hidden-read scope: the queries are
now selected for the visible tab, but the selected queries still fail as one
unit. Users lose usable information and may infer that no local work exists,
even though only one section was unavailable.

### Recommended repair

Keep the existing tab-owned query set and row payloads, but settle each
visible section independently. Publish successful sibling results after
settlement in the same local subscription, retain old in-memory data without marking it
current for a new scope, and record failed section names in the current
read-state marker. Gate each section's empty claim and pagination on its own
successful read. Keep one localized local-read alert and the existing
read-only Retry; retry only reopens the local subscription and never syncs,
downloads, cancels or mutates stored data.

The initial-task deep link remains gated on a successful download-status read,
because resolving it from a failed task read would misreport “no matching
download”. Asset inspection remains a separate `Copies`-only failure and
continues to fence late promises.

## Acceptance boundaries

The source regression will use synthetic, non-user data and inspect the actual
component source/helpers. It will cover one successful section plus one failed
section, no false empty state, current-scope gating, initial-task protection,
asset-error preservation and the existing local Retry callback. It is authored
but intentionally unexecuted under the current no-test/no-service boundary.

No API, worker, database, migration, offline package, Share URL, `.cr` format,
Dexie version, DOM anchor or synchronization contract is changed. Browser,
focus, real IndexedDB, cross-tab and device-resource acceptance remain
unverified.

## Implementation record

- The existing subscription now catches synchronous and asynchronous failures
  per visible section. Successful siblings are still published; failed reads
  retain old in-memory values without presenting those rows as current.
- Scoped failed-section names drive bilingual missing-section feedback.
  Render/empty guards are per owner; shared count clamping/paging waits for
  every contributing read. A confirmed Copies count can still clamp its own
  page when the unrelated download-status read fails.
- Initial task lookup cannot resolve a failed read as a missing record, and
  stops announcing “Finding…” while the local-read error is shown. Existing
  task matching, user-intent focus protection and action callbacks remain.
- Asset failures retain their specific feedback even when another local read
  fails. Existing sequence/unmount guards remain. Cleanup requires confirmed
  download status; combined pending export requires its full local read scope.
- Updated `scripts/ux/sync-center-tab-read-scope.test.mjs` and
  `scripts/ux/sync-center-hidden-inspection.test.mjs` rather than leaving old
  fixtures/guards incompatible. All cases remain **unexecuted**.

## What's working and left alone

The prior tab-owned read selection and Copies-only asset inspection are kept.
No new background loop, subscription per section, dependency or storage format
is introduced. Download, sync, conflict resolution and protected cleanup
continue to use their existing managers and mutation functions.

## Remaining acceptance

Run the two updated regressions, relevant Web gates and real storage/browser
partial-failure, recovery, paging, task-link, cleanup and export scenarios only
after authorization. `git diff --check` on the edited tracked files reported
no whitespace errors; Git emitted its existing LF/CRLF warnings and no line
ending normalization was performed. Source inspection and that formatting
check do not verify types, runtime behavior or performance.
