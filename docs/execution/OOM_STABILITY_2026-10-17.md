# OOM stability and diagnostics isolation — 2026-10-17

## Confirmed incident and scope

The old API container exited **137** at `2026-10-16T14:35:34Z`; Docker restarted
it two seconds later. Kernel records identify `constraint=CONSTRAINT_NONE` and
`global_oom`: this was an involuntary host-memory kill, not an intentional
deployment stop or application shutdown. The victim Uvicorn process held about
162 MiB RSS; a contemporaneous extra Python diagnostics process held about
125 MiB. The shared King host exposes roughly 1.87 GiB RAM. Swap was free at
the incident but `vm.swappiness=0`, so it was not reliable extra capacity.

Source trace established the peak mechanism: the old operational health
verification invoked the full diagnostics module from inside the serving API
container, creating a second Python interpreter. That module imports the ORM,
runs multiple database aggregations and traverses managed storage. The event
confirms this diagnostic-triggered host OOM path; it does **not** establish a
persistent leak in API business requests. Shared-host risk from uploads,
unrelated applications, PostgreSQL or other peaks remains.

## Source changes

- Split `available_memory_bytes` into a dependency-free core probe shared with
  existing upload admission; existing upload decisions are unchanged.
- Readiness no longer invokes full diagnostics or a second API interpreter. It
  checks Docker health/process state and executes one parameter-validated,
  read-only PostgreSQL query for worker `primary`, with transaction-read-only,
  5-second statement and 1-second lock timeouts. Missing, future, stale,
  malformed or unknown worker states fail closed. The configured worker stale
  threshold remains authoritative, limited to 1–86,400 seconds.
- Explicit operator diagnostics use the new shell wrapper, a host-wide
  nonblocking lock, two checks for at least 512 MiB host `MemAvailable`, and the
  immutable image of the currently running API. A one-off Compose overlay caps
  it at 0.5 CPU / 256 MiB RAM / 384 MiB RAM+swap, read-only filesystem and
  read-only business-storage mounts, with no restart and a 35-second hard stop.
  Cleanup checks the unique invocation name, Compose one-off label and exact
  image before removing anything. Never apply this overlay with `up` or invoke
  full diagnostics in the serving API.
- The Python diagnostic CLI refuses serving Uvicorn/Gunicorn PID 1 before ORM
  imports, fails closed on unknown/low production memory, and has a 25-second
  execution deadline. In-process operator diagnostics defer below 256 MiB with
  a privacy-safe 503 and `Retry-After`, preserving the ordinary `/api/health`
  contract.
- PostgreSQL diagnostic transactions are read-only with 1.5-second statement,
  1-second lock, 4 MiB work-memory and no parallel workers. Each filesystem root
  and cleanup scan has a 2,000-entry/150-ms diagnostic budget; cleanup also
  caps files at 1,000. The general/manual cleanup API retains its previous
  default scan semantics and protections. Partial snapshots remain incomplete.

At the source-only checkpoint, no global VM/swappiness/overcommit change, API/Web service memory cap,
OOM-score reprioritization, production restart, production Docker operation,
database change or data deletion was made as part of this source-only repair.
The deployed source at that checkpoint was `aea13fe`. The subsequent accepted
release below supersedes that deployment boundary without rewriting it.

## Verification

- Focused local API suite: **112 passed / 3 skipped** across diagnostics,
  worker liveness, admin runtime, uploads, attachments, storage cleanup and
  synthetic shell wrappers.
- Separate disposable PostgreSQL 17: **2 passed**. The real transaction test
  verifies read-only mode, all limits, `pg_sleep` cancellation by the statement
  deadline, and restoration of session defaults after rollback. Another test
  evaluates the exact heartbeat SQL from the shell script against missing,
  idle, busy, stale, future and unknown synthetic rows.
- King Linux, Python 3.6-compatible synthetic shell harness: **27 passed**,
  including readiness states, SQL/threshold rejection, unknown and low memory,
  post-lock memory recheck, timeout/exit cleanup ownership and cross-release
  `flock` contention. Fake Docker intercepted every invocation; **zero real
  Docker commands** ran.
- `sh -n` for both operational scripts, Python `compileall`, and `git diff
  --check` pass. A Windows API pytest run separately passed **112 / 3 skipped**;
  live cross-release lock validation was exercised only on Linux.
