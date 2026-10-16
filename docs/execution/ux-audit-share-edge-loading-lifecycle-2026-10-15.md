# UX quick review — Share edge-window loading lifecycle

2026-10-15 · pre-edit source evidence. Full ordinary-user goal remains active.

## Scope and evidence

Mainstream responsive Web, the public Share reader's previous/next complete-turn
window loading after a real scroll reaches an edge. This is a lifecycle fence,
not a change to turn-window sizing, scroll-anchor semantics, API access or
network cancellation.

SEEN: `apps/web/features/sharing/share-readonly-reader.tsx:247–280,
679–698,835–937`; the existing Share navigation-retirement source regression
and current complete-turn/real-DOM anchor helpers. NOT SEEN: mounted React,
actual slow edge response, unmount timing, browser scroll geometry, network
transport, CPU/RSS or screen-reader output. Branch facts are Observed (code);
visible timing consequences and frequency are Inferred. Tests/gates, services,
browser operation and release remain off.

## Executive summary

The edge loaders already serialize opposite-direction requests and protect
normal merge/anchor restoration with a generation and direction predicate.
That predicate does not include the visit's active lifetime. If a Share reader
unmounts while an edge request is pending, its later completion can still
capture the document, merge a window, notify layout and restore an anchor
through the old closure. The error branch also checks only generation, so a
same-visit request abandoned by a direction reversal can publish an obsolete
edge error. Add the existing visit identity to the transition predicate and
use that same predicate for error publication; keep already-started requests
uncancelled and preserve current window/anchor behavior.

## Finding and quick win

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-SHARE-EDGE-01 | Defect / state coverage; feedback | Medium | Observed (code); runtime consequence Inferred | S |

**STATE-SHARE-EDGE-01.** Pre-edit locations: `loadPreviousPage:835–884`
and `loadNextPage:888–937`. `transitionIsCurrent` accepts a completion when
the captured generation and direction still match, but it does not require
`navigationVisit.active`; the catch branch checks generation alone. A pending
edge read can therefore finish after the reader has left the page and still
attempt DOM capture/window publication/anchor restoration, or show an
old “earlier/later” failure after the user reverses direction. The reader may
receive late layout work or feedback for content the visitor is no longer
reading. Require the current active visit in the predicate, use it for the
catch branch, and avoid publishing final loading state after the visit retires.

## Ordered repair and acceptance

1. Add `navigationVisit.active` to both transition predicates; guard stale
   error and final loading publication with the same visit/transition owner.
   Keep merge order, complete-turn requests, lease release, anchor capture/
  restore and no-abort policy unchanged.
2. Author an extracted-source regression for unmount completion/rejection,
   same-visit direction reversal, current previous/next success/failure,
   anchor-lease release and a new visit not being touched by the old finally.
   Do not execute it.
3. After authorization, run focused Share/Web checks with task TEMP/TMP, then
   browser slow-response, scroll-reversal, unmount and real-anchor acceptance.
   Source adapters do not prove DOM or network timing behavior.

## What stays and open questions

No new timer, retry, abort, query key, API, storage, Share URL, position format,
turn-window count, virtualization policy or dependency. A sent request remains
in flight and server effects are not reversed. This does not settle browser
scroll geometry, whether users commonly reverse direction during a slow read,
or CPU/RSS impact; those remain open runtime questions.

## Implemented source checkpoint

Both edge loaders now require the active token visit in their transition
predicate, alongside the existing generation and direction checks. The catch
branch uses that same predicate, so a retired or reversed request cannot
publish stale edge failure. The final loading-state setter is skipped after
visit retirement, while local loading refs and any acquired anchor lease still
settle/release. Complete-turn fetching, merge/trim order, real-DOM anchor
capture/restoration and no-abort behavior are unchanged.

`scripts/ux/share-edge-loading-lifecycle.test.mjs` is authored but
**unexecuted**. It extracts both actual nested loaders and covers current
success, post-retirement completion/rejection, same-visit direction reversal,
stale-error suppression and existing merge/finalization bookkeeping. This is
not mounted React, browser scroll, network timing or resource evidence.

## Continuation finding before edit — 2026-10-16

**STATE-SHARE-EDGE-02 · Retired edge callbacks still start a read.**
Dimension: state coverage / perceived performance. Severity: **Medium**.
Confidence: **Observed (code); mounted event reachability Inferred**. Effort: S.
Current `share-readonly-reader.tsx:835–852,891–908` checks the visit after the
await, but the entry guards check only local loading/window flags. A captured
callback invoked after `navigationVisit.active = false` can still set loading,
clear feedback and issue a complete-turn read before the completion fence stops
publication. A visitor who already left the reader should not incur that
obsolete read or state work. Add the same active-visit predicate to entry,
without cancelling requests that were already sent.

Add extracted actual-loader tests for both retired entry callbacks (zero
transport, loading, feedback or DOM work), plus current-direction failure as a
positive control. Preserve the existing post-await retirement/reversal tests;
distinguish the legitimate initial `setEdgeError(null)` from a late error.
The service-free baseline also exposed outdated adapter expectations for that
initial clear; repairing those expectations is not a product behavior change.

The added actual-loader baseline reproduced both retired-entry reads
(**7 passed / 2 failed**). Both entry guards now reject inactive visits before
changing loading/error state or calling the loader. The positive current-failure
cases still emit the appropriate previous/next recovery state. Full local
continuation results are owned by the
[service-free regression record](ux-audit-service-free-regression-2026-10-16.md);
this does not imply mounted/browser acceptance.
