# Offline package snapshot consistency — 2026-10-08

Status: locally repaired; API/PostgreSQL gates pass. Browser acceptance pending.

## Evidence and change

Real PostgreSQL reproduction generated an offline ZIP while another session
replaced an editable message's source. The published package retained the earlier
offline revision but contained the replacement body. The initial fixture tried to
replace an initial version and was correctly rejected; after creating an editable
version, the baseline failed on the actual exported body comparison.

`build_offline_package` now uses the existing `archive_read_snapshot` context for
all package reads. On PostgreSQL this is one read-only REPEATABLE READ connection;
the worker's publication session remains separate for progress and artifact rows.
SQLite retains the existing session path. Previous-artifact cleanup is still
deferred until the owning worker transaction commits. The snapshot closes on
success or error; no additional persistent source copy is created.

The package represents a consistent earlier point, not a promise to include edits
made while it is generating. Subsequent source revisions remain eligible for the
next download. No offline package, Dexie, schema or endpoint version change.

## Acceptance

- **5 PostgreSQL cases passed**, zero skipped: four combinations of new-version /
  same-version replacement and progress-session commit / no commit, plus existing
  concurrent download admission/idempotency coverage.
- Exported ZIP contents were opened and checked: source revision, actual message
  body and search body remain from the same earlier snapshot; the concurrent edit
  is separately committed with a later revision.
- **19 API cases passed**, zero skipped: offline annotations/packages, historical
  anchor ownership, artifact transaction failures and lifecycle behavior.
- The snapshot holds database rows consistent; this batch does not establish
  filesystem attachment immutability or new browser acceptance.
- No frontend change; Web lint/build/PWA not rerun. Earlier browser-start approval
  remains unresolved. No commit, CI, deployment or production access.

Aggregate evidence: `offline-snapshot-consistency-2026-10-08-evidence/results.json`.
Task files use desktop `wkkk/chat-reader-offline-snapshot-20261008`.
