# Cleanup Contract

## Safety objective

Cleanup may reduce internal Export/Offline artifact debt only after canonical
database references, job state, path ownership, age and a final recheck prove
that deletion cannot affect business state. Data safety is more important than
recovering disk space.

The cleanup engine manages only the configured Export and Offline roots. It
never manages PostgreSQL, imports, backups, AssetObject storage, Attachment
files or unrelated filesystem locations.

## Categories

`SAFE_TEMP` is a server-generated staging name in a recognized artifact
namespace, not referenced by canonical state or an active job, and older than
the grace window.

`ORPHAN_FINAL` is a server-generated final Export/Offline path with no canonical
DB reference, no active job reference and an age beyond the grace window.

`SUPERSEDED_ARTIFACT` is an old committed Offline artifact that is no longer
canonical, has no active reference and satisfies the grace window. A completed
user-facing Export is not superseded merely because it is old.

`UNSAFE_PROTECTED` includes canonical/current files, active or recent job
artifacts, successful retained Exports, unknown names, symlinks, paths outside
managed roots and any ambiguous state. Unknown always means protected.

AssetObject garbage collection is explicitly not implemented.

## Grace and stable evidence

`ARTIFACT_CLEANUP_GRACE_HOURS` defaults to 24. This is a conservative technical
race window aligned with existing task/draft operational TTLs. It does not
change any user-visible Export retention contract.

Each candidate receives an opaque token derived from its managed relative path,
category, size and modification time. The default dry-run can be repeated; a
stable token across scans is evidence that the object did not change. Tokens
are CLI-only operational identities and diagnostics HTTP responses do not
expose them.

## Commands

Dry-run is the default and deletes nothing:

```text
cd apps/api
python -m scripts.artifact_cleanup
```

Deletion requires every safety signal to be explicit:

```text
python -m scripts.artifact_cleanup --apply \
  --category ORPHAN_FINAL \
  --confirm-token <opaque-token>
```

An apply without a category or confirmed token is rejected. Categories are
applied independently; there is no apply-all mode.

## Final recheck and race handling

Before each unlink the engine starts a fresh classification after expiring ORM
state. It rechecks canonical references, active job state, controlled path,
category, grace, size and mtime. If the candidate became referenced, active,
recent, changed, unknown or outside its managed root, it is skipped. A file
that disappeared is an idempotent `already_absent` result.

The per-object result reports requested, deleted, deleted bytes,
already-absent, changed/skipped and failed counts. Permission or filesystem
failure is cleanup debt and does not modify canonical DB state. Other eligible
objects may complete, and partial failure is reported accurately.

The grace window, active-job check and final recheck protect the publication
window after final rename but before DB commit. Publication remains governed by
the Artifact Lifecycle Contract and never waits for this cleanup CLI.

## Production procedure

1. Verify API/Web/PostgreSQL/worker health and a valid backup.
2. Run dry-run twice and compare category counts/bytes and opaque tokens.
3. Confirm current/protected artifacts are not candidates.
4. Present the exact aggregate candidate set for operator approval.
5. Apply only the approved category/tokens.
6. Re-run dry-run and production health/artifact smoke checks.

The first production apply always requires separate operator approval. Release
C deployment or a request to run Release C is not deletion approval.

Automatic scheduled cleanup is disabled by default and not enabled by Release
C. Direct SQL deletion is never part of this procedure.

## Release J first-apply evidence

Release J used this contract without a runtime change. A verified five-part
backup preceded two stable production dry-runs and a final pre-apply scan. The
same four opaque `ORPHAN_FINAL` identities totaled `659,673` bytes; no
`SAFE_TEMP` or `SUPERSEDED_ARTIFACT` object was eligible.

The bounded apply requested and deleted exactly those four files. Failed,
changed/skipped and already-absent counts were zero. Both post-apply dry-runs
reported zero eligible objects, while replay of the old tokens deleted zero
and skipped all four as stale. Canonical DB counts and all referenced Export/
Offline files remained intact.

A new disposable committed Export was subsequently proven to be present,
size-matched and absent from candidates. After product-API QA cleanup its final
file became unreferenced but remained `UNSAFE_PROTECTED` because it was inside
the 24-hour grace window. It was not manually deleted. This is the intended
publication/cleanup race behavior.

Release J does not authorize future applies. Every later apply needs a new
stable identity set and explicit approval. Automatic cleanup remains disabled
and AssetObject GC remains unimplemented.
