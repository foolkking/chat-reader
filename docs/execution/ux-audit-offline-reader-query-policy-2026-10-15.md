# UX quick review — Offline Reader query scheduling

2026-10-15 · source-only review, recorded before product edits.

## Scope and evidence

This is a bounded continuation of the full ordinary-user UX goal, not a new
release cycle. Platform: Web app; audience: ordinary readers of downloaded
archives. Scope: Offline Reader conversation metadata, saved position, initial
complete-turn window and dialogue/section navigation queries, including sheet
prefetches and the shared navigation components.

SEEN: the current Reader, offline data-source implementations, navigation
components and callers, QueryProvider, the installed TanStack Query retryer and
the existing local guidance/search query conventions. NOT SEEN: a running
Reader, actual IndexedDB or service-worker execution, offline browser events,
restored DOM positions, touch/focus behavior, timings or CPU/RSS. Query option
and scheduling evidence is source-derived; actual screen behavior is inferred.
This is not an accessibility conformance or whole-product acceptance report.

Pre-edit Git blob bindings:

| Source | Blob |
| --- | --- |
| `apps/web/features/conversations/conversation-reader.tsx` | `dc5e9e9a1278dd6f420cdab9a5d69ba5b6b26527` |
| `apps/web/features/toc/conversation-index.tsx` | `20bae0e7b372513ae62d52d410cd9b47d6080cf5` |
| `apps/web/features/toc/conversation-toc.tsx` | `0c30e3eec1778285c965072fda8cdbe44e63949c` |
| `apps/web/components/query-provider.tsx` | `b4ee64240d5bcc398029b993b258642e3463f8cd` |

## What matters

Downloaded content does not need a network to read its local metadata or turns.
However, the Reader still inherits the online request gate for these queries.
Once Query's connectivity manager is marked offline, an uncached metadata or
position read can pause before its local function runs. The initial window is
also dependent on the position read settling, unless a URL supplies a target.
Navigation observers and sheet prefetches inherit the same gate independently.
The search-only policy repair does not cover these queries, so the fix must
follow the data-source mode through the existing Reader and navigation props
rather than alter global remote behavior.

## Finding

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-OFFLINE-READER-01 | Defect / offline state coverage; perceived performance | High | Observed (application + installed library source); live pause/rendering Inferred | S |

### STATE-OFFLINE-READER-01 — local reads wait at the online request gate

**Location/evidence:** `conversation-reader.tsx:463–466,527–557` has no
`networkMode` on metadata, position or initial turn-window options.
`canLoadInitialWindow` depends on the frozen initial position or an explicit
target. Sheet prefetches at `2242–2252`, `conversation-index.tsx:63–74` and
`conversation-toc.tsx:30` also omit a mode. The latter two are shared with the
remote/Share Reader and cannot unconditionally become local.

`lib/reader-data-source.ts:155` onwards implements the offline adapter with
Dexie reads; it does not require HTTP for these operations.
`components/query-provider.tsx:10–16` supplies no global network override.
Installed primary source
`node_modules/.pnpm/@tanstack+query-core@5.101.2/node_modules/@tanstack/query-core/src/retryer.ts:53–56,104–109`
uses the online manager when the mode is unspecified and permits disconnected
execution/continuation for `always`. The initial online-manager value is not a
claim that every cold offline launch pauses: the identified sequence requires
Query's manager to have been marked offline.

**Why it matters:** a person opening another downloaded conversation after
losing connectivity can be prevented from reaching their saved local reading
position, even though the needed data is present. Local navigation can also
wait for an irrelevant connection. Existing copies are not deleted and
reconnection can resume work; this is High, not an irreversible-loss Blocker.

**Recommendation:** derive `always` only from `dataSource.mode === "offline"`
and apply it to the three Reader queries and two sheet prefetches. Pass the
same explicit policy to both navigation components in desktop and sheet
placements. Give those shared components an optional typed network-mode prop;
omitted props retain the caller's inherited Query policy. Never infer data
locality from a cache-key prefix or the presence of a custom loader.

**Local precedent:** `components/use-guidance-setting.ts:11` already uses
`networkMode: "always"` for device settings; the preceding search repair sets
it only for the offline data source. Reuse that convention, not a provider-wide
override, new data service or cache layer.

## Ordered repair and future acceptance

1. Add the source-specific policy and wire every scoped query/placement.
2. Author synthetic checks against extracted real TypeScript query options and
   the installed QueryClient/online manager. Cover local offline scheduling,
   remote inherited scheduling, explicit caller defaults, pending/refetch
   continuation, initial-window enablement and navigation loader arguments.
3. On 2026-10-16, run the focused regression with the extracted real query
   options, compiled navigation adapters and installed QueryClient behavior.
   Keep mounted-browser, service, full API/PWA/build and resource checks outside
   this local verification boundary.
4. Later browser acceptance must disconnect after an online session, switch to
   another downloaded conversation, restore its real saved DOM anchor and use
   desktop/mobile dialogue and section navigation. This source review does not
   substitute for that procedure.

## Working behavior and limits

Leave query keys, stale times, retry budgets, placeholders and enabled
conditions unchanged. Preserve frozen initial-position semantics, complete-turn
loading, direct navigation reads, stable DOM anchors and user-scroll intent.
Do not enable private version-history queries for offline/readonly messages.
Do not change Share call sites or remote request policy. No new corpus, storage
record, background task, polling loop, migration or dependency is needed.

The local annotation/notebook/attachment subpanels have separate query owners;
their full scheduling and recovery coverage is not claimed here. They remain
follow-ups in the broad audit. Package v1/v2/v3, Dexie v2, `.cr`, canonical
PostgreSQL data and user import originals are outside this change.

## Implementation status

Report delivered before product edits. Implemented in source:

- Offline metadata, saved-position and initial complete-turn queries, plus
  dialogue/section sheet prefetches, use the offline-only `always` policy.
- Both shared navigation components accept an optional typed mode. All four
  Reader placements pass the source policy; existing Share callers are left
  alone. Missing modes are **omitted** from the query options, not assigned
  `undefined`: QueryClient's `defaultQueryOptions` spreads explicit options
  over caller/key defaults (`queryClient.ts:577–581`), so an undefined property
  could otherwise erase a custom inherited policy.
- Keys, enabled expressions, limits, placeholders, stale times and explicit
  retry settings are unchanged. Local queries adopt Query's normal `always`
  behavior, including its default of no network-reconnect refetch; explicit
  invalidation and local reads remain available. Remote/Share defaults remain
  untouched.

`scripts/ux/offline-reader-query-policy.test.mjs` ran on 2026-10-16 with
**10/10 passed, 0 failed, 0 skipped**. It extracts and compiles real Reader
options, captures options from the actual compiled navigation components with
controlled hooks, and checks installed QueryClient behavior for disconnected
execution, retry/continuation, inherited defaults and disabled queries. Static
JSX checks cover the four Reader placements and default Share callers.
Data-source/turn-loader adapters do not prove IndexedDB correctness, full-turn
content, React lifecycle, saved DOM restoration or browser behavior.

## Continuation verification — 2026-10-16

The focused regression and targeted source checks were recorded under
`docs/execution/ux-audit-offline-reader-query-policy-2026-10-15-evidence/`.
The 10/10 cases passed; targeted Web ESLint, nonincremental Web typecheck and
`git diff --check` also passed. No service, login, product browser, full API or
PWA suite, full build, commit, CI, deployment or CPU/RSS measurement ran.
Mounted offline-device, IndexedDB, complete-turn rendering, focus and real DOM
anchor restoration acceptance remains open. The overall optimization goal
remains active.
