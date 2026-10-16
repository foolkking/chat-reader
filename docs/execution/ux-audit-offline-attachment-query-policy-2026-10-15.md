# UX quick review — offline attachment query scheduling

2026-10-15 · source-only review, before product edits.

## Scope and evidence

This continues the full ordinary-reader optimization goal after the core Reader
query-policy repair. Platform: Web app; audience: ordinary archive readers.
Scope: Offline Reader's file-list query, inline attachment metadata and the
shared Viewer shell/item queries. Cached originals and private metadata must
remain local; this review does not authorize server fallback or cache changes.

SEEN: the four query option objects and their consumers, attachment access
variants, local list/metadata functions, Object URL release effects, existing
file-list Retry and unavailable-asset branches. Also sampled the annotation
read hook, notebook draft effect and offline continuation query to establish
whether they share this scheduling defect. NOT SEEN: real attachment bytes,
IndexedDB/Cache Storage, mounted React, gallery/thumbnail lifecycle, browser
disconnect/reconnect, accessibility, resource usage or user incidence.

Pre-edit Git blob bindings:

| Source | Blob |
| --- | --- |
| `apps/web/features/attachments/offline-conversation-files-panel.tsx` | `1c5ca1c8c6f55af38b665badac72aa7f6b398327` |
| `apps/web/features/attachments/attachment-block.tsx` | `32379bc1a97fa9df8c0b6d73c02ac9d535a4883a` |
| `apps/web/features/attachments/attachment-viewer.tsx` | `d8e02ea4c01403f7b9b41c6a4697630c7603185b` |

## What matters

The core Reader policy does not reach queries owned by its attachment children.
The local file list and three attachment metadata query paths still inherit the
online request gate. Once Query's online manager is marked offline, a file list
can appear empty and an inline attachment or Viewer can remain pending before
reading valid cached data. Existing unavailable-asset and Retry branches are
useful, but those branches require the local read to actually execute.
Only local attachment access should bypass the gate; owner, Share and admin
requests must keep their existing inherited policies and access arguments.

## Finding

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-OFFLINE-ASSET-01 | Defect / offline state coverage; recovery | High | Observed (application + installed library source); screen behavior Inferred | S |

### STATE-OFFLINE-ASSET-01 — cached file reads are gated by connectivity

**Location/evidence:** `offline-conversation-files-panel.tsx:32–36` calls
`listOfflineConversationAttachments`; `attachment-block.tsx:62–67`,
`attachment-viewer.tsx:151–158,376–383` select `getOfflineAttachment` for offline
access, but none sets a local network mode. The inline query's `isPending`
branch and Viewer shell's `isPending` branch precede their unavailable/retry
views. File-list emptiness is guarded by `isLoading`/`isError`; a paused pending
query is not necessarily loading, so it can reach an apparent empty result.

The installed Query retryer at
`node_modules/.pnpm/@tanstack+query-core@5.101.2/node_modules/@tanstack/query-core/src/retryer.ts:53–56`
gates an omitted mode on the online manager. Local helpers at
`lib/offline-db.ts:862–890` read Dexie and verified cached bytes, not HTTP.
The sequence requires Query's connectivity manager to be marked offline; no
claim is made that every cold offline launch pauses.

**Why it matters:** readers can conclude that a downloaded file is missing or
unreadable even when its local bytes are intact. Reopening the same Viewer or
Retry cannot bypass the scheduling gate. This compromises the cached-attachment
path but does not delete originals or copies; severity High, effort S.

**Recommendation:** always permit the intrinsically local file-list query.
For inline, shell and item queries, add `networkMode: "always"` only when
`access.kind === "offline"`; otherwise omit the property entirely so caller/key
defaults still apply. Preserve all query keys, enabled conditions, stale/GC
times, local access checks, verified-cache reads and Object URL cleanup.

**Local precedent:** core Reader's just-recorded policy and the existing offline
continuation query use local `always` scheduling. The earlier
[file-list recovery report](ux-audit-offline-files-retry-2026-10-14.md) already
added an explicit Retry; do not duplicate that action or replace its state.

## Ordered repair and future acceptance

1. Repair the four existing query option objects; no new hook/service.
2. Author synthetic checks for real extracted options against the installed
   QueryClient/Observer: all local reads while marked offline, disabled/lazy
   queries, unchanged keys/lifetimes, local failure versus genuine empty lists,
   and owner/Share/admin inherited policies and loader arguments.
3. Leave checks **unexecuted** under this source-only boundary. Later authorized
   validation must run them and relevant gates, then disconnect a real Reader
   and exercise file list/Retry, inline assets, Viewer and lazy gallery items.
4. Real-byte/URL lifetime, revoked-access, missing-cache and device resource
   acceptance remains necessary; query adapters do not establish those facts.

## Working behavior and boundaries

Existing local attachment helpers preserve access-generation checks and verified
cache reads. Keep server enumeration/derivatives disabled for offline access.
No new polling, byte snapshot, storage format, migration or dependency is needed.
Do not change text/image/PDF rendering, original download, navigation locators,
Share access, `.cr`, package v1/v2/v3, Dexie v2 or user import originals.

The sampled annotation/notebook paths use direct scoped promise/effect reads,
not Query's online gate (`use-annotation-workspace-reads.ts:34–46,93–97`,
`notebook-view.tsx:41–54`). Offline continuation already declares `always`
(`offline-continuation-panel.tsx:16`). No scheduling edit is justified in those
paths. This is a narrow source finding, not acceptance of all their recovery,
draft-writing or browser behavior.

## Implementation status

Report delivered before product edits. Four existing option objects are repaired
in source: the local list always executes; inline/shell/item metadata add
`always` only for offline access. Remote modes omit the override. No keys,
enabled conditions, explicit retries, lifetimes, read helpers, cleanup effects,
cache formats or Viewer rendering branches were changed by this batch.
Local queries adopt Query's normal `always` reconnect default; manual refetch
and explicit invalidation are unchanged.

`scripts/ux/offline-attachment-query-policy.test.mjs` is authored but
**unexecuted**. It compiles actual extracted option objects with synthetic state/
loader bindings and proposes installed QueryClient/Observer checks for local
disconnected reads, inactive/lazy gates, inherited global/key defaults, remote
scope arguments, reconnect, local errors/refetch and empty-versus-failed lists.
It does not mount React or execute real bytes, Object URL release, access
retirement or browser lifecycle. No pass count is asserted.

Only source/diff inspection was performed. No service, test/gate, product
browser, build, commit, CI, deployment or CPU/RSS acceptance ran. The overall
goal remains active.
