# UX quick review — offline search index readiness

2026-10-15 · source-only recovery review, before product edits.

## Scope and evidence

This continues the full ordinary-user optimization goal. Scope: the shared
offline search bridge, its Worker initialization and the Library/Offline Reader
consumers. Platform: Web app; audience: ordinary archive readers, mixed
expertise. Private content must remain account-scoped, and an unavailable index
must not be represented as a successful search with no matches.

SEEN: `lib/offline-search.ts`, `offline-search.worker.ts`, the Library's
initialization/search/retry paths, Offline Reader's search adapter, access
generation checks and the current PWA contract. NOT SEEN: real Worker execution,
IndexedDB, browser lifecycle, CPU/RSS, mobile/focus behavior or user incidence.
No service, production or network search was used.

Pre-edit Git blobs:

- `apps/web/lib/offline-search.ts`: `067726c6910f6d1e0a78d1901471668f15a1a06c`
- `apps/web/lib/offline-search.worker.ts`: `70501458caf5373ea749966b37d6a9c452d91de3`
- `features/search/conversation-search-panel.tsx`: `98c19524ddf6fdb001e37d867a59bf504eacdefd`
- `features/conversations/conversation-reader.tsx`: `379d35c6526b7b934aecf35ac8f70ee112b1d371`
- `features/offline/library-shell.tsx`: `81ca4514fd2ec4c457f2cabb1c0e771506f7884f`

## What matters

The existing bridge already rejects pending requests on Worker errors and its
ten-second deadline; this is not an infinite-wait defect. However, the next
search can create a fresh Worker whose index is empty. Offline Reader retry
calls that search function without rebuilding the index, so an unavailable
search can become an apparently successful zero-result search. The same gap
exists before initialization starts, including a Worker created only for the
offline-shell runtime inventory. Library's explicit retry already rebuilds and
should remain the recovery owner. Readiness should be tracked in the shared
bridge rather than retaining a second corpus or rebuilding on every query.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-OFFLINE-SEARCH-01 | Defect / state coverage; error recovery | High | Observed (code); live presentation Inferred | M |
| STATE-OFFLINE-SEARCH-02 | Defect / offline state coverage | High | Observed (application and installed library source); live pause Inferred | S |

### STATE-OFFLINE-SEARCH-01 — uninitialized Worker can report false emptiness

**Location/evidence:** `offline-search.ts:18–32,44–65` creates a Worker for any
request but does not track whether that instance has received `init`.
`offline-search.worker.ts:6–7,29–35` starts with an empty index and answers a
search against it normally. `reader-data-source.ts:264–267` uses that bridge
directly; the conversation-search Retry refetches it. The Library's
`library-shell.tsx:201,345–353,432–438` separately rebuilds on explicit retry.

Source-derived sequence: initialize W1 → W1 fails while idle and is reset →
search/retry creates W2 → W2 answers with an empty index → consumer receives
`[]` instead of an unavailable-index failure. No live reproduction is claimed.

**Why it matters:** readers can believe their downloaded conversation has no
matching text when the index is simply absent. Changing keywords or retrying
inside the Reader cannot reconstruct that index. Local copies remain readable,
so this is High rather than an irreversible-loss Blocker.

**Recommendation:** retain one ephemeral initialization record bound to the
Worker instance and access generation. Searches await an already-started init;
without one they fail through the existing unavailable/retry state, not `[]`.
Reset clears readiness. Check that the same initialized index still owns a
search before dispatch and before returning its reply. A real initialized empty
corpus and a blank query must still return empty results legitimately.

Reader retry must also reach the existing Library rebuild, not just repeat the
new readiness failure. Pass an optional rebuild callback through the two Reader
search surfaces and run it only as preparation for an explicit retry. Bind that
one pending preparation to its search scope, consume it once inside the query
function, and let existing query fetching/error handling own the wait/result.
Do not rebuild on every keystroke or introduce a second recovery owner.

### STATE-OFFLINE-SEARCH-02 — local search inherits the online request gate

**Location/evidence:** `conversation-search-panel.tsx:78–88` supplies no
`networkMode`; `components/query-provider.tsx:10–16` supplies no global override.
The installed primary source
`@tanstack/query-core@5.101.2/src/retryer.ts:53–56` treats an unspecified mode as
`online` and gates it on `onlineManager.isOnline()`. Consequently the local
search function can be paused once connectivity is marked offline even though
it only needs a Worker/IndexedDB. This is source evidence, not an executed
disconnect test.

**Why it matters:** offline readers can wait for a network that their local
search does not need, and an unfetched result can look empty. This undermines
the core purpose of downloaded conversations.

