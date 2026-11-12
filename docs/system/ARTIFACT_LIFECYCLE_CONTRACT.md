# Artifact Lifecycle Contract

## Transaction outcomes and cleanup receipts — worktree 2026-11-12

Attachment finalize copies bounded staging input rather than moving its sole
retry source. Admission includes the additional file plus16MiB free-space floor.
Deduplicated storage is checked/locked; absent, quarantined or already-deleting
objects cannot be silently reused. Original staging stays until canonical commit.

New final objects are transaction-owned, including preview/image derivatives,
`.cr` and system archive restore/export. A definite rollback removes only that
attempt's output. ORM pre-commit rejection is not COMMIT uncertainty. Once the
connection actually starts COMMIT, use a fresh bounded PostgreSQL transaction
outcome check: committed releases input, aborted releases new output, unavailable
verification protects both. Serialization/refresh/cleanup after commit cannot
delete canonical files or turn confirmed business completion into failure.

Staging cleanup keeps committed/explicitly abandoned upload receipts; failures
set cleanup_pending and only retry remaining bytes. Ready/rejected/unknown inputs
are not age-purged. Asset GC previews at most100 candidates, locks/rechecks
references, leases and derivatives; an authorized deletion records status before
unlink and storage_deleted_at only after successful byte removal. No current or
historical attachment reference is aged away. A deleted object can be reused only
after confirmed byte cleanup, under lock and with a new storage key.

Temporary cleanup of owned export/archive/offline files reports its own failure,
never replaces the original error. Unknown/unreceipted historical files remain
protected; logs are not claimed to be a universal orphan-repair queue.
All production deletion and the unique verified backup remain outside this
local implementation. New backup verification must precede deleting the only
good copy; application archive tests are not a host-backup restoration exercise.

Conversation `.cr` restore remaps real Markdown destinations as well as
attachment occurrence IDs and render-block data. Changed versions receive
matching content hashes and rebuilt search projections; code examples and
historical source bytes other than actual destination IDs remain unchanged.
The compact definition-context cache is bounded to16 versions and does not
retain their message bodies. Archive format/version, duplicate policy, file
validation/scanning and one-transaction restore are unchanged. Personal
restore also leaves literal examples untouched while checking real references
against the owned restore scope.

## Private Context upload reclamation — worktree 2026-11-11

Only the exact `archive_upload` / `context-return-upload` / `context_return`
triple joins the existing temporary-export maintenance lane. Successful member
publication marks `release_requested_at` in the same transaction; it does not
delete the input receipt before unlinking. Inactive queued/failed/cancelled
uploads retain their existing24-hour expiry. Processing/cancelling inputs are
always protected, including expired ones; expired or already-releasing inputs
cannot be applied to Continuation again.

Reclamation shares the existing20-item budget, retry/backoff and two-phase
`reclaiming` boundary. It locks the artifact and skips an occupied job lock,
then rechecks both before unlinking. Controlled path, size/type/hardlink and
shared-reference checks still apply. Failure retains the receipt; confirmed
absence removes only this private artifact row, never the committed task or
member versions. These inputs remain unavailable through export/download/
regeneration routes, and cleanup does not add download fields to task results.
The old main-worker expiry/unlink loop is removed, not duplicated.

Other restore uploads, imports, canonical assets, offline copies and host
backups do not become eligible. Historical missing receipts and files orphaned
by account/conversation cascades remain under explicit manual cleanup/grace;
this does not claim those paths have durable automatic disposal. No migration,
new background task or general scheduled storage purge is introduced.
See the [local verification ledger](../execution/SMALL_HOST_OPERATIONS_2026-11-11.md).

## Recovery extension — released 2026-11-11

Owner conversation export POST accepts optional `background=true` for ordinary
`markdown_v2` / `canjson_v2`. The request must carry a stable idempotency key;
the original validated selection, metadata, versions, description, annotations,
notebook, source references, TOC and compression options are retained in the
existing `conversation_export` payload. The worker streams the same serializer
into a **single-file ZIP**, not an attachment bundle. ZIP publication, owner-only
delivery, transfer leases, expiry, regeneration, source/account rechecks,
transaction-owned rollback cleanup and configured byte limits are reused.
Expanded-byte admission precedes optional gzip. No schema/dependency change.

