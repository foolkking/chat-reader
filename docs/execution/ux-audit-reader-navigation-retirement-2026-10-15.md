# UX quick review — Reader navigation retirement

2026-10-15 · pre-edit source evidence; ordinary-user optimization continuation.

## Scope and evidence

Web app, ordinary readers navigating complete turns through message/index,
search, TOC, annotation or attachment targets. This batch reviews asynchronous
stage boundaries and the current-search previous/next controls. Reading
orientation and truthful recovery are at stake; navigation does not edit
canonical content. This is a narrow code audit, not a rendered usability or
accessibility-conformance assessment.

SEEN: `apps/web/features/conversations/conversation-reader.tsx:126–133,
946–1259,1290–1311,2287–2289,2547–2554`; the complete-turn wrapper,
`reader-navigation.ts:52–123`, existing recent-owner/read-recovery checks and
the readiness/search regression harnesses. Code facts are observed; their
rendered consequences are inferred.

NOT SEEN: mounted React, real transport or Worker scheduling, DOM geometry,
focus/touch/screen-reader behavior, live user failures or CPU/RSS. Existing
source-only acceptance debt remains. No tests/gates, services, browser,
production action or release is authorized for this batch.

## The things that matter

Reader already has a navigation token, and mounted-target alignment accepts
that token's predicate. Several asynchronous boundaries do not consult it
before publishing failures or starting the next stage. The outer rejection
handler can therefore replace a newer navigation's status with an older
failure. Outstanding work also does not use the existing visit/account guard
that metadata recovery already has. Separately, successful previous/next
search completion can restore controls the reader has just dismissed.
The repair should extend existing ownership checks, not replace the locator,
window, virtualization or stable-anchor pipeline.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| ERR-READER-NAVIGATION-01 | Defect / error recovery; state coverage | Medium | Observed (code); rendered consequence Inferred | M |
| NAV-READER-SEARCH-03 | Defect / navigation; dismissal state | Medium | Observed (code); rendered consequence Inferred | S |

**ERR-READER-NAVIGATION-01.** The outer `catch` unconditionally writes
`failed:load-failed`, status and failure reason. After the fallback
`getReaderTurn` await, missing-target/locator-failure branches run before the
next token check. A target-context response can start the complete-turn
neighborhood even after its token was replaced; a returned block lease also
continues to DOM lookup/stage publication before checking ownership.
The nested context catch suppresses some old setters but still returns a
current-looking failure instead of cancellation. Token checks alone also
omit the existing visit/account ownership boundary used by
`ownsReaderReadRecovery`.

A reader can see an obsolete failure after successfully choosing another
passage, or spend work on a stage their newer choice no longer needs.
Extend the existing predicate with the existing visit/account guard, check
admission and each exposed await boundary, and return neutral cancellation
before stale status/stage/cache/locator publication. Retain `finally` lease
release and performance bookkeeping for started work.

**NAV-READER-SEARCH-03.** `navigateSearchResult` captures `searchNavigation`,
awaits navigation and publishes its old context/highlight on success. Footer
Close and "Return to search" clear state without retiring that captured
context. A delayed success can recreate the closed controls. Search state is
also not explicitly cleared for a retained Reader's source/conversation
change. A reader should not have to dismiss the same search twice.
Mirror the current context in a ref through one state publisher, synchronously
clear that identity with both existing dismiss actions, and require matching
context plus current visit before publishing previous/next completion. Clear
search controls on an actual source/conversation visit change, without
discarding the existing ephemeral query/selection return state.

## Ordered repair and acceptance

1. Reuse `ownsReaderReadRecovery` with the existing navigation token; fence
   preflight, context/neighborhood, fallback turn, lease, mount, settling and
   rejection continuations. Do not alter locator decisions or timing budgets.
2. Centralize current-search context publication/clear and fence footer
   completion against a dismissed/replaced context.
3. Author actual-extracted-callback synthetic cases for overlapping success/
   failure, stage/visit/account retirement, lease cleanup, finite current
   failures, search dismiss/replace and source reset. Keep earlier search
   adapter coverage compatible.
4. Leave checks unexecuted. After authorization, run focused navigation/search
   regressions and relevant Web gates under task-specific TEMP/TMP, then real
   remote/offline/Share navigation, rapid changes, failure/retry, dismissal,
   source switch and true-DOM-anchor acceptance.

## What works and what stays unchanged

Keep complete-turn semantics, local exact-version resolution, server-owned
attachment/annotation validation, request payloads, result reasons, window
bounds, navigation intent versus user scroll, block leases, locator remapping,
stable real DOM anchors, layout settling and locate-pulse behavior. Preserve
all stored data, Share URLs, offline packages and Dexie contracts.

Ownership retirement is not an AbortController or physical cancellation:
already-started transport and a neighborhood helper's internal work may still
finish. Guards can prevent only their caller's next stage/publication. Footer
duplicate-click coalescing, visual/focus behavior and resource savings are
not claimed. Those require separate evidence; the full goal remains active.

## Scope-reset refinement evidence

Before refining the reset implementation: `resolvedLocatorKeysRef` is a
Reader-instance Set, consulted to skip repeat annotation validation, with no
source/conversation clear in the pre-edit code. A retained Reader should not
carry that validation admission into another source visit. Clear it only on
the existing source/conversation reset. Also invalidate the navigation token
in that reset's cleanup: the existing active-owner boolean can become active
again during effect replay, whereas a started transaction's old token must
stay retired. No request abort or broad cache reset is proposed.

## Implemented source checkpoint

- Reused the existing visit/account guard with navigation token ownership,
  including retired admission, context/neighborhood/fallback-turn results,
  post-lease continuation, mounted/settle/pulse predicates and both rejection
  handlers. Old context completion cannot begin a caller neighborhood stage
  or remember a validated annotation locator after retirement.
- Preserved all result classifications for current failures, locator rules,
  alignment/settle budgets and lease release. Started-work performance
  bookkeeping remains; token-only in-progress cleanup cannot clear a newer
  token, including when a visit has retired.
- Search context now has one state/ref publisher and synchronous clear used
  by both footer dismiss actions. Current-context identity and visit ownership
  fence previous/next admission/completion. A source/conversation layout
  reset clears obsolete search, failure/retry target and pulse/timer state,
  plus per-source annotation-validation memory, but not the panel's existing
  ephemeral query/selection. Cleanup increments the token so reactivating the
  same owner cannot revive an old started transaction.
- `scripts/ux/reader-navigation-retirement.test.mjs` is authored and the
  existing selection harness is adapted for the publication callback.
  Both remain **unexecuted**. They adapt actual source, not mounted React,
  real transport, physical cancellation, DOM geometry or device resources.
  Proposed reset cases include source/conversation validation clear and
  cleanup/setup replay of the same owner. The older readiness regression
  was not rerun.
- Current state, architecture, flows, navigation, testing and document
  inventory are synchronized. No tests/gates, services, browser, build,
  production action, commit, CI, deployment or resource measurement ran.
  The overall ordinary-user optimization goal remains active.

Formatting evidence: `git diff --check` for the edited tracked Reader and
current-fact documents returned 0 with no whitespace errors. Existing
LF→CRLF warnings remain; no normalization was performed. This does not
include the untracked report/regression files and is not behavioral
validation.
