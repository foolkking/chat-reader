# UX quick review — sync-center tab-owned local reads

2026-10-15 · source review before product edits.

## Scope and evidence

Continuation of the full ordinary-reader UX goal. Platform: Web app; audience:
mainstream readers opening Offline & sync center. This batch covers which local
queries each visible tab starts, not storage format, admission, sync or cleanup.
The preceding hidden-inspection and read-state repairs remain in force.

SEEN: the complete center local-read effect and downstream tab/action consumers;
`listOfflineDownloads` in `apps/web/lib/offline-downloads.ts:26–29`; existing
indexed retained-copy existence checks. Pre-edit center Git blob:
`31d0aef4a6d94e95415427f621674bc25543c6b8`.
NOT SEEN: real Dexie subscriptions/faults, React transitions, device CPU/RSS,
cache bytes, latency, browser focus or account-lock lifecycle. Code facts are
observed; user-visible effects and resource benefit are inferred, not measured.
This is not full-settings or accessibility acceptance.

## What matters

The previous repair stops hidden attachment inspection, but every visible tab
still awaits all twelve local reads. Copies reads unrelated pending operations,
failed operations, conflict markers and two draft prefixes. Pending reads
conversation bodies and download records it normally does not display.
Failures reads the current conversation page and hidden drafts. Narrowing reads
to their visible owner prevents an unrelated read failure from blocking that
view and avoids observing unrelated changes through that read set.

## Finding and quick win

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| ERR-SYNC-CENTER-02 | Defect / error recovery; perceived performance | Medium | Observed (code); rendering/resource effect Inferred | S |

**Evidence/location.** `offline-sync-center.tsx:95–112` unconditionally awaits
the conversation count/page, downloads, pending page/count, conflicts, failed
page/count and both draft page/count pairs. The `Promise.all` rejects as a unit.
Copies uses conversation rows/count and download state (`253–267`); Pending
uses operations, notebook/continuation drafts and conflict presence for Export
(`268–278`); Failures uses downloads, conflict markers, failed operations and
scoped copy existence (`279–283`). Initial-job navigation and its persistent
download card are an intentional cross-tab consumer and must keep reading tasks.

**Why it matters.** Someone reviewing a saved copy should not lose that view
because an unused draft or pending-operation query fails. Someone reviewing
unsynced edits should not read full conversation rows merely to render their
operation list. Changes observed only through those unused queries can also
repeat the combined query and, on Copies, attachment verification. No actual
re-query count, speedup, memory or CPU reduction has been measured.

**Recommendation.** Keep the existing subscription/result shape but start only
tab-owned queries. Use neutral placeholders only for hidden fields, never as
successful data for a displayed failed read. Retain task reads on Copies,
Failures and every initial-job entry, including Pending. Retention wording on
Failures must still use matching conversation/project existence; query any-copy
existence only when an all-scope task on the displayed failure page needs it.
Do not fetch a conversation page for Failures or any conversation for Pending.

**Local precedent.** The same effect already scopes retained-copy checks to the
visible failure page and asset inspection to Copies. The read-state marker
already hides other-scope ledger rows until that scope succeeds. Cleanup reads
a fresh pending snapshot and checks its fingerprint; it must not rely on the
hidden placeholder values.

## Ordered repair and acceptance

1. Add tab conditions to the existing reads; preserve sort, offsets, limits,
   query keys/prefixes and task-target navigation. Keep conflict presence on
   Pending for Export eligibility.
2. Reuse the indexed existence check for scoped failures and one bounded
   any-copy existence read for all-scope failures on the displayed page.
3. Author a source-extracted inner-reader suite with synthetic chainable DB
   adapters and an explicit download-list adapter. Cover forbidden hidden reads,
   visible failures, paging, prefixes, initial-job task reads and retained-copy
   scope. Do not execute it in this source-only batch.
4. After authorization, run both the inner-reader suite and preceding
   effect/view suite, relevant gates, then real Dexie dependency/failure and
   tab/task/cleanup navigation acceptance.

## Working behavior and limits

Preserve local loading/error/empty distinctions, read-only Retry, late-result
guards, initial task association, modes, global managers, dirty guards and
fingerprint-protected mutations. No new helper architecture, watcher, timer,
cache snapshot, request, dependency, schema or stored-data change. Package
v1/v2/v3 and Dexie v2 compatibility remain.

Required reads within one displayed view still fail as a unit. Partial recovery
between visible sections, optional retained-copy read errors and repeated
inspection triggered by relevant Copies/download updates are not solved here.
Real lock, cross-tab, focus and device-resource acceptance remains outstanding.

## Implementation status

Report delivered before product changes. The local `liveQuery` reader now
conditions existing Dexie reads on the visible tab. Copies keeps conversation
page/count and download tasks; Pending keeps outbox operations/count, conflict
markers and both draft prefixes; Failures keeps download tasks, conflict
markers and failed outbox rows/count. Failures performs only bounded displayed
scope-existence checks, including a `toCollection().limit(1)` check for an
all-scope task. An initial-job entry keeps task reads even on Pending.

Existing offsets, limits, ordering, result shape, task targeting, local
read-state marker, Retry, visible asset inspection, global managers and
mutations remain. Hidden values are neutral placeholders and are not published
as successful displayed data. `scripts/ux/sync-center-tab-read-scope.test.mjs`
contains authored, **unexecuted** checks that extract the actual reader and
exercise synthetic chainable Dexie adapters for hidden/visible tables, failure
retention, all-scope existence, initial-job reads and paging. It does not run
Dexie, React, browser subscriptions or resource measurements.

After authorization, set task-specific TEMP/TMP and run the new inner-reader
suite together with `scripts/ux/sync-center-hidden-inspection.test.mjs`,
relevant gates, then real tab/task/cleanup/error and cross-tab acceptance.
No tests/gates, service, browser, build, commit, CI, deployment or performance
measurement ran. The overall goal stays active.
