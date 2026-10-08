# Offline revision concurrency — 2026-10-08

Status: repaired and verified at API/PostgreSQL level. Browser acceptance pending.
Local only; no release or new migration.

The new `tests/test_offline_revision_postgres.py` uses a disposable PostgreSQL
database migrated to head. Two independent sessions retain the same conversation
revision and successfully edit different messages, committing the first before
the second. Both new bodies persist, but the final revision equals the intermediate
revision (7). The assertion requiring a newer revision fails.

This is a deterministic overlapping-session reproduction, not a simultaneous
thread stress test. An offline copy downloaded between commits can retain the
intermediate revision. `services/offline_packages.py` compares known revisions by
equality when selecting downloads, so this collision can suppress an update.
Actual browser download acceptance has not run.

Baseline: **1 failed, 0 passed, 0 skipped**, 6.10 seconds. Both saved bodies were
verified before the failing revision assertion. XML remains in task directory
`chat-reader-offline-revision-20261008` beneath desktop `wkkk`; raw output is not
copied into documentation. Test schema teardown completed; production untouched.

Required repair: atomic database increments with accurate in-session values and
rollback. Audit editing/version operations, annotations, Continuation, project
changes and merge; a message-only fix leaves other stale writers. Check lock
ordering, repeated changes, initial creation, rollback and existing edit/cleanup
races. Do not introduce early commits or alter offline package/Dexie versions.

## Repair and verification

`conversation_revision.bump_offline_revision` queues SQL increments at existing
flush boundaries, preserving repeated increments before flush and rollback.
All current increment sites now use it: edits/versions, annotations, direct
Continuation updates, projects, merge and conversation metadata/status routes.
SQLAlchemy expires expression values after flush, restoring integer reads.

The first simultaneous-thread test found a second failure: one transaction waited
to increment the conversation while the other rebuilt search documents and waited
for an FK KEY SHARE lock on the first transaction's message. The source guard and
cleanup message locks now use NO KEY UPDATE, protecting source writes without
blocking those FK checks. No early commit or conversation pre-lock was added.

Final gates: **49 API and 12 distinct PostgreSQL passed, zero skipped**. A further
run of the simultaneous-edit case verifies both persisted search bodies and current
version references (one overlapping case, not an extra distinct test). Migration
head remains `20261008_0050`; diff whitespace check passes. API coverage includes
message editing, projects, offline annotations/packages, direct Continuation,
split/merge, history/cancellation and cleanup source/validation work. PostgreSQL
covers stale sessions, true simultaneous edits, repeated increments, rollback,
annotation invalidation and the previous source/cleanup races and migration tests.

Intermediate results are retained: initial lost-increment failure; first concurrent
gate 4 passed/1 deadlock failure; repaired PostgreSQL gate 12 passed. Two API JUnit
warnings concern existing timing properties under xunit2, not skipped tests.
No Web code changed; Web build/lint/PWA/browser tests were not rerun. Prior browser
startup approval remains unresolved and is not counted as acceptance.

Aggregate evidence: `offline-revision-concurrency-2026-10-08-evidence/results.json`.
The broader goal remains open. No commit, push, CI or deployment.
