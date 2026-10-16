# UX quick review — conversation search occurrence selection

2026-10-15 · source evidence recorded before this batch's product edits.

## Scope and evidence

Continuation of the full ordinary-user goal. Web app; ordinary readers using
current-conversation search, including Offline Reader. Scope: selection of a
specific match across a same-query refresh and return to the search panel.
Search transport/ranking, complete-turn navigation and DOM anchors are not
redesigned. Wrong selection costs reading orientation, not stored content.

SEEN: `features/search/conversation-search-panel.tsx:25–29,69–84,107–136,158–161`,
the global and sidebar selection precedents, the Reader's two panel callers
and navigation adapter, `SearchResultItem`/`SearchMatch`, offline match mapping,
the existing retry adapter regression and reference-search browser scenario.
NOT SEEN: mounted React, live search ordering, keyboard/focus, phone gestures,
actual navigation/scrolling, browser or device resources. Facts about source
are observed; rendered consequences are inferred. No accessibility-conformance
or measured performance claim is made. Evidence uses no user content.

## Finding

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| NAV-CONVERSATION-SEARCH-01 | Defect / navigation; selection state | Medium | Observed (code); rendered consequence Inferred | S |

**Evidence.** The panel stores `activeIndex` and clamps it to the current result
length. Arrow keys update the stored numeric index, while Enter and highlight
use the clamped index. If a deliberately selected match B moves in a refresh
from `[A, B]` to `[B, A]`, Enter now opens A. If B disappears, clamping silently
selects another match. If a high stored index is clamped after shrink, ArrowUp
decrements the obsolete index rather than the currently visible selection.
One search document can contain multiple match ranges, so `document_id` alone
would still confuse different matches within that document. Touch/click
activation also does not itself update selection; only mouse-enter does.

**Why it matters.** A reader can jump to a different passage than the one they
selected, or need repeated arrow presses before the highlight moves. Returning
to search after tapping a match can restore a different row. The result list
remains usable by direct selection, so this is Medium rather than a core-flow
Blocker.

**Recommendation.** Retain an explicitly selected occurrence identity using
its document/message/version and exact block/range/quote locator. Derive its
current visible index rather than substituting another row. If it disappears,
show a brief neutral notice; Enter must not navigate until the reader chooses
again. Arrows restart from the visible selection or first row. Keep the first
row/numeric restore behavior for initial state without an identity. Clear the
explicit identity for query/role/type changes. Include the optional identity
in the existing ephemeral panel-state callback, publishing the activated target
before waiting for navigation so touch activation can survive immediate close.

## Ordered repair and acceptance

1. Extend only ephemeral search selection/state; use the existing global/sidebar
   identity-selection precedent, with occurrence-level identity here.
2. Author actual-component synthetic regressions for document and within-document
   match reorder, removal/shrink, arrows, tap/return restore, legacy initial
   index, query/filter reset, debounce/IME and exact navigation context.
3. The original source-only plan was continued on 2026-10-16: run the focused
   component regression and targeted Web checks, while keeping mounted-browser,
   service and full-suite acceptance explicitly outside this local boundary.

## Working behavior and explicit boundaries

Keep the 220 ms debounce, 50-document request, matches and result order,
query keys, retry preparation, local `always`/remote inherited policy, IME/
typed-query guards, navigation target/context fields and true DOM anchor
transaction. No service, new subscription, timer, corpus, persistence key,
package, API, schema, dependency or deployment change is proposed.

The separate async navigation-completion/close lifecycle is outside this
selection repair; reading it here does not prove browser cancellation or
retired-navigation behavior. Resource cost and real refresh incidence remain
unmeasured. The full goal and previous source-only acceptance debt remain open.

## Implemented source checkpoint

- The existing memoized occurrence projection now assigns a locator identity.
  Explicit keyboard/hover/activation selection resolves that identity against
  current results, including multiple matches within one document. No additional
  search, timer, subscription or corpus is introduced.
- Missing explicit selections have no replacement highlight/Enter target and
  show localized neutral guidance after a successful, non-fetching result.
  Arrows use the visible index or restart at the first available row. Query/
  role/type changes clear explicit identity; legacy numeric initial state keeps
  its default/clamped restore behavior.
- Optional `activeOccurrenceKey` extends only the existing ephemeral panel-state
  callback. Activation publishes the chosen identity before awaiting navigation;
  the Reader's existing two callers need no new storage or protocol.
- `scripts/ux/conversation-search-selection.test.mjs` was run on
  2026-10-16: **48 passed / 0 failed / 0 skipped**. It transpiles the real
  component with explicit hook, query-result, timer and navigation adapters.
  The run covers reorder within/across documents, removal/shrink, notice
  gating, arrows, activation/return, initial compatibility, scope edits/IME,
  locator versus context changes and the existing exact/fallback targets and
  offline mode. It does not claim search transport, React mounting,
  focus/touch, scrolling or resource acceptance.
- Current project state, frontend architecture, user flows, navigation,
  testing guide and documentation inventory are synchronized. The targeted
  ESLint, nonincremental Web typecheck and `git diff --check` also passed.
  No service, login, build, full API/PWA suite, product browser, production
  action, commit, CI, deployment or CPU/RSS measurement ran. The full
  ordinary-user goal remains active.

## Continuation verification — 2026-10-16

The focused result is recorded in
`ux-audit-conversation-search-selection-2026-10-15-evidence/`:
`48/48` controlled-component cases passed; targeted ESLint, nonincremental
Web typecheck and `git diff --check` returned exit code 0. The test uses the
actual compiled panel and the extracted Reader publication/activation adapter,
but does not establish mounted React, a live QueryClient/API/Worker, browser
keyboard/focus/touch/scroll behavior or resource measurements. The separate
navigation-lifecycle report remains independently unexecuted; this result
must not be reused as its full browser or cancellation acceptance.

Existing LF→CRLF warnings remain; no line-ending normalization was performed.