Key admission now locks and compares the complete conversation-export intent,
including terminal failed/cancelled receipts. A matching key returns the same
task; changed options/sources conflict. Explicit new generation uses a new key.
`GET .../exports/by-request/{key}` returns an owned matching task or `task:null`,
with no-store headers and no mutation. Absence cannot prove a delayed POST was
rejected. The UI offers read-only checking, followed by **explicit same-key**
retry if no receipt is visible. Unknown requests survive panel remount in the
account-generation-scoped query cache; this is not durable browser-restart
recovery. Late account results cannot bind outputs into a new account.

Direct-download budget/preparation failure offers the actual background path
with the same options; it does not silently enable binaries, discard notes or
expand scope. Ordinary files can explicitly use selected Reader messages.
An empty chosen selection blocks export rather than expanding to the whole
conversation; Context/attachment packages retain whole-conversation semantics
with an explanation. Server-size errors do not offer an unchanged futile
background retry. Users can adjust options/selection; backend limits remain.
HTTP preparation and stream inactivity have30-second bounds, not a total
deadline for a progressing stream. A timed-out preparation may still finish
server-side; no direct download is falsely reported successful.

Optional presets are a disclosure after the primary export action, retaining
save/rename/delete and unknown-result recovery. An unresolved request or failed
read remains indicated on the closed summary. Task Center size-limit failures
route back to source/scope adjustment instead of unchanged generic retry.

Local API/PG/browser checkpoints live in
[the ledger](../execution/RECOVERABLE_OPERATIONS_2026-11-10.md).
The context-package delivery retains its explicit “Download Context Package”
name; other export bundles use “Download export”. Earlier failed runs remain in
the ledger. Exact `3564cbf` / CI `42828329240` passed and is deployed; see the
[release receipt](../execution/RECOVERABLE_OPERATIONS_RELEASE_2026-11-11.md).

## Task Center follow-up — 2026-10-06 (deployed)

Same-generation background Continuation refresh keeps the existing immutable
export delivery mounted. An accepted regeneration binds its job and original
options to the owning panel before global refreshes, even if only its delivery
child was removed by an option change. Changed generations invalidate the match;
late account-generation responses cannot update another account's cache/events.
[Stage verification](../execution/TASK_CENTER_CLARITY_2026-10-06.md) distinguishes
the initial failed CI from the passing follow-up CI and production acceptance.

## Attachment bundles — 2026-10-06 (deployed)

`markdown_bundle` and `canjson_bundle` use one PostgreSQL READ ONLY / REPEATABLE
READ connection for metadata, canonical message serialization, secondary content
and attachment mapping. Concurrent edits cannot mix earlier object bytes with
later metadata. Source ownership/account availability and the copied objects'
scan/status are rechecked before publication. Snapshot consistency is not a
replacement for authorization. The separate `context_package` builder retains
its existing optimistic-change contract.

Each object is copied in at most 1 MiB reads, checking actual byte size and SHA-256.
Pre-existing unavailable files remain explicitly missing; mismatched/corrupt or
newly revoked objects fail the task without publishing. ZIP entries, objects,
expanded/compressed bytes, individual object size and CanJSON line/message counts
use existing configured limits. Progress callbacks run during copying as well as
between objects. Markdown paths escape spaces, parentheses and URL fragments.

Staging creation through publication is guarded by cleanup; new final files are
owned by the worker transaction and removed on rollback, including post-rename
failure. Serializer interruption closes nested iterators/sessions. Process crash
leftovers still follow orphan cleanup; this does not introduce general cancellation
for `conversation_export`. Existing expiry/close/transfer leases/regeneration and
download ownership remain in use. No schema or ZIP format migration.

See [stage evidence](../execution/ATTACHMENT_EXPORT_INTEGRITY_2026-10-06.md).

