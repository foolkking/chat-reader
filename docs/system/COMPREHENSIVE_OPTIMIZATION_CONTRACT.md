# Consolidated optimization contract

Source candidate: 2026-11-05. This is not a deployment receipt.

## Authentication and local reading

Server session, device permission and connectivity are separate. The shared
session read coalesces concurrent requests; route changes do not restart it.
Visible focus checks reuse a valid result for five minutes; hidden tabs skip
periodic checks. Session queries do not renew the 48-hour inactivity deadline.
Task/status/catalog polling and explicitly marked background GET/HEAD reads do
not renew it either. User reads/writes retain the existing activity throttle.
Successful private responses expose account-bound expiry metadata; this can
extend only the already verified same-account runtime, not authenticate a user.

`/library` HTML is a non-private shell and is allowed without a presence cookie.
An intact cached shell is served before network work; login redirects cannot
replace it. Trusted local content starts before session probing. Missing/expired
cookies, transport errors and 503 retain opened content and pause server access.
A normal resource 403 does not sign the account out. Backend authorization,
ownership, same-origin writes and transaction-sensitive security checks remain.

Long-term local reading requires an explicit private-device confirmation after
successful same-account verification. Permission stores identity and consent time,
not server tokens/passwords. Legacy data is not deleted or silently upgraded.
Explicit revocation, account restriction, credential changes and local locking
revoke permission but preserve unsynced data. A fresh password login is required
to unlock a retained lock; a background valid-cookie check cannot unlock it.
Offline locking is not a successful server logout. Explicit logout still reviews
pending work and performs its confirmed, recoverable cleanup. Account namespaces,
cross-tab fencing and stale-response epochs remain mandatory.
On cold startup, recorded signout cleanup takes precedence over the ordinary
local-lock screen so its retry remains reachable without reopening private data.

Anyone with access to the browser profile may read its authorized local copies.
An offline device cannot immediately learn remote revocation. Local permission
never grants server permissions.

## Deletion, attachments and sharing

The conversation tombstone and cleanup job commit together. A failed cascade is
recoverable by the existing worker; retry does not restore public availability.
All Share subresources, including frozen content, reject tombstoned sources.
Tags and favorites drop invalid conversation references during cleanup.

Batch attachment admission, each source read, prepublication and retained ZIP
download recheck the same availability/deletion/scanning policy as direct reads.
Detached files remain readable through authorized historical message versions,
but cannot re-enter the current file selection or public-image links.
The existing background ZIP service drives progress and retained delivery;
expired artifacts can be explicitly regenerated from the original selection.

Share creation accepts an optional intent key, serialized per conversation/key
on PostgreSQL and protected by a unique index. The same key/options returns the
same link; different options conflict. Unknown outcomes require a read-only
receipt query before explicit same-key retry. A deliberate fresh creation uses
a new key. Partial-message shares explicitly state that notebook inclusion is
the entire notebook; preview is bounded and labels truncation.

## Recoverable user workflows

`GET /api/adaptive-import/sessions` returns owner-scoped unfinished imports with
bounded offset pagination, source availability and expiry. It is independent of
the short terminal-task display period. Resume reads the original session and
does not re-upload or re-analyze. Browser session pointers are account scoped;
legacy unscoped pointers are not assigned to an unknown user.

Search includes owner notebooks/descriptions, tag filters and paged duplicate
locations. Title dates fall back to import time in index metadata only. Migration
backfills missing title dates without changing source/canonical times, and queues
a bounded private-content index backfill. Ranking/tie-break and duplicate meaning
are preserved while representatives/counts are grouped in SQL; only page bodies
are loaded into Python. This does not replace the search engine.

Personal/system archives have an optional `user_features_version:1` extension:
favorites, tags, saved searches, presets/checklists and reading baselines.
Preflight validates references/ownership; additive restore maps IDs and tag
references, resolves tag-name collisions and retains archive-receipt deduplication.
Old archives remain readable. Preview distinguishes declared collections from
old absent data and explicitly excludes sessions, credentials, device permission,
browser drafts and Share links.

Source-editor drafts persist in the existing account-scoped Dexie settings store,
with original message/version and per-editor revision. Recovery never submits;
stale-base recovery asks for comparison. Confirmed saves and explicit discard
retire queued draft writes. Drafts participate in pending-work review/export and
scoped cleanup. Dexie stays v2; offline packages stay v1/v2/v3 compatible.

Library progress/list reconciliation runs at each committed conversation cursor,
not only the end of a batch. Failed replacement keeps the previous readable copy.
Reader identity no longer changes with download revision; its queries invalidate
in place. Header reconciliation iterates records without retaining all bodies.
Reused verified attachment object URLs avoid another Blob materialization.

