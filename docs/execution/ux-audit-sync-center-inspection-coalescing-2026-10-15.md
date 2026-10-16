# UX quick review — overlapping visible-copy inspections

2026-10-15 · source-only review, recorded before product edits.

## Scope and evidence

Continuation of the ordinary-reader UX goal, focused on the existing visible
Copies page in Offline & sync center. Platform: Web app; audience: ordinary
readers. The scope is scheduling repeated resource checks within one mounted
local subscription, not caching verification results or changing download,
cleanup, access, package or background-manager policy.

SEEN: `apps/web/components/offline-sync-center.tsx:159–213` starts a new
page-wide `Promise.all` for every successful Copies emission and uses an
inspection sequence only to reject stale publication.
`apps/web/lib/offline-downloads.ts:153–174,261–278` writes task progress through
the settings store during its existing loop.
`apps/web/lib/offline-db.ts:894–933` verifies each conversation's cached
attachment responses and materializes response Blobs for size checks.
NOT SEEN: live emissions, actual cached bytes, device CPU/RSS, latency, browser
focus or real IndexedDB/Cache Storage failure. No accessibility or measured
performance claim follows.

## Finding

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| PERF-SYNC-CENTER-02 | Defect / resource scheduling; perceived performance | Medium | Observed (code); incidence/device cost Inferred | S |

**Evidence.** A later emission increments `inspection` and starts another
`inspectOfflineCopyAssets` call for every row even if the preceding page scan
is still awaiting cache responses. The earlier promises continue running;
their sequence check only prevents `setCopies`. Progress changes belong to
the same visible-tab query, so repeated task updates can supply this trigger.
Moreover, `Promise.all` rejects before outstanding sibling inspections finish.

**Why it matters.** A reader keeping Copies open while a download progresses
can pay for simultaneous scans of the same originals without receiving any
additional current result. Slow or large cached responses can amplify that
work. This is an unnecessary scheduling path, not a measured memory leak or a
quantified performance regression.

**Recommendation.** Keep one active page inspection and one replaceable latest
pending inspection per effect lifetime. Coalesce intermediate emissions rather
than starting every page concurrently. Wait for every started sibling to
settle before draining the next page, including after one rejects. Preserve
the actual verifier, row order, mode, partial-read feedback, sequence checks
and manual Refresh. Retire queued work on failed ledger reads, task/page
navigation returns and effect cleanup; already-started helper calls cannot be
actively cancelled. Do not add timers, watchers, persistent caches or retries.

## Ordered repair and acceptance

1. Add the small effect-local drain and latest-pending slot. Keep existing
   per-page row bounds and task/ledger publication.
2. Update the existing extracted-effect regression for serialized latest
   publication; author burst, retired queue, failed-sibling settlement and
   recovery cases with synthetic promises. Leave them unexecuted under the
   current boundary.
3. After authorization, run both sync-center Node files and relevant Web gates,
   then observe real progress/Refresh, tab/subview changes, failures, cache
   validation and device resources. Source scheduling bounds are not browser
   or CPU/RSS acceptance.

## What's working and left alone

Keep tab-owned reads, per-section error recovery, Copies-only verification,
initial-task targeting, user-intent focus guards, protected cleanup and all
download/sync managers. No verifier result is reused as a cache, and no bytes,
Dexie version, offline package v1/v2/v3, API, schema or dependency changes.
Different retired/current effect lifetimes can still overlap until already
started work settles; this repair does not claim global cancellation.

## Implementation status

Report delivered before product edits. The effect now owns a single running
drain and a replaceable pending callback. Each new emission retires its
predecessor's pending work before any navigation/failure return. The page scan
uses `Promise.allSettled`, then preserves the existing all-or-error asset
publication. Subscription failure and cleanup clear the pending slot; the
existing active/sequence conditions still reject stale results.

The existing `scripts/ux/sync-center-hidden-inspection.test.mjs` is updated
with the new scheduling expectations and synthetic burst, retired queue,
page-clamp and failed-sibling settlement cases. It remains **unexecuted**;
there is no test, service, browser, build, CI, deployment or device measurement
evidence for this batch.

The edited tracked files also passed `git diff --check` (existing LF/CRLF
warnings only; no normalization). This is a formatting check, not TypeScript,
test, browser or performance acceptance.