## Batch CanJSON ZIP extension — 2026-10-06 (deployed)

`conversation_batch_export` admits 1–5000 distinct owned sources and a required
idempotency key; ordered selection is part of the key's meaning. One worker
streams the existing CanJSON serializer sequentially into a ZIP under one
PostgreSQL read-only repeatable-read snapshot for all entries. Source/account
access is rechecked before publication. Entry/compressed/expanded bounds reuse
bundle limits. Failure produces no partial-success download.

New files are transaction-owned, so cancellation, rollback and commit failure
remove the new staging/final file. Crash leftovers retain the existing orphan
contract. This job joins the same retention, leases, reclamation, download and
regeneration paths as other exports. Regeneration reads the original ordered
source IDs against current ownership/data. ZIP entries remain CanJSON without
binary attachments, notes, annotations or Continuation; no schema migration.
See [stage evidence](../execution/BATCH_EXPORT_RECOVERY_2026-10-06.md).

## Direct downloads — 2026-10-06 (deployed)

Owner-only Markdown/CanJSON GET downloads, legacy `/export`, and the equivalent
synchronous POST `/exports` formats drain existing serializers under PostgreSQL
REPEATABLE READ / READ ONLY before sending headers. Metadata, selected messages,
versions, notes and attachment labels therefore come from one database snapshot.
The preceding read-only ownership transaction is released first, permitting a
one-slot pool. Download delivery holds no database connection.

Prepared bytes use a private SpooledTemporaryFile, spilling above 1 MiB; reads
are bounded to 64 KiB. Content-Length describes the prepared representation.
EOF, header/body failure and cancellation close the spool. Preparation storage
failure returns sanitized 503 and records no successful export event. The export
event commits after preparation; commit failure closes bytes and rolls back.
That event means preparation succeeded, not that the user saved the file.

Direct downloads have no retained artifact row and no three-minute retention
period. Preparation finishes before first response bytes; it can still continue
briefly after a disconnected client while synchronous serialization finishes.
The Web control buffers the response as a browser Blob before initiating a file
download, checks account access before/after body reading, and aborts on explicit
cancel, option changes, closure or account lock. Errors stay inside Reader.
Large downloads require temporary capacity on both server and client.

The dedicated attachment-bundle extension above covers background bundles. The
direct-download extension does not change Context/Share/offline/archive contracts.
No migration is added. [Execution record](../execution/DIRECT_EXPORT_SNAPSHOT_2026-10-06.md)
records local/CI tests and successful production acceptance separately.

## Export extension — 2026-10-06 (deployed)

Migration `20261006_0048` adds per-artifact lifecycle state and short usage/claim/
download leases. `export_retention.py` is the shared row-lock boundary for these
transitions; `export_download.py` renews leases only while the actual ASGI response
is sending. Range downloads retain FileResponse behavior. Root policy defaults
to three minutes and release-on-close; successful job publication pins the policy
and deadline. Existing artifacts retain their original deadline.

`GET /api/exports/{id}` reports actual expiry/state, not a renewed lifetime.
`POST .../usage` renews only a short view before the original deadline;
`POST .../release` signals explicit close of that view. `POST .../download-claims`
reserves a 15-second claim (bounded by expiry), then the original download route
accepts its optional `claim` parameter and upgrades it to an active transfer.
Without a claim, the old authenticated download route still acquires a real
transfer lease. No status request can keep an expired artifact alive.

