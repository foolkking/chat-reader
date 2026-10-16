# UX quick review — Share stored-position shape

2026-10-15 · pre-edit source evidence. Full ordinary-user goal remains active.

## Scope and evidence

Mainstream public/unlocked Share reading on responsive Web, only the boundary
between optional local position JSON and the existing query/restore flow.
This is a recovery guard, not a new stored schema or navigation algorithm.
Keep actual historical positions and their real-DOM anchor semantics; do not
delete data or run a local migration.

SEEN: `apps/web/features/sharing/share-readonly-reader.tsx:117–125,440–479,
1062–1069,1071–1131`; `apps/web/lib/types.ts:757–782`; the existing extracted
Share initialization/query/restore regression. Local historic source snapshots
`ac0f03e` and `fba64b6` also capture message/block/scroll offset plus an anchor
object, with optional anchor fields evolving over time. Current types include
both block-relative position modes.
NOT SEEN: mounted React, real corrupt browser storage, actual API/DOM restore,
browser/device geometry, announcements or CPU/RSS. Branch facts are Observed
(code); rendered consequences and frequency are Inferred. No browser,
conformance or executed regression claim. Tests/gates, services and release
remain off.

## Executive summary

The preceding storage-failure batch catches syntax errors and access failure.
A successful `JSON.parse` is still cast directly to a saved-position type.
The first-window query trusts its message identifier and restoration directly
dereferences its anchor object. Well-formed but incomplete/wrong-typed JSON can
therefore poison the initial query, throw during restoration or yield invalid
alignment. Validate only the shape and finite primitives those paths need,
treat an unusable record as no saved anchor, and leave valid legacy metadata
and stored bytes untouched.

## Finding and quick win

| ID | Kind / dimension | Severity | Confidence | Effort |
| --- | --- | --- | --- | --- |
| STATE-SHARE-POSITION-SHAPE-01 | Defect / state coverage; error prevention | High | Observed (code); rendered consequence Inferred | S |

**STATE-SHARE-POSITION-SHAPE-01.** Locations: pre-edit
`readSharePosition:1062–1069`, initial query at 117–125 and restore at 440–479.
The helper only catches JSON parsing; a record with a usable message string
but absent/null `anchor_data` reaches the direct `.block_id` dereference.
Non-string message identifiers flow into the query, while invalid block
indexes or non-finite `scroll_offset` can reach locator/alignment arguments.
A returning visitor can fail to open or resume otherwise authorized content,
with a reload rereading the same unusable local value.

At the existing read boundary require a non-array record, nonblank string
message identifier, non-array anchor record, finite numeric scroll offset and
an optional/null or nonnegative safe-integer block index. Preserve valid
records unchanged: do not enforce a UUID pattern, new required timestamp/
mode/anchor metadata, exact keys or normalization. Keep both position modes,
existing optional anchor fallbacks/numeric handling and absence of a block
index compatible. Unusable JSON becomes a null anchor without deleting/
rewriting the key, disabling an otherwise usable store or inventing progress.
Storage access failure must still reach the preceding unavailable-store
boundary, not be confused with corrupt data.

## Ordered repair and acceptance

1. Add bounded structural/finite checks in the current read helper; leave
   SHA-256 namespace, serialization, queries, restore order and writes alone.
2. Extend the actual helper/initialization/query/restore regression with
   synthetic wrong shapes and overflow numbers, valid current/legacy/minimal
   records, unchanged read bytes/key and no stale/unavailable-store confusion.
   Author assertions only; do not run them.
3. After authorization use task-specific TEMP/TMP for the focused and relevant
   Share/Web checks, then browser corrupt-record, normal/legacy resume and
   real-anchor/no-jump acceptance.

## What stays and open questions

Normal metadata remains forward-compatible and is not stripped. Invalid
records stay on disk during reads; only the already-existing later normal
save or permanent-error discard policy can change storage. No new warning,
network retry, timer, dependency, persistence schema, API, package or Dexie
change. The preceding unavailable-store flag remains for actual capability/
access/write failure, not merely an unusable anchor.

This does not detect a well-typed but deleted/out-of-scope message; the existing
locator/access policy still owns that. Indefinitely pending digest, stale but
well-shaped positions, edge loading and unlock remain separate. A source-only
guard does not establish browser storage durability or restore accuracy.

## Implemented source checkpoint

The existing read helper now parses into `unknown` and performs the bounded
record/message/anchor/finite-pixel/optional-safe-index checks above. Accepted
data is returned without normalization or metadata stripping. Invalid syntax
or shape yields null; storage access remains outside that parse/shape catch
so the preceding optional-capability failure handling still owns denial.
No read-time write/delete, new field, dependency, query/restore change or
resource loop.

The existing `scripts/ux/share-navigation-retirement.test.mjs` now authors
wrong-root/message/anchor/offset/index and numeric-overflow JSON cases through
the actual helper/initialization/query/restore extraction. They assert normal
store readiness, an unanchored query, no poisoned restoration, no unavailable
flag/disable marker and original bytes retained. Current v2, legacy v1,
numeric anchor hints, minimal/null-block records and finite pixels/extra
metadata assert unchanged values, existing anchored query, finite restore
offset and no read-time migration. The fixture still controls digest/storage,
hooks, queries, transport/leases, DOM positioning and timers.

All additions are **unexecuted**, not browser or pass-count evidence. The
preceding storage/sheet/tablet regressions were not rerun or claimed to accept
this batch. Current state/architecture/flows, testing/navigation and document
inventory are synchronized. No tests/gates, syntax check, lint, typecheck,
build, services, browser, commit, CI, deployment or CPU/RSS measurement ran.
Full ordinary-user goal remains active; formatting-only review follows.

Formatting-only `git diff --check` for the tracked Share source and six
edited current documents exited **0**. Existing LF→CRLF warnings remain;
no normalization. This untracked report and the updated untracked regression
were outside that command. No syntax, type, test, browser or resource result
is implied.
