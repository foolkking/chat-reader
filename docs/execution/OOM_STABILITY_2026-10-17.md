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

No global VM/swappiness/overcommit change, API/Web service memory cap,
OOM-score reprioritization, production restart, production Docker operation,
database change or data deletion was made as part of this source-only repair.
The current deployed source remains `aea13fe` until exact-source CI and a
separately verified release are accepted.

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

These are focused source checks, not the full release workflow. Exact-source
CI has not yet been dispatched for this repair, and no candidate image has been
built or deployed. After dispatch, stop and wait for the user to report CI
results. Do not claim OOM prevention for all workloads or zero-downtime
availability from process auto-restart.
