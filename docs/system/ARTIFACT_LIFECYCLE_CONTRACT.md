# Artifact Lifecycle Contract

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

## Cleanup dry-run

`python -m scripts.artifact_cleanup_dry_run` (from `apps/api`) reports aggregate
counts and bytes only. It classifies system-controlled artifact roots as
`SAFE_TEMP`, `ORPHAN_FINAL`, `SUPERSEDED_ARTIFACT`, or `UNSAFE_PROTECTED`.
Current DB references are always protected. Automatic deletion is not
implemented in Release B.

## Logging

Structured lifecycle events contain category, opaque artifact/job id, size,
attempt and state only. They never include message text, attachment content,
tokens, cookies, filenames supplied by users, or secrets.
