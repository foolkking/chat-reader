# Accumulated settings and offline improvements — 2026-10-08

## Scope and authorization

The user explicitly requested recovery of task
`01a0f1c6-52e7-7a42-ab33-61d52e1d7bcb`, commitment and CI of its accumulated work,
production deployment after verification, then a further evidence-based product
audit. The original goal remains active. Earlier checkpoints saying that no
commit or deployment was authorized describe their original local-only batches;
this request supersedes that release restriction.

The release includes the accumulated settings, sharing, archive, support,
administration, noise-review and offline recovery changes since `975c1ee`.
Migration 0049 adds the cleanup-request lookup index; 0050 adds and conservatively
backfills exact source fingerprints. Current/Index remain directly managed files;
the three default Skill ZIPs, existing Share URLs, archives, Dexie v2 and offline
package v1/v2/v3 compatibility remain required boundaries.

## Local checkpoint

- The original loopback Web start was attempted once in the new task. The tool
  rejected it before process creation with only `blocked by policy`. No rejecting
  rule or automatic-review rationale was supplied. No alternate local launcher
  was used, and the existing isolated database/storage remain preserved.
- Local lint, nonincremental typecheck, bounded production build and single
  Alembic head `20261008_0050` pass. The first typecheck invocation incorrectly
  forwarded an extra `--`; it executed zero type checks. The corrected invocation
  passed. No product defect is inferred from that command error.
- The current offline target/task/attachment gate passes **33 tests, zero skips**
  in **58.37 seconds**. All temporary output is under
  `C:/Users/86182/Desktop/wkkk/chat-reader-release-resume-20261008`.
- Settings discovery finds **439 cases in 57 files**, including the 16 formerly
  pending selection/offline cases. Discovery is not execution. Existing release
  CI will execute them against its isolated authenticated PostgreSQL/API/worker
  fixture. This is not a local specified-Chromium acceptance claim.
- Earlier local full-API and PostgreSQL evidence is retained in its dated records;
  it does not substitute for the new source's complete CI.

GitHub access was verified using the existing repository credential in process
memory; no credential was displayed or saved. The production read-only preflight
found healthy API/Web/PostgreSQL, a running worker and source `b45f049` images.
The server checkout has older operational modifications: deployment must preserve
its Compose and environment, and stage exact-source support files separately.

## Release gates and remaining work

No production change has occurred at this checkpoint. Record the source commit,
all CI job outcomes, original artifact/producer identity and independent image
inspection before deployment. Verify attachment storage, a consistent backup,
capacity and rollback image availability; stop old application writers for 0050,
keep PostgreSQL running, migrate with the exact new API image and recreate only
API/worker/Web with `--no-build`.

Afterward verify runtime source, single current/head, service health, worker
heartbeat, aggregate canonical/file preservation and relevant read-only endpoints.
Application testing must use isolated data; production pages are not a substitute
for the blocked local browser gate. Preserve failed runs and report skipped or
unverified cases separately. Only then continue the next product audit.
