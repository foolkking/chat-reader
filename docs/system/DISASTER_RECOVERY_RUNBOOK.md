# Disaster Recovery Runbook

Current contract: a restore drill uses a new, isolated recovery environment and
never mutates the production database or named volumes. The drill proves
recoverability; it does not cut production traffic over.

## Authority and prerequisites

1. Identify the production runtime source, immutable API/worker/Web image IDs,
   Alembic revision, Compose project and the current verified backup. Read the
   values from the deployed system and backup manifest, not from a stale report.
2. Keep the production Compose file and `.env.production` separate from the
   recovery environment. Recovery credentials are ephemeral and must never be
   copied from production. When the restored database includes Release N auth
   state, use a fresh recovery `AUTH_SESSION_SECRET` so restored browser
   sessions are invalid, then provision the owner password through the
   recovery-only password-safe CLI.
3. Select a new Compose project name, loopback-only Web port, recovery network,
   database name and named volumes. Do not reuse any production identity.
4. Run `deploy/recovery_preflight.py` against an identity-only JSON plan. It
   refuses equal project/network/database/volume identities, port reuse,
   non-loopback Web exposure, storage-root overlap and a backup workspace inside
   a production business root.

## Backup contract

The current five-part backup contains:

- PostgreSQL custom-format dump
- `imports.tar.gz`
- `exports.tar.gz`
- `offline.tar.gz`
- `assets.tar.gz`

The backup directory also contains an aggregate-only source snapshot, a manifest,
`pg_restore --list` output, archive listings and `SHA256SUMS`. Verify all checks
before using the backup. Keep the verified backup after the drill; retention
cleanup is out of scope.

## Restore procedure

1. Create the recovery project and volumes only after preflight returns
   `status=PASS`. Inspect Docker Compose project labels, network labels and every
   volume label. Confirm the production volume-name intersection is empty.
2. Start only the recovery PostgreSQL service. Wait for its healthcheck and
   prove the target has no application tables before restoring.
3. Restore the custom dump with `pg_restore --no-owner --no-privileges` into
   that fresh recovery database. Run the repository migration command and verify
   `alembic_version` is the backup revision and equals the current application
   head.
4. Extract each business archive into its matching recovery named volume. The
   target paths are `/data/imports`, `/data/exports`, `/data/offline` and
   `/data/assets`; they must not be symlinks or bind mounts to production.
5. Start the exact immutable API, migration, Web and worker images. Do not build
   from a dirty checkout. Verify container image IDs and OCI source-revision
   labels before acceptance.

## Acceptance

Run `deploy/recovery_integrity.py` inside the exact recovery API image with the
backup `source-snapshot.json`. The audit emits aggregates only and checks:

- row-count and storage count/byte equality;
- current MessageVersion and AttachmentOccurrence relationships;
- AssetObject, source-import, export, offline and Share foreign-key integrity;
- AssetObject and retained artifact size plus SHA-256;
- duplicate Attachment-to-AssetObject groups and active-unreferenced rows;
- zero canonical `cr-upload://` references.

Before starting the recovery worker, diagnostics must classify the restored old
heartbeat as `stale`. After startup the new worker instance must publish a new
heartbeat and become `alive_idle`. Create a small QA job through the normal API,
observe `alive_busy`, and wait for `alive_idle` again. The operator diagnostics
request must be loopback/operator-only, `no-store`, request-traceable and free of
message content, filenames, payloads, tokens, credentials and full paths. The
Web/public path must remain denied.

For repeatability, tear down only the first recovery project, verify its labels,
then remove its exact recovery volumes. Restore the same immutable backup into a
second fresh project with different network, database, volume and port identities.
The second integrity report must match the first critical aggregates and return
zero canonical dangling references and missing required files.

## Failure and cleanup

If a command/session disappears during restore, inspect the recovery target first;
do not resume a partially known target. Discard only that recovery project and
repeat on a fresh target. Never redirect recovery to production. Classify failures
as backup, restore-tool, schema-compatibility, environment or tooling defects.

After evidence is preserved, stop the recovery Compose project without using
`docker compose down -v`; inspect each volume label, remove only the exact
recovery volumes and network, and verify no production container, volume or
health state changed. Do not delete the verified backup. Production DR cutover is
`NOT_EXECUTED_BY_DESIGN` for this drill.

## Measured Release M characterization

The verified backup `release-m-20260816T161711Z-baca93b` was created at
`2026-08-16T16:17:11Z` and completed at `16:18:19Z`. Recovery A started at
`16:23:08Z`, restored the database at `16:25:57Z`, restored volumes at
`16:26:06Z`, reached API/Web health at `16:30:47Z`, and completed idle/busy
business acceptance at `16:47:29Z`. The measured end-to-end recovery duration was
24 minutes 21 seconds. Recovery B restored the same backup at `16:58:12Z` and
`16:58:22Z` for the database and volumes. These are observations, not an RPO/RTO
SLA.
