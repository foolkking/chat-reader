# UX quick review — sidebar search selection

2026-10-15 · ordinary-user search follow-up · source inspection only.

## Scope and evidence

The full product goal remains in force. This batch covers the existing Web
sidebar's quick-search keyboard/pointer selection when results for the **same**
query refresh. Audience: ordinary users and frequent readers, mixed expertise.
Wrong navigation costs orientation, not irreversible content loss. No visual,
accessibility-conformance, browser or performance claim is made.

SEEN: `features/search/sidebar-search.tsx`, the neighboring global/conversation
search components, current QueryProvider defaults and the frontend interaction
contract. NOT SEEN: live results, real focus, mobile geometry, API behavior,
device CPU/RSS or user failure frequency. No service or production access.

Pre-edit sidebar Git blob: `35541039e687dea3b13d4a994aab73199ce46315`.
Source examples below are structural, not recordings of user conversations.

## What matters

Quick search retains a numeric index while result identity can change.
Refreshing an existing query can silently move the highlight and Enter to a
different document; a shorter result list can make Enter do nothing at all.
The full search page already retains `document_id`, providing a local precedent.
The repair should reuse that idea without changing API calls or initial quick
search behavior. Stale typed-query results and IME confirmation already have
guards and should retain them.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| NAV-SIDEBAR-01 | Defect / navigation; state coverage | Medium | Observed (code); live interaction Inferred | S |

**Location/evidence:** `apps/web/features/search/sidebar-search.tsx:16,33–36,60–64,77–79`
stores `activeIndex`, reads `items[index]`, opens `activeIndex` on Enter and
highlights that same numeric slot. No reconciliation happens when `items`
changes. Given a deliberate selection of the second row in `[A, B]`, a refreshed
`[B, A]` now opens A. Given the eighth selected row and a refreshed two-row list,
`openResult(7)` returns without navigation. These are source-derived scenarios,
not executed reproductions.

**Why it matters:** readers can open a result they did not select, or conclude
Enter is broken after a refresh. This is a secondary shortcut, and the full
results route remains available, so Medium rather than High.

**Recommendation:** retain the selected `document_id` and derive its current
visible index. Keep the existing first-result default until the reader explicitly
selects a row. If a deliberately selected identity disappears, show no selected
row and let Enter open the full results page rather than a replacement document.
Arrow navigation must restart from the actual visible selection, not a stale
numeric index. Clear deliberate selection when the query changes.

## Quick win and ordered acceptance

1. Change only the sidebar's ephemeral selection state and its key/hover wiring.
2. Author targeted source regressions for reorder, removal/shrink, query change,
   first-result behavior, IME and existing navigation parameters.
3. In a later authorized validation batch, execute those checks and lint/types,
   then verify actual keyboard/focus behavior in the browser.

The neighboring `search-page.tsx:41–45,65–68` already retains document identity.
Do not refactor search services, introduce shared state infrastructure or change
limits, debounce, query keys, retries, caches, URLs or result ordering.

## Working behavior retained / open questions

The 250 ms debounce, eight-result bound, typed-query freshness guard, IME guard,
retry/empty/loading branches, clear/Escape and full-results action stay intact.
Search result message/block/character/annotation parameters must remain intact.
No polling, request, effect, dependency or persistent field is added.

Browser acceptance should include selecting a result, a same-query refresh,
removal of that identity and a subsequent arrow/Enter action. Actual refresh
frequency and device performance remain unknown. The wider ordinary-user audit
and previous source-only acceptance debt are not completed by this repair.

## Implementation status

Report written before the product edit. The sidebar now stores an explicit
`document_id`, derives the current index and navigates arrows from that visible
index. The original first-result default remains while no explicit selection
exists. A missing explicit target has no highlight; Enter takes the existing
full-results route. A new query clears explicit selection.

### 2026-10-16 continuation — local verification

Under the task-specific `C:\Users\86182\Desktop\wkkk\chat-reader-sidebar-search-20261016`
TEMP/TMP directory, the authored harness was run against the compiled current
component:

- `node --test scripts/ux/sidebar-search-selection.test.mjs`: **12 passed /
  0 failed / 0 skipped**.
- Targeted ESLint for `features/search/sidebar-search.tsx`: **exit 0**.
- Nonincremental Web TypeScript check: **exit 0**.
- `git -c core.safecrlf=false diff --check`: **exit 0**.

The harness compiles the actual component and exercises its real handlers with
explicit hook/query/timer/router adapters; no search transport runs in that
harness. Passing cases cover first-result and parameter preservation,
keyboard/hover reorder, removal, eight-to-two shrink, fresh query, IME and
annotation targets. This is source/adapter evidence, not mounted React,
browser keyboard/focus, assistive technology or live network acceptance.

No service, login, build, full API/PWA suite, product browser, commit, CI or
deployment ran. The full optimization goal remains active; prior source-only
items remain separately labeled rather than being counted as verified here.