## Engineering and measurement boundaries

API runtime, test and build dependencies have separate hash-checked universal
locks. CI and images install them without a second dependency resolution.
`pytest` is not a runtime dependency. API full-suite ownership replaces two
duplicated subset invocations; browser/auth/PWA/migration/image gates remain.
Update locks deliberately with uv from `pyproject.toml`, preserving selected
constraints, and verify the target Python/platform before release.

`test_backup_restore_drill_postgres.py` actually dumps/restores migrated synthetic
data and copies/verifies assets between random loopback-only disposable databases.
It checks current/historical versions and account-scoped favorites. This is not
a production backup restore, nor merely a checksum check. `PG_BIN` can select a
matching client directory; CI uses PostgreSQL 16 clients for its 16 server.
When the runner has no matching host clients, both restore suites use the already
owned pinned PostgreSQL container's clients, with binary dump/restore streams and
the container's internal port. No Ubuntu-specific package installation is needed.

Synthetic search/decompression/Blob characterization is recorded in the dated
execution receipt. No percentage performance claim or real-library capacity
guarantee follows from those measurements. The existing per-conversation archive
capacity limits stay enforced; streaming package redesign is not introduced.

## Recovery consistency follow-up

Current candidate source, 2026-11-05; exact-source CI acceptance and limits are recorded in
[the implementation receipt](../execution/RECOVERY_CONSISTENCY_2026-11-05.md).

- Source drafts coalesce dependency changes for 300 ms; close/pagehide/hidden
  visibility flush the latest revision. Returning to the saved baseline retires
  and removes the editor's own row. The first editing baseline includes version
  ID **and content hash**, since replace-current can retain the ID/number.
  Legacy/unknown bases require confirmation; bounded source/draft comparison is
  read-only. Browser termination is not a guarantee of a completed final write.
- Offline search projects the current notebook/description over stale package
  index documents, including explicitly cleared text. Missing legacy fields are
  not treated as deletions; conflict notebooks remain separate. Results open the
  correct description/notebook panel without changing package or Dexie versions.
- Pending imports separately expose source availability and derived draft state.
  Expiry does not imply lost originals. A locked, owner-scoped explicit preview
  rebuild accepts the observed `updated_at`, queues the existing analysis worker
  with rebuild intent, and preserves grouping/mapping IDs. It does not commit an
  import or automatically retry original sources. Missing sources retain a
  viewable session; commit is disabled. Stale/duplicate rebuild admission is 409.
- Personal archive preview includes incoming collection counts and current
  account capacity. Detail/history reads recalculate capacity. Admission checks
  it again, and restore locks the affected collections in tag-before-search order
  before any asset work. Overflow is an actionable 409, not “malformed archive”;
  there is no silent skip, limit increase, or selective restore in this batch.
  Existing restore receipts still return idempotent success. Input parsing wraps
  malformed-input exceptions, not exceptions thrown by the restore transaction.
- Attachment download keys bind to the normalized conversation/selection,
  serialized per owner/key with a PostgreSQL transaction advisory lock. Different
  payloads conflict even for failed jobs; explicit task retry/regeneration remains
  the recovery path. Existing availability/scanner checks still run.
- Share creation intent lives outside the panel, fenced by account epoch.
  Reopening in the same tab retains the original key and read-only result check;
  passwords remain memory-only. Full-page reload/crash recovery is **not**
  provided. Option/source changes invalidate preview, and late responses cannot
  publish a preview for another fingerprint. Existing Share URLs are unchanged.
- Explicit same-query search restarts page zero with a new generation. Refreshed
  pages replace their members/snippets; next offset is the server offset+limit,
  not the unique visible count. Tag selection remains represented during failed
  metadata reads, with read-only retry. This is not a server snapshot cursor.
  Result regrouping under a stationary mouse does not replace the document
  selected for keyboard navigation; real mouse movement can select another row.
- Tags reuse the collection recovery owner: retained create UUID, read-only check,
  explicit same-identity retry and manual conflict review. Search/saved-search
  caches invalidate on confirmed writes; unknown writes are not auto-replayed.
- Deferred modal-close focus restoration preserves a newer focused control,
  including a different field in the surviving form after cancelling a nested
  confirmation. Unowned focus still returns to the connected opener/fallback;
  a remaining top modal keeps keyboard ownership over the page underneath.
- Private search backfill persists each item cursor with its index transaction.
  A worker turn handles at most 100 conversations or yields after a two-second
  check at an item boundary. A single expensive item can exceed that time.
  Requeue preserves the cursor and yields to other queued jobs; no extra worker
  concurrency or storage migration is introduced.
