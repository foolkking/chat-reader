# Reviewed system optimization release — 2026-10-24

## Authority and scope

After reviewing and pruning the local changes and completing bounded follow-up
#135, the user explicitly requested commit and deployment. This supersedes the
earlier local-only hold, not the decision to stop open-ended optimization.

The batch retains commit-aware import-source protection, safe task-error
projection with fixed recovery messages, scoped/surviving import-result links,
uncertain-submission recovery copy and code-block copy recovery. #135 additionally
filters deleted or no-longer-owned committed results while retaining archived
and eligible legacy results. Small-fixture resource isolation and regression
tests remain. The release-document checker and unused health-helper change
stay reverted; #120 and conditional #133 are not started.

Implementation, red/green receipts and environment limits remain in the
[review record](SYSTEM_OPTIMIZATION_REVIEW_2026-10-24.md) and linked UX evidence.
No migration, dependency, API-field, offline package or Dexie format change.
The pre-existing generated `apps/web/tsconfig.tsbuildinfo` is preserved and
excluded from submission.

## Release gates

Use the existing complete `Build release images` workflow. For each dispatch
or retry, wait at least 50 minutes before reading results. All five jobs must
succeed for the exact submitted source. Download only that run's immutable
official artifact and independently verify provenance, OCI/image identity,
source content, compiled behavior and forbidden-path exclusions.

Freshly verify current runtime, rollback, schema, capacity and idle admission.
Stop only application writers, verify a five-component PostgreSQL/imports/
exports/offline/assets backup, then replace applications using CI images with
`--no-build`. Keep PostgreSQL, production env/Compose, Nginx and schema
`20261022_0053` unchanged. Verify health, worker freshness, image revisions,
HTTPS/denial boundaries, startup logs and OOM counters before acceptance.

Do not build production images locally/on the server, delete user data/volumes,
prune backups/images, restore historical text or automatically downgrade.
GitHub access uses existing credentials via API/CLI, not a new web login.

## Current checkpoint

Fresh pre-submit verification passed:

- Nine related API modules: **213 passed, zero skipped** with task-local temp.
- Web lint and nonincremental typecheck: passed; pre-existing build-info bytes
  remain unchanged.
- All service-free UX tests: **1,582 passed, zero skipped**; the focused
  copy/import tests are included, not additional independent coverage.
- Existing CI tools: **2 passed**; Alembic: single `20261022_0053` head.
- Reviewed scope, original historical records, retained reverts, local document
  links and diff whitespace: passed. No new migration or workflow change.

Read-only production preflight confirmed `18d4971`, rollback `0f116fe`, schema
0053, running/healthy services and no admitted background work. This is not
deployment acceptance, and these conditions must be reverified before cutover.
No CI or production acceptance is claimed yet.

Local SQLite, synthetic component fixtures and historical browser receipts are
not PostgreSQL concurrency, physical clipboard, authenticated production UI or
sustained-load acceptance.
