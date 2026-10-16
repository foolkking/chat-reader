# UX quick review — Share navigation and saved-position retirement

2026-10-15 · pre-edit source evidence; continuation of the ordinary-user goal.

## Scope and evidence

Web app, ordinary visitors reading a public or password-unlocked Share. This
batch concerns its independent complete-turn navigation, saved-position
restoration and token-scoped local readiness. Reading orientation and the
separation of Share visits matter; no content mutation or new authorization
mechanism is proposed. Code facts are observed; rendered consequences are
inferred. This is not an accessibility-conformance or live security assessment.

SEEN: `apps/web/features/sharing/share-readonly-reader.tsx:39–53,73–99,
113–123,143–193,201–352,438–441,515–517,907–920`; the Share route caller,
complete-turn/mounted-target helpers and the Owner Reader retirement precedent.
NOT SEEN: mounted React, real Share transport/unlock/access transitions,
Web Crypto or localStorage failure, browser scrolling/focus/touch, real-device
resources or production. No real tokens or conversation content are recorded.
No tests/gates, services, browser or release are authorized for this batch.

## The things that matter

Share uses a separate navigation callback from Owner Reader. It checks its
token after a neighborhood load but not after optional resolver completion,
lease return, mounted alignment or layout settling. Older success can publish
active/highlight state and older rejection can look like an ordinary failure.
The saved-position candidate loop treats cancellation as a reason to try the
next candidate, so a visitor taking over can start another automatic jump.
The component also retains readiness and the old saved anchor across token
prop changes until the asynchronous new storage-key lookup finishes.
Use the existing token/complete-turn mechanisms and bounded effect cleanup,
not a new navigation system.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| NAV-SHARE-RETIREMENT-01 | Defect / navigation; async state coverage | Medium | Observed (code); rendered consequence Inferred | M |
| NAV-SHARE-RESTORE-01 | Defect / navigation; user control | High | Observed (code); rendered consequence Inferred | M |
| STATE-SHARE-VISIT-01 | Defect / state coverage; visit separation | Medium | Observed (code); retained-instance runtime Inferred | S |

**NAV-SHARE-RETIREMENT-01.** Location: pre-edit
`share-readonly-reader.tsx:201–321`, navigation callback. The optional locator response can lead to a
neighborhood load after a newer navigation has replaced its token. Lease
return goes directly to DOM lookup/alignment. Mounted success publishes active
message/block/highlight before another token check; layout settling can then
return successful completion and schedule an untracked highlight timer.
Unmount has no explicit visit owner for these continuations. A visitor can
receive obsolete orientation or a successful completion after leaving.
Fence admission and each exposed await boundary with a token-scoped visit;
pass the same predicate to leases/alignment/settling, return cancellation for
retired rejection and keep one cleanup-owned highlight timer.

**NAV-SHARE-RESTORE-01.** Location: pre-edit
`share-readonly-reader.tsx:323–352,438–441`, restore effect/manual input.
Restoration iterates all candidate block/message
anchors until `result.ok`, including `reason="cancelled"`. Real input increments
the navigation token, but the next candidate starts a new navigation and can
take over again. Explicit index/TOC choices also do not settle the initial
restore decision before the first-window query succeeds. A visitor can be
pulled back to a remembered passage after deliberately choosing another.
Distinguish restoration from explicit navigation, retain an input/choice
sequence snapshot, stop on cancellation/intent change and guard completion
by the effect's live visit. Preserve legitimate same-intent candidate fallback.

**STATE-SHARE-VISIT-01.** Location: pre-edit
`share-readonly-reader.tsx:39–53,113–123,143–193`, storage/query/reset.
Initial-query enablement/key and restore decisions
use `storageReady`/`savedPosition` without identifying the token visit that
loaded them. The token reset clears windows but not restore-attempt/readiness/
active-highlight state. A retained instance can request the new Share using
an old saved message before the new hashed local key is ready. Tag local
readiness with the token-scoped visit, gate use of that anchor, and reset
ephemeral navigation/restore state on a real token change. Keep the hashed
storage namespace and existing saved bytes unchanged.

## Ordered repair and acceptance

1. Add effect-owned Share visit/token retirement and guarded navigation stage
   boundaries; preserve optional-resolver compatibility and locator payloads.
2. Make explicit navigation settle restoration, while restoration itself
   introduces no user intent. Stop candidate replay after takeover/cancellation.
3. Scope storage-ready anchor use and ephemeral resets to the current visit;
   contain old storage completion without changing the position format.
4. Author actual-extracted-source synthetic cases for stage overlap/retirement,
   timer/lease cleanup, restore interruption/fallback, explicit early choice
   and storage-key visit changes. Leave them unexecuted. After authorization,
   use task-specific TEMP/TMP, run focused/relevant Web gates and real public/
   unlocked Share complete-turn, real-anchor, user takeover, token switch and
   close/reopen acceptance.

## Working behavior and boundaries

Keep Share URLs/access/unlock/expiry policy, the SHA-256 local key, complete
turns, request limits, optional old-server resolver fallback, exact stable DOM
IDs, existing offset/character locator arguments and layout settling.
Release acquired leases even after retirement. No API/schema/package/Dexie,
dependency, subscription or new timer is proposed.

Already-started transport or neighborhood-helper internal work is not
physically aborted. This batch does not accept the navigation sheet's own
close/reopen feedback lifecycle, local storage/crypto failure recovery, edge
loading or password-submit lifecycle. Those remain separate questions.
No browser result or CPU/RSS saving is claimed; the full goal stays active.

## Implemented source checkpoint

The independent Share callback now checks its effect-owned token visit before
admission and after resolver, neighborhood, lease, mounted alignment and layout
settling. Existing helper predicates use the same ownership; retired rejection
returns cancellation. Acquired leases still release in `finally`. The highlight
timer is singly owned and cleared on navigation/cleanup; an old callback cannot
clear a newer highlight. Cleanup increments the navigation token so replaying
the same visit does not revive an old transaction.

Explicit navigation settles the initial restore decision and advances the
existing intent sequence. Restoration uses an optional internal fifth argument,
does not advance that sequence, and stops fallback on cancellation/changed
intent. Its cleanup/live-visit check prevents old completion from marking a new
visit position-ready. Existing candidate ordering/offsets remain.

Storage-ready anchors are tagged by visit and gated at the first-window query
key/enablement and initial apply/restore stages. Token change resets ephemeral
window/restore/active/highlight state. Old async key completion is ignored; the
hashed namespace and saved bytes are unchanged.

The new `scripts/ux/share-navigation-retirement.test.mjs` extracts actual
callbacks/effects/manual intent and helpers for controlled stage overlap,
failure/retirement, lease/timer cleanup, restore fallback/takeover and scoped
storage-key cases. It is authored but **unexecuted**. Hooks/query snapshots,
digest bytes/storage, transport, DOM and alignment are adapters, not real
React/Web Crypto/localStorage/QueryClient/browser acceptance. Current-fact
architecture/flows/state, testing/navigation and document inventory are synced.
No tests/gates, build, services, browser, commit, CI, deployment or CPU/RSS
measurement ran. Formatting-only diff review is recorded separately below.

Formatting-only `git diff --check` over the edited tracked Share source and
six current-fact/navigation/testing/inventory documents exited **0**. Git
reported the existing LF→CRLF working-copy warnings; no normalization was
performed. The new untracked report and regression are not covered by that
command. This is not syntax, type, test or runtime validation.
