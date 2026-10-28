# Search and reader recovery release — 2026-10-28

## Authority and scope

The user authorized **submission and deployment** of the completed workspace
batch. This supersedes the implementation checkpoints' earlier no-submission
boundary, not their unverified results. Keep the changes together; do not start
another optimization cycle.

- Search correctness, exact destinations, scoped/offline recall, repeated
  activation and content-index lifecycle.
- Share expiry/copy recovery, account-scoped comment drafts, paginated search,
  TOCs, file references and conversation lists, and per-file upload recovery.
- The nine completeness follow-ups: delete intent, transactional rename
  derivation, ordering bounds/direction/priority, TOC append anchoring, bounded
  Office coordinates/relationships/shared strings and typed ZIP failures.
- Existing regression sources and corresponding implementation/audit records.
  Exclude the pre-existing `apps/web/tsconfig.tsbuildinfo`.

No migration, dependency change, production configuration change, canonical
rewrite, Share URL change, `.cr` change, offline package v1/v2/v3 change or
Dexie v2 change is included. Do not rescan/apply cleanup to user data.

## Validation and release gates

The inherited **no local tests, lint, typecheck, build, browser, services or
database** boundary remains. Static source/Git inspection is not a runtime
PASS. CI performs validation; no gate or assertion is weakened.

1. Commit/push the bounded batch, dispatch complete `Build release images` for
   its exact source, then wait **at least 50 minutes after every dispatch**
   before reading results. A new run starts a new wait.
2. Require all five jobs. Independently verify the official immutable artifact,
   source/run/attempt, archive digest, OCI chain, image identity, forbidden paths,
   embedded source and exact-source deployment support.
3. Freshly verify production identity, rollback, idle queues and capacity.
   Stop application writers only; resource-bound attachment integrity checks
   and a verified PostgreSQL/imports/exports/offline/assets backup precede
   application replacement.
4. Load verified CI images, check unchanged migration head/current, and
   recreate API/worker/Web with `--no-build --no-deps`.
5. Check exact images, health/worker freshness, HTTPS/denial/privacy boundaries,
   unchanged PostgreSQL/configuration, canonical aggregates, logs and OOM.
   On failure, restore the previous verified images without database downgrade.

Never build applications on the workstation or King, overwrite production
env/Compose/Nginx, restart PostgreSQL, delete user data/volumes, prune backups/
images, or run full diagnostics inside the serving API.

## Checkpoint

Release preparation is in progress. The prior accepted production/direct
rollback is `b4effda`/`c7dc074`, schema `20261022_0053`; this is a recorded
baseline, not a fresh host verification. No CI or production result is claimed
at this checkpoint. Exact submission, CI, artifact, backup and acceptance facts
will be recorded as they occur.

Implementation evidence and remaining verification boundaries:

- [Search correctness](SEARCH_CORRECTNESS_2026-10-27.md),
  [offline recall](SEARCH_RECALL_OFFLINE_2026-10-27.md) and
  [lifecycle](SEARCH_LIFECYCLE_2026-10-27.md).
- [Reader recovery](UX_AUDIT_OPTIMIZATION_2026-10-28.md) and
  [completeness follow-ups](UX_AUDIT_COMPLETENESS_IMPLEMENTATION_2026-10-28.md).
- [Verification matrix](../testing.md). Same-runtime failed-delete intent is
  not durable through forced reload/crash; bounded Office previews are not
  full fidelity or malicious-document certification. Authenticated production
  UI, physical clipboard and sustained-load acceptance are not implied by CI.
