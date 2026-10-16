# UX quick review — hidden offline-copy inspection

2026-10-15 · source-only review before product edits.

## Scope and evidence

Continuation of the full ordinary-user UX goal. Platform: Web app; audience:
ordinary readers using Settings / Offline & sync center. Scope: background local
ledger subscriptions and copy-asset inspections while Pending edits, Failures &
conflicts, a conflict comparison or protected cleanup subview is displayed.
Download/sync managers, recovery actions and storage/cache policy are not redesigned.

SEEN: the complete local-read effect in `components/offline-sync-center.tsx`,
its dependencies and conditional tab/subview rendering, plus the actual
`inspectOfflineCopyAssets` and `readVerifiedCachedAttachment` helpers.
NOT SEEN: a running center, actual cache bytes, device timings/CPU/RSS, touch,
focus, physical storage errors or incidence. This is a narrow performance/state
audit, not full settings or accessibility acceptance.

Pre-edit center Git blob: `c2425cd859bee81435e011f067a1eed14f5ead64`.

## What matters

The center's local ledger refresh always inspects the current copy page, even
when its asset counts are not displayed. This is more than a cheap count:
each conversation's attachment loop checks cached responses and materializes
Blobs for size validation. Pending changes can trigger the combined live query
again, repeating unrelated work. The same parent subscription remains active
when the entire center is replaced by conflict or cleanup UI. Limit new work to
the visible owner, without changing the verification performed for visible copies.

## Finding

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| PERF-SYNC-CENTER-01 | Defect / perceived performance; feedback scope | Medium | Observed (code); device cost/presentation Inferred | S |

**Location/evidence:** `offline-sync-center.tsx:79–135` subscribes on every tab
and unconditionally calls `Promise.all(data.rows.map(...inspectOfflineCopyAssets))`.
Asset counts are consumed only by the Copies view (`230–245`). The component's
early returns for conflict and cleanup (`193–200`) do not stop that earlier hook.
At `offline-db.ts:916–931`, inspection traverses each conversation's attachments.
`readVerifiedCachedAttachment:894–914` opens Cache Storage, matches candidate
responses and calls `response.clone().blob()` for size checks.

**Why it matters:** someone reviewing unsynced edits or a conflict pays for
unrelated attachment reads. A resource-check error can also appear in a view
where no copy resource check is visible. Large cached originals can amplify the
cost, but no magnitude, speedup or memory reduction has been measured here.

**Recommendation:** preserve ledger subscriptions for the three visible center
tabs, but only inspect assets on Copies. Pending/Failures publish their existing
ledger fields and settle loading without asset inspection. Suspend the parent
ledger subscription while a conflict/cleanup subview replaces it; returning
creates a fresh normal subscription. Preserve existing active/sequence guards
for late completions and initial task-target navigation. Already-started
inspections cannot be actively cancelled by these helpers; do not claim otherwise.

**Local precedent:** the same effect already computes retained-copy availability
only for the visible Failures page (`96–102`). The earlier
[attachment lazy-loading repair](ux-audit-attachment-image-lazy-loading-2026-10-14.md)
likewise avoids asset work for unseen items without disabling visible behavior.

## Ordered repair and acceptance

1. Gate the existing effect on replacement subviews, and the inspection branch
   on Copies. No new watcher, cache snapshot, timer or helper abstraction.
2. Author unexecuted checks against the real extracted effect with controlled
   live-query emissions, state setters and inspection promises. Cover every tab,
   both replacement subviews, return/reinspection, late/superseded completion,
   empty copies and initial task navigation.
3. Later authorized validation must run regressions/gates and observe actual
   settings navigation, downloads, conflict/cleanup return and resource use.
   Source/adapters are not browser or Cache Storage acceptance.

## Working behavior and limits

Keep paging, counts, manual Refresh, catalog policy, task mapping, dirty guards,
cleanup fingerprints and mutations unchanged. Global download/sync work continues
when this parent subscription is paused. Visible Copies retains its existing
mode-specific inspection, including the helper's existing invalid-size cache
entry rejection/removal. No validation policy, original byte, package v1/v2/v3,
Dexie v2, API, schema, dependency or deployment change.

The combined bounded local-ledger read still observes multiple tables; independent
read-failure recovery and repeated inspection while Copies is actually visible
are outside this repair. No full settings optimization claim is made.

## Implementation status

Report delivered before product edits. The existing effect now skips subscription
when conflict/cleanup replaces the parent, and includes those owners in its
dependencies so returning resubscribes. Pending/Failures publish their existing
ledgers and settle loading without invoking asset inspection. Copies retains the
existing mode, active/sequence guards and initial-task navigation.

`scripts/ux/sync-center-hidden-inspection.test.mjs` contains authored,
**unexecuted** checks against the actual extracted effect and task helpers.
Controlled emissions cover the three tabs, both subviews, a fresh visible owner,
empty/error results, late/superseded completion, initial task navigation and
dependency preservation. The inner Dexie read is captured, not executed; separate
fixtures do not mount React or prove a real subview transition. Cache Storage,
Blob cost, global managers and focus remain outside that adapter evidence.

After authorization, set task-specific TEMP/TMP and run
`node --test scripts/ux/sync-center-hidden-inspection.test.mjs`, relevant gates,
then actual navigation, task/cleanup return and device resource acceptance.
No test/gate, service, browser, build, commit, CI, deployment or performance
measurement ran. The overall goal stays active.

Subsequent [local read-state follow-up](ux-audit-sync-center-read-states-2026-10-15.md)
extends the same authored suite and adds scoped read feedback to the effect.
That later source-only work preserves this inspection ownership boundary; it
does not turn either batch into runtime acceptance.
