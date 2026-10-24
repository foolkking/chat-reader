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
No migration, API-field, offline package or Dexie format change.
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

## Pre-submit checkpoint (historical)

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
No successful CI or production acceptance is claimed yet.

## First CI and narrow security prerequisite

Source `e7ab2db4bd8161b64dec4fc3885048537c7433d2` was pushed and dispatched in
CI `40091984323` at **2026-10-24 11:57:56 UTC**. First result read:
**12:47:57 UTC**, after the 50-minute gate. API and settings passed; Web failed
at dependency audit, so image build/inspection were skipped. Nothing deployed.

Official npm and the primary GitHub advisory API confirmed new high
`GHSA-mrhx-c7xc-m3w5`: transitive Zod 4.4.3 must become fixed 4.6.6, compatible
with assistant-ui's existing range. The same audit rejects an unused braces
exception: upstream withdrew `GHSA-vfj7-8cjw-p6xm` on **2026-10-23 12:53:02 UTC**.
Remove that stale exception, not the policy that rejects unused entries.
Retain the existing bounded braces patch/regressions; no new exception or
security-gate relaxation. Other low/moderate findings are reported, not hidden.
This is a release prerequisite, not renewed open-ended optimization.

After the lockfile-only dependency resolution, official audit has **zero
high/critical, zero exceptions, zero policy errors**; the remaining low/moderate
findings stay reported. Only Zod changes in the dependency graph. Web lint,
nonincremental typecheck, all **1,582** service-free UX cases and **9** existing
braces/source-map security regressions pass. A task-local 96 MiB/15-second
subprocess checks the actual assistant-ui Zod resolution: an oversized
250,000-element constrained array is rejected with one size issue before any
element validation; valid collections and valid/invalid message schemas retain
their behavior. This is synthetic bounded validation, not sustained-load or
complete production runtime acceptance.

The corrected source required a new complete CI and a fresh 50-minute wait.

## Final CI, artifact and production acceptance

Corrected exact source **`3fbf79dd0f1da2906ff32d202dfa85cb8544c612`** was pushed
and dispatched in [CI 40095860923](https://github.com/foolkking/chat-reader/actions/runs/40095860923)
at **2026-10-24 12:54:16 UTC**. Its fresh read deadline was
**13:44:16.414583 UTC**. First read at **13:44:18 UTC** found all three quality
jobs successful and image building in progress; the **13:48:01 UTC** check
confirmed all five jobs successful. No early result read or partial-gate
deployment occurred.

The exact official artifact passed independent inspection: **35 OCI blobs**,
**344 exact source files**, complete image-descriptor/config/layer bindings,
matching API/Web revisions and compiled code-copy/import-recovery markers.
Forbidden paths are absent. Archive SHA-256:
`2e20649891cc4ffc2243b799e8c17874b25e9ba473149b9b9817aa85e9ac5875`.
All ten transferred support/proof files and exact-source LF helpers were
verified before maintenance.

Fresh production preflight confirmed current `18d4971`, prior rollback
`0f116fe`, schema 0053, no admitted work and sufficient combined backup/image/
transfer capacity. Application writers alone were stopped during
**2026-10-24 13:53:38–14:02:16 UTC / 21:53:38–22:02:16 +08:00**.
Read-only storage audit verified **346/346** stored files and SHA-256 values
with zero issues. The stopped-writer five-component backup
**`chat-reader-20261024T135352Z`** passed component hashes, manifest and
PostgreSQL restore-TOC verification.

CI images were loaded and applications recreated with `--no-build`; no local
or server application-image build occurred. Migration stayed at single
**`20261022_0053`**, with stopped-writer canonical counts unchanged. PostgreSQL
identity/start time, production env/Compose, Nginx and the existing public-image
privacy location remained unchanged. No imports, volumes, backups or old images
were deleted or pruned.

Production accepted at **2026-10-24 14:02:16 UTC / 22:02:16 +08:00**.
API/Web are healthy, worker is running with a fresh `alive_idle` heartbeat, and
all three application revisions match `3fbf79d`. HTTPS, redirects, private-route
denial, missing-public-capability 404/no-store, clean startup logs, zero
application restarts and unchanged host OOM counter passed. A repeated
lightweight check passes. Its first repeat omitted the production Compose
working directory/environment and exited before checking containers; rerunning
with the exact production context passed without changing runtime or config.
Final available capacity was **5,423,235,072 bytes**.

Current/direct rollback pointers are **`3fbf79d`/`18d4971`**, both at 0053;
rollback needs no schema downgrade. This was a bounded maintenance outage, not
zero-downtime deployment. No authenticated production browser, physical
clipboard, installed external client or sustained-load acceptance is claimed.

Local SQLite, synthetic component fixtures and historical browser receipts are
not PostgreSQL concurrency, physical clipboard, authenticated production UI or
sustained-load acceptance.
