# UX quick review — conversation-search navigation lifecycle

2026-10-15 · pre-edit source evidence; continuation of the ordinary-user goal.

## Scope and evidence

Web app, ordinary readers using current-conversation search, including its
offline data source. This narrow review concerns activation admission,
completion feedback, panel closure and search-context/highlight publication.
It follows the occurrence-selection repair without replacing it. Navigation
is read-only; the stakes are reading orientation, not stored-content loss.

SEEN: `apps/web/features/search/conversation-search-panel.tsx:48–63,134–150,
154–165,183–187`; `apps/web/features/conversations/conversation-reader.tsx:
946–1259,1264–1289,2739–2741,2762–2766`; `NavigationResult`; the utility
drawer/sheet visibility behavior; existing selection and offline-retry
regression adapters. Source facts are observed; rendered consequences are
inferred.

NOT SEEN: mounted React, actual QueryClient/Worker/API navigation, keyboard or
touch timing, screen-reader announcements, focus restoration, real DOM
scrolling, browser/device resource measurements or production. No browser,
tests/gates or service will run in this source-only batch. No accessibility
conformance or active network/scroll cancellation claim is made.

## The things that matter

An older successful activation can close a search panel whose query has
changed or whose newer activation is still pending. The Reader also publishes that completion's
search context and highlight without consulting the panel's current intent.
Rejected navigation has no panel-owned recovery feedback. Repeated activation
of the same pending match starts the same work again. Existing Reader tokens
already retire older navigation when another Reader navigation begins, so
the proposed repair should complement that mechanism, not replace it.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- | --- |
| NAV-CONVERSATION-SEARCH-02 | Defect / navigation; error prevention | Medium | Observed (code); rendered consequence Inferred | M |
| FBK-CONVERSATION-SEARCH-01 | Defect / system status; error recovery | Medium | Observed (code); rendered consequence Inferred | S |
| PERF-CONVERSATION-SEARCH-01 | Defect / activation admission | Medium | Observed (code); resource consequence unmeasured | S |

**NAV-CONVERSATION-SEARCH-02.** `activate` awaits `onNavigate` then calls
`onClose` for every successful result, with no intent or visit check.
`handleSearchNavigate` similarly publishes context/highlight after success.
The desktop drawer's `active=false` hides rather than unmounts its children
while the source editor is open. A reader can lose a newly edited search
surface or receive obsolete search controls. Retain an effect-owned scope
covering the raw query, filters, source/conversation and active visibility;
retire it on close/unmount and let only the latest activation publish/close.
Pass an optional ownership predicate to the Reader adapter so publication
uses the same fence. Leave the begun Reader navigation transaction intact.

**FBK-CONVERSATION-SEARCH-01.** Click/Enter discard the activation promise with
`void`; `activate` has no catch or local pending/failure state. A rejected
navigation therefore has no panel-owned explanation or safe retry direction.
Keep the list usable, show localized "Locating match…" status while the current
activation waits, contain rejection and non-cancelled failure, and advise
retrying the match or choosing another. Cancellation is not an error. Do not
display raw thrown text or replay navigation automatically.

**PERF-CONVERSATION-SEARCH-01.** Every repeated click/Enter maps the full target
list and calls navigation again, even for the same still-pending occurrence.
A reader who repeats an apparently ignored tap can restart locator work.
Coalesce only the current pending occurrence before context construction.
Permit a different match to supersede it; do not globally disable navigation,
cache outcomes or claim measured CPU/RSS improvement.

## Ordered repair and acceptance

1. Fence panel completion and Reader search publication with the same scoped
   ownership predicate; explicitly retire hidden desktop search.
2. Add finite bilingual pending/failure feedback and same-pending-match
   admission protection, retaining occurrence selection and exact locators.
3. Extend the actual-component synthetic regression with controlled
   overlapping, rejected and retired completions. Cover the extracted actual
   Reader callback and preserve the offline-retry harness adapter.
4. The shared component regression was later executed as part of the
   conversation-search selection continuation: 48/48 cases passed on
   2026-10-16. The separate offline-retry regression and mounted-browser,
   service and cancellation acceptance remain outside that local run.

## Working behavior and explicit boundaries

Keep debounce, request bounds, result order, query/retry/access policy,
occurrence identity and ephemeral return state. Keep complete-turn navigation,
existing Reader navigation tokens, real DOM anchors and all stored data.
No API/schema/package/Dexie/dependency/deployment change is proposed.

Retiring a panel intent will suppress its later search publication/feedback/
close; it will **not actively cancel** an already-started Reader load or
scroll. Footer previous/next search navigation and generic Reader failure
publication are separate, unaccepted lifecycle questions, not silently
included in this repair. Actual race frequency, focus behavior and resource
cost remain open. The overall goal and older acceptance debt remain active.

## Implemented source checkpoint

- The panel now uses a layout-effect navigation scope and per-activation
  sequence. Query/filter input retires current ownership synchronously;
  scope cleanup retires source/conversation/visibility changes and unmount.
  Local close/Escape also retires ownership before notifying the parent.
- The Reader search adapter accepts an optional ownership predicate, checks
  admission and fences context/highlight publication. Existing two-argument
  callers remain supported; the predicate is not stored in navigation context.
  Desktop source-editor hiding explicitly deactivates search.
- Same-pending-occurrence admission is coalesced before target mapping.
  Different targets remain usable. Pending status and row busy semantics,
  finite bilingual failure guidance and neutral cancellation are added without
  an automatic retry, new timer, subscription or dependency.
- The shared selection regression is extended with controlled lifecycle
  cases and an extracted actual Reader callback; its 48/48 local result is
  recorded in the selection report's evidence directory. The offline-retry
  harness still has no executed result. These adapters are not React
  mounting, actual navigation, active cancellation, focus, browser or
  performance evidence.
- Current state, architecture, flows, navigation, testing and document
  inventory are synchronized. The shared component regression is the only
  executed result (48/48); targeted ESLint, nonincremental Web typecheck and
  diff check also passed. No offline-retry file, service, browser, build,
  production action, commit, CI, deployment or resource measurement ran.
  Full-goal completion is not claimed.

Formatting evidence: `git diff --check` for the edited tracked product/current
documentation files returned 0 with no whitespace errors. Existing LF→CRLF
warnings remain; no line-ending normalization was requested. This source-only
formatting check does not cover the untracked report/regression files and is
not behavioral validation.