- The lightweight script was separately run once against the still-deployed
  production services using read-only Docker inspection and a read-only
  heartbeat query: PostgreSQL/API/Web healthy and worker `alive_idle`. This
  verifies the probe against the current topology only; no candidate code/image
  was installed and no full diagnostic was run in the serving API.

Those were focused source checks, not release acceptance. CI was then dispatched
and work stopped for the user's result as requested. The independent workflow
and deployment checks below are separate evidence; neither establishes OOM
prevention for every workload or zero-downtime availability.

## Accepted release

- Source: **`3e68d1f78c7293ef7cb2d45f25a4814da3a70908`**.
- CI: **38933466143**, attempt **2**, all five jobs successful. Attempt 1's
  image build failed on Public ECR metadata retrieval with HTTP 429/data limit;
  it was not an application compilation failure and no gate was bypassed.
- Original image artifact: **12082341034**. Original ZIP digest, all **50 OCI
  blobs**, layer diff IDs, four tags, two image configs, embedded API repair
  source/build revisions, Web revision/Skill packages and all exact-source
  deployment support files pass independent verification.
- API/worker image:
  `sha256:20e1b2dab489f1b43b34cf04bfea4383a6d73b03d584626b6edcf7f640a9320b`.
- Web image:
  `sha256:c061724f9b93daead02b3e37315897bb2cd8f8b14435ceb6e96894bf7e2081a4`.
- King acceptance: **2026-10-17 00:53:53 UTC**; independent final audit
  **00:58:47 UTC**. See [sanitized evidence](../evidence/oom-release-2026-10-17.json).

### Operations and failed first attempt

Preflight confirmed the old accepted source, idle worker/no admitted jobs,
0051 database, healthy services and sufficient disk. A fresh five-component
backup **`chat-reader-20261017T003936Z`** passes dump TOC, all checksums and
archive verification. It was captured **before stopping writers**, after an
idle check: it is not claimed as an atomic cross-component snapshot. The older
stopped-writer **`chat-reader-20261016T152523Z`** recovery point, the
`20261012T143850Z` backup and independent orphan preservation remain untouched.
No retention pruning occurred.

Only Web/API/worker were stopped and replaced; PostgreSQL was never stopped.
The first replacement reached healthy services, but the task-scoped acceptance
helper used a dotted Docker label key as a template path, falsely treating the
present correct revision as missing. Its trap restored the unchanged aea13fe
applications, leaving pointers/database/configuration unchanged. The corrected
second attempt used `index .Config.Labels "org.opencontainers.image.revision"`
and reused the verified backup. It passed all checks before updating pointers.
This was planned maintenance with downtime, not a zero-downtime rollout.

The idle old worker did not exit during its 60-second first stop or 120-second
second stop; Docker forced exit 137 with **`OOMKilled=false`**. This was an
explicit operator stop, distinct from the earlier spontaneous host OOM.
Graceful worker shutdown is a separate local follow-up, not fixed by this image.

### Acceptance and recovery boundary

- API/Web healthy; worker `alive_idle` with fresh heartbeat; HTTPS health 200,
  HTTP entry redirects 301 to the expected HTTPS origin, public diagnostics 404.
- All three applications match exact image IDs/revision and have zero restarts,
  zero OOM kills and zero startup error-keyword lines at acceptance.
- PostgreSQL container identity/start/restart count, production `.env`, Compose,
  Nginx and the operational checkout match the prior accepted baseline.
- Database remains **`20261015_0051`**: no migration, reconciliation, backfill,
  storage mutation, file deletion or data restore ran. No live full-hash sweep
  or full internal diagnostics was run. No new production browser/authenticated
  UX acceptance is claimed for this operational repair.
- Current/direct rollback is **3e68d1f/aea13fe**; exact previous images remain
  loaded. Both use **0051**: do not downgrade for this direct rollback. The
  historical 0051→0050 consent-revoking downgrade remains mandatory only for
  targeting 84988a2 or older. The release-state warning distinguishes both;
  its previous text is preserved in this release directory.
- The direct rollback lacks the OOM fix. Use the new release's lightweight
  health helper even when reverting applications; never run full diagnostics
  inside the serving API. Existing operational checkout scripts were not hotpatched.

After deployment the user requested continued **local-only** optimization:
do not proactively dispatch CI, push or deploy again without a new request.
No shared-host memory guarantee, off-site/scheduled backup or zero-downtime
claim is made.
