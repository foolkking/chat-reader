# UX quick review — offline continuation read states

2026-10-15 · source-only review, recorded before product edits.

## Scope and evidence

Continuation of the full ordinary-user optimization goal. Platform: Web app;
audience: ordinary archive readers. Scope: the read-only offline Current/Index
panel's initial read, refresh failure, missing conversation/member and explicit
read retry. Saved files are private, optional downloaded metadata, not canonical
transcript truth. No editing, upload, automatic download or semantic validation
is authorized by this repair.

SEEN: the complete offline panel, containing workspace, adjacent online document
and offline-file recovery patterns, Dexie access middleware, local authorization
generation helpers, optional continuation parser and existing disconnected
happy-path browser source. NOT SEEN: a running panel, real IndexedDB, browser
events, focus/scroll behavior, screen-reader output, actual outage incidence or
CPU/RSS. Source facts are Observed (code); live presentation is Inferred.
This is not a whole-product or accessibility conformance evaluation.

Pre-edit Git blobs:

| Source | Blob |
| --- | --- |
| `apps/web/features/exporting/offline-continuation-panel.tsx` | `b67cb6c9017fc367ca77302f033d9cb157218a08` |
| `apps/web/features/exporting/continuation-workspace.tsx` | `d0205963cd7e4078403667842ab0c76a709553a6` |
| `apps/web/lib/offline-continuation.ts` | `acb957382bf958cdfca86796006f381a946b79ab` |

## What matters

Offline continuation already uses local `always` scheduling; adding it again
would not solve this problem. The panel observes only query data, not its read
state. It therefore says a file is absent both before a successful first read
and after a read failure. A deleted conversation also returns undefined from
the query, which installed Query rejects rather than accepting as an empty
success. The offline file panel and online continuation document already show
local read-retry actions; reuse that convention without adding another fetch
owner or discarding Current/Index selection.

## Findings

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-OFFLINE-CONT-01 | Defect / state coverage; feedback | Medium | Observed (code + installed Query source); screen behavior Inferred | S |
| ERR-OFFLINE-CONT-01 | Defect / error recovery | Medium | Observed (code); interaction Inferred | S |

### STATE-OFFLINE-CONT-01 — unread and failed reads claim a missing file

**Location/evidence:** `offline-continuation-panel.tsx:16–17,25` destructures
only `data`, computes optional member text and renders **“This offline copy
does not contain this continuation file.”** whenever text is undefined. There
is no pending/error distinction. Its Dexie `.get()` can also return undefined
for a removed conversation. Installed primary source
`node_modules/.pnpm/@tanstack+query-core@5.101.2/node_modules/@tanstack/query-core/src/query.ts:569–575`
rejects undefined query data, so missing-record success needs an explicit null.

**Why it matters:** readers may believe their saved files were omitted or lost
when the device has not finished reading them, or cannot currently read them.
That can lead to unnecessary package downloads and abandoning a usable copy.
This is a secondary companion-document path, not irreversible data loss.

**Recommendation:** retain the query result and distinguish initial pending,
read error, confirmed missing conversation, confirmed absent optional member
and readable content. Normalize missing records to null. Keep matching cached
content through a transient refresh error, visibly label it as previously read,
and hide it when the read reports locked local access. Never render the missing-member statement
as the explanation for an unsettled/failed first read.

### ERR-OFFLINE-CONT-01 — no local retry without closing the workspace

**Location/evidence:** the complete `offline-continuation-panel.tsx:11–27`
has no `refetch`, read error action or read progress. Closing/reopening is the
only available indirect attempt, and a still-fresh cached result need not read
again. Current/Index and Source/Read controls cannot repair a failed database
read.

**Why it matters:** a temporary local-storage failure blocks the file companion
view with no in-place recovery. Leaving the workspace interrupts the reader's
current member/source choice and can still repeat the same misleading result.

**Recommendation:** expose a bilingual read-only Retry on load failure and a
confirmed missing-conversation state. Use the existing query's refetch, disable
while fetching, and do not cancel/restart a read already in flight. Bind the
query to the captured account database and retain existing query keys/mode.
Use existing access-generation fencing around the awaited read. Never initiate
a server update, package download, write, polling loop or new worker.

**Local precedents:** `attachments/offline-conversation-files-panel.tsx:105–119`
has a disabled-while-fetching local Retry; `continuation-document.tsx:109`
has scoped read error/Retry and its pending view is distinct from missing files.
Keep the established text styles, minimum control size and locale mechanism.

## Ordered repair and future acceptance

1. Implement truthful read-state branches and a local explicit Retry.
2. Author synthetic checks using the compiled real panel with controlled
   hooks/query/DB/access bindings, plus installed QueryClient/Observer checks for
   local scheduling, null results, failed reads/refetch and duplicate admission.
3. Keep checks **unexecuted** under the current source-only ordinary-UX boundary.
   Later authorization is required to run them, gates and actual disconnected
   browser recovery, including Current/Index, Source/Read and reference return.
4. Real browser focus, preserved Reader anchors, storage/access retirement and
   device resource behavior remain separate acceptance requirements.

## Working behavior and limits

Retain the existing member/view-state object, Index navigation callback, source
toggle and Markdown/Index renderers. Do not trim/rewrite text or reinterpret
invalid files. Optional continuation is absent legitimately in legacy packages;
missing members are still not errors after a successful read. No `.cr`,
offline package v1/v2/v3, Dexie v2, schema, dependency, API, stored byte, URL or
canonical-data change is needed. User imports and accepted deployment are untouched.

## Implementation status

Report delivered before product edits. Implemented in source:

- Retained query state now distinguishes pending, first-read failure, a
  successfully confirmed missing conversation, absent optional members and
  readable content. An absent Dexie row resolves to null, not undefined.
- Transient refresh failures retain only matching-conversation cached content
  with a previously-read-copy notice. `OfflineAccessError` hides that content
  and gives library access-recovery guidance. Raw exceptions are not rendered.
- Error/missing-conversation Retry uses the existing query with
  `cancelRefetch: false`, an is-fetching guard and a disabled pending label.
  Installed `query.ts:408–419` returns the ongoing retryer promise rather than
  restarting it when non-cancelling refetches overlap.
- The query captures its database instance; retired-database callbacks fail
  before a read and access-generation checks fence its awaited result. Keys,
  local mode, default retry policy, renderers and member/source choices remain.

`scripts/ux/offline-continuation-read-states.test.mjs` is authored but
**unexecuted**. It uses the actual compiled panel, synthetic hook/query/DB/access
bindings and child-element inspection. Additional bounded installed
QueryClient/Observer cases propose offline null-result/failure/refetch/coalescing
checks, including feeding actual observer states into the panel adapter. These
do not mount React, render Markdown/Index, read real IndexedDB, prove library
lock lifecycle or verify focus/Reader anchors. No pass count is asserted.

Only source/diff inspection was performed. No service, test/gate, product browser,
build, commit, CI, deployment or performance acceptance ran. The goal stays active.