The existing worker runs bounded reclamation while its one user job may be busy.
The 2026-11-11 worktree follow-up separates this single-flight housekeeping lane
from heartbeat publication; it does not add user-task concurrency. A pass has a
2-second cooperative budget, at most20 exports and20 expired frozen Shares,
alternating priority, with transaction-local PostgreSQL statement/lock deadlines.
Stop/budget checks before the next item/unlink leave durable `reclaiming` state
for later reconciliation, not false success. In-flight OS calls cannot be
forcibly canceled. See [liveness](OBSERVABILITY_CONTRACT.md#worker-liveness).
Rows transition active → reclaiming → reclaimed, or retry after an
unlink failure. Physical deletion only targets the checked job-owned export file;
restore uploads (apart from the exact Context exception above) and
canonical/offline data are excluded. Task rows persist for
regeneration. `POST .../regenerate` accepts Idempotency-Key and re-admits original
options against current owned sources; system archives additionally require Root.
Runtime status exposes aggregate pending count/bytes and failure count.

Client close signals, serialized claims, server-time expiry and regeneration are
connected to export, maintenance, backup and Task Center controls. Explicit scope/route
closure releases usage; blur, hiding, resizing and ordinary React disposal do not.
A refresh relies on bounded leases. The server and client both fence account changes.
Missing or size-mismatched files return unavailable rather than a misleading download URL.
Local browser, exact-source CI and production lifecycle acceptance pass; [release record](../execution/DEPLOYMENT_EXPORT_RETENTION_2026-10-06.md) states the limits. [Execution evidence](../execution/EXPORT_RETENTION_2026-10-06.md)
records the implemented boundary and failures/reruns. The historical contract
below continues to govern offline artifacts and archive-upload inputs.

2026-10-02 personal/system archive extension: uploads are internal ExportArtifact
references with `scope_type=archive_upload`, never downloadable via the export
route. They expire for new confirmation after 24 hours and remain referenced
until explicit source removal; active preflight/restore prevents removal.
Confirmation and removal share a database lock. Failed upload/export commits
and restore cancellation remove transaction-owned new files. A failed physical
source unlink leaves a managed orphan for the existing manual cleanup flow.
Both preflight types protect active source directories from orphan cleanup.
System restore retains saved choices after rollback. Both backups use the normal final export/download lifetime. Details are in
[Data Archive Contract](DATA_ARCHIVE_CONTRACT.md); Offline semantics remain.

2026-10-01 archive extension: canonical `.cr` checksum/record validation,
read-only export snapshots and transaction-owned restored-object cleanup are
defined in [Data Archive Contract](DATA_ARCHIVE_CONTRACT.md). Existing Offline
publication semantics below remain unchanged; final export orphans retain the
existing dry-run cleanup boundary.

## Scope

This contract covers Offline Package v2 files and Export artifacts. It does not
change the database models, export formats, Dexie v1 compatibility, or user
data lifecycle.

## Canonical publication

The worker owns the outer SQLAlchemy transaction and is the only layer that
commits the job and artifact rows. Builders create a unique staging file beside
the final path, close it, validate the archive and required entry, then publish
with `os.replace` on the same filesystem. The final path contains a server
generated job/package identity and is never a user filename path.

Release B closes and validates archive files before publication but deliberately
does not claim power-loss durability: it does not add file/directory `fsync`
calls or a filesystem transaction. Its guarantee is application-level
transaction/crash consistency for canonical DB references.

The frozen order is:

```text
staging -> validate -> publish unique final -> add/flush DB state
-> commit outer transaction -> ready/committed -> best-effort old cleanup
```

No service performs an extra commit. A failed commit may leave an unreferenced
final or staging file, but the previous committed artifact remains referenced
and available. Cleanup failure is cleanup debt, not publication failure.

`ready`/`committed` is only exposed for download after the job is committed and
the referenced final file exists with the declared size. Publication computes a
streaming SHA-256; download checks the controlled root, existence and declared
size without re-hashing large files on every request.

## Before and after

Before Release B, Offline replaced the new file, deleted the old file and old
row, then relied on the worker's later commit. A rollback could restore the old
row while the old file was already gone. Export builders also wrote directly to
their final name and download only checked a database row and path.

After Release B, old Offline files are collected as post-commit cleanup paths.
They are never deleted before the new DB state commits. All Offline and Export
ZIP builders use the same staging/validation/publish helper, and download
rejects a processing/failed job or a missing/mismatched final file.

Conversation `.cr` attachment enumeration is rooted in conversation-owned
Attachment rows, not occurrences or `DISTINCT` whole entities. Active
unreferenced rows remain canonical exports. A detached Attachment is included
only when a historical MessageVersion occurrence still references it. This
avoids PostgreSQL equality operations on JSON metadata while preserving
historical version readability.

## Crash matrix

| Point | Canonical DB | Files | Recovery |
| --- | --- | --- | --- |
| Before/during staging | old | old + partial temp | temp is not enumerated; dry-run may classify it SAFE_TEMP |
| Validated, before rename | old | old + validated temp | old remains usable; retry may publish a new unique file |
| After publish, before flush | old | old + orphan final | retry leaves old canonical state; orphan is ORPHAN_FINAL |
| After flush, before commit | old until commit | old + new final | rollback preserves old row/file |
| Commit succeeds | new | old + new | new is downloadable; old becomes cleanup candidate |
| Cleanup fails | new | old + new | publication remains successful; cleanup debt is logged/classified |

Filesystem and PostgreSQL do not share a physical transaction. The contract
protects canonical state rather than promising zero orphan files after every
process crash.

## Import recovery

Import stale recovery shares `MAX_AUTOMATIC_ATTEMPTS = 3` with BackgroundJob.
`attempt_count < 3` may requeue a stale processing record. At or above the
ceiling it becomes terminal `failed` with a manual-retry message and is never
recovered again by the stale scanner. An explicit retry starts a new bounded
lifecycle; it does not create an unbounded automatic loop.

## Cleanup eligibility and execution

Release C retains the Release B categories `SAFE_TEMP`, `ORPHAN_FINAL`,
`SUPERSEDED_ARTIFACT` and `UNSAFE_PROTECTED`, but makes their predicates and
execution contract explicit. Classification combines canonical DB references,
active job identity, server-controlled path shape and a configurable technical
grace window. Unknown paths, current artifacts, successful retained user
Exports and anything under AssetObject storage are protected.

`python -m scripts.artifact_cleanup` (from `apps/api`) is dry-run by default.
It reports aggregate counts/bytes plus opaque candidate tokens, never paths or
user filenames. Apply requires `--apply`, one eligible `--category` and one or
more exact `--confirm-token` values. Before each unlink the engine repeats the
full classification with fresh ORM state. Changed, referenced, active, recent
or absent objects are skipped safely. Deletion errors are reported as cleanup
debt and never change the committed publication result.

The detailed grace, two-pass evidence, idempotency, partial failure and
operator-approval rules are frozen in [Cleanup Contract](CLEANUP_CONTRACT.md).
Automatic cleanup remains disabled by default.

## Release J first production apply

Release J exercised the existing transaction and cleanup contracts against the
Release I production runtime. Four stable, unreferenced final Export files were
deleted only after backup, two-pass identity comparison and the engine's fresh
per-object DB/filesystem recheck. No canonical row or referenced file changed,
and replaying the old tokens was a no-op.

The post-apply publication smoke created a new final `.cr` file and committed
its job/artifact row. A targeted scan proved the file existed with the declared
size and was protected. After the disposable Conversation was deleted through
the product API, the now-unreferenced recent final remained protected by grace.
This production evidence closes the publish-versus-cleanup window without
changing publication order, retention policy, storage format or schema.

## Logging

Dedicated Context exports register both JSONL and ZIP staging paths before writes,
close streams before unlinking, and register unique published paths with the existing
transaction object tracker. Failure before DB flush, rollback/failed commit and
abandoned sessions remove those new objects. Temporary nonpersistent snapshots
remain owned by their caller's temporary-directory lifetime. A caught failure never
overwrites a previous result's physical path. Process crashes still use the existing
orphan/grace cleanup contract; synchronous cleanup is not a crash-proof DB/filesystem
transaction. See the Context contract and dated integrity-stage evidence.

Structured lifecycle events contain category, opaque artifact/job id, size,
attempt and state only. They never include message text, attachment content,
tokens, cookies, filenames supplied by users, or secrets.

Request correlation and aggregate diagnostics are defined in
[Observability Contract](OBSERVABILITY_CONTRACT.md). Historical lifecycle
counters are log-derived; no metrics table or migration is introduced.