**Recommendation:** set `networkMode: "always"` only for this panel's offline
data source; leave remote sources on the inherited policy. The local
`use-guidance-setting.ts` and `offline-export-panel.tsx` already use this
convention. Query keys, enabled conditions, retry budgets and server requests
stay unchanged. Effort S; no global QueryProvider override.

## Ordered repair / acceptance

1. Add shared bridge readiness and reset/initialization ownership.
2. Author synthetic bridge regressions for no init, runtime-only Workers,
   in-flight init, fatal/reset/timeout/post failure, explicit rebuild, replacement
   initialization, account generation and legitimate empty results.
3. Wire manual Reader retry to the existing Library rebuild and set the local
   search query's offline network policy; author focused query/wiring checks.
4. In a later authorized batch, run those checks and lint/types; verify real
   offline Worker cold start, Library rebuild retry and Reader retry behavior.

If no init has started, the bridge must fail promptly rather than poll or wait
forever for a possible future Library visit. Recovery remains the existing
Library rebuild path; no automatic retry loop, duplicate index snapshot, event
bus, new timeout or new worker protocol is needed.

## Working behavior / boundaries

Keep existing error/messageerror handling, ten-second deadlines, access fencing,
manual Library rebuild, query debounce and pending-request cleanup. Runtime
inventory must still create/report its Worker without requiring an index.
Do not change FlexSearch options, result shape/limits, API, canonical data,
`.cr`, package v1/v2/v3, Dexie v2 or authentication/cleanup policy.

Whether recovery is sufficiently discoverable from the Offline Reader needs
later browser observation; it is not established by this code-only review.
Other Reader metadata/position/window queries also omit a local network policy;
their broader offline transition audit is a separate follow-up, not claimed
fixed or accepted by a search-only option.
Do not claim CPU/RSS savings or device acceptance. The broader goal stays active.

## Implementation status

Report delivered before product edits. Implemented in source:

- One bridge record holds the current Worker, access generation and init reply
  promise, not a second corpus. Reset clears it. Searches wait for a started
  init, reject absent/retired readiness and reject replies from a replaced index.
  Blank queries and a genuinely initialized empty corpus retain empty results.
- Library supplies its existing queued/coalesced `reloadLocal` to both Reader
  search surfaces. Only explicit Retry arms a one-shot, search-scoped preparation
  consumed inside the query function; typing/ordinary reads do not rebuild.
- Local search opts into `networkMode: "always"`; remote policy is inherited.
  Offline access is captured before rebuilding and rechecked before search and
  after its response, so delayed preparation cannot move into a new account.
- No Worker protocol, new dependency, global network policy, timer, polling,
  event bus, persistent field, source data or offline format was changed.

At the source-only implementation checkpoint, two regression files were
authored but **not yet executed**:

- `scripts/ux/offline-search-readiness.test.mjs` compiles the actual bridge with
  explicit Worker/clock/access adapters. Scenarios include no init, runtime-only
  startup, pending init, legitimate empty results, fatal events, timeout,
  synchronous post failure, rebuild, replaced replies and access retirement.
- `scripts/ux/offline-search-retry.test.mjs` uses the actual compiled panel with
  hook/query/source adapters, one installed QueryClient offline-policy scenario,
  and static AST wiring checks. It covers explicit-only preparation, held/failed
  rebuild, retired scopes/accounts and inherited remote behavior.

At that checkpoint these were prospective checks, not successful runs, browser
evidence or measured performance. The earlier rich-text 106-case/gate result did
not validate these later changes. The wider goal and other Reader offline-query
policy review remain open.

## Service-free continuation verification — 2026-10-16

The two authored regressions were then run against the actual compiled bridge
and search-panel source, with explicit Worker, clock, access, hook, query and
router adapters. The installed QueryClient was also marked offline for the
local-query case.

| Check | Result | Boundary |
| --- | --- | --- |
| `node --test scripts/ux/offline-search-readiness.test.mjs scripts/ux/offline-search-retry.test.mjs` | **19/19 passed, 0 failed, 0 skipped** | Bridge readiness, reset/fencing, explicit rebuild, access retirement, local `networkMode: "always"` and static Reader/Library wiring; no real Worker/IndexedDB or mounted browser |
| Targeted Web ESLint | **exit 0** | `offline-search.ts`, search panel, Reader and Library shell |
| Nonincremental Web typecheck | **exit 0** | Full Web TypeScript graph; no build or runtime |
| `git diff --check` | **exit 0** | Whitespace only |

Evidence is retained in
`ux-audit-offline-search-readiness-2026-10-15-evidence/continuation-*20261016.*`.
No Web/API service, login, real browser, offline device, build, CI, production
action, commit or deployment was used. The result does not establish Worker
cold-start behavior, IndexedDB recovery, focus/geometry, CPU/RSS or whether the
Reader retry is sufficiently discoverable; those remain later acceptance work.
