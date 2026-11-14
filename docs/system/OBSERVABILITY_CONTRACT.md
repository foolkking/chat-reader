# Observability Contract

## Supervised single execution — worktree 2026-11-12

One worker service now runs a lightweight supervisor and at most one fresh
execution child. The child receives only kind/ID/token, opens its own DB
connections and calls existing handlers. Dedicated PostgreSQL supervisor and
execution advisory leases prevent overlap; a slot record in0061 stores the
attempt, business checkpoint and independent stop request. Canonical task rows
may stay locked without blocking stop. Every auxiliary write uses250ms lock /
1500ms statement bounds and execution fencing. A commit verifies its fence.

Heartbeat proves liveness only. Positive byte reads, changed unit/cursor/phase
checkpoints advance business progress; identical percentages and heartbeat do
not. After300 seconds with no checkpoint, request stop, give30 seconds for
cooperative unwind, then terminate/kill within bounded waits. No uniform total
duration cap applies to a steadily advancing task.

After exit, first verify the DB lease is released and reconcile canonical
outcome before claiming again. Terminal business state wins over late control
state. A legacy active row with no control also blocks admission until existing
bounded stale recovery verifies it. DB outage pauses scheduling. A stopped task
does not immediately auto-requeue; its input remains protected. Existing safe
automatic recovery retains the three-attempt limit; unknown mail sends are not
repeated.

Local November14 follow-up: a supervised child exit immediately starts the next
scheduling iteration, not an unconditional idle sleep. That iteration rechecks
shutdown/supersession, the supervision lease, canonical reconciliation and the
execution lease before admission. OS exit alone never proves PostgreSQL lease
release. Empty queues, unavailable leases/reconciliation and scheduling errors
retain the configured idle poll (default1 second). Fresh interpreters, the
single execution slot and bounded rotating maintenance are unchanged.

Local November14 cold-start follow-up: the shared task dispatcher imports
models, lightweight archive type/status contracts and editing validation errors,
not every handler. Selected task/format branches load their existing services.
Noise scanning defers version-writing and search-index services until applying
cleanup; the existing fault-injection/deletion seams still delegate unchanged
arguments, results and exceptions. `MessageEditError` is reexported from its
original editor-service path with the same class identity and public detail.
No process pool, inherited connections, parser reuse or additional slot is added.

Maintenance starts its unchanged two-second cooperative deadline before
selected cleanup imports, loads only an eligible lane and rechecks stop/time
after that import. An import failure is isolated to its category, like an
operation failure. A stopped/exhausted pass does not import later families;
the four first-lane rotation and20-item limits are unchanged. An individual
import/OS call can still block; the supervisor's existing five-second helper
wait and execution-lease check remain the independent hard boundary.

Task reads expose optional execution_state/business_progress_at/stop_requested_at.
Local November13 follow-up shares that read-only projection with bound noise-scan
detail/pending reads. Canonical processing/SCANNING can coexist with independent
stopping; acknowledging the request is not proof of exit or queue release.
Tasks and scan controls recognize this state and keep bounded read-only recovery,
including after read failure or re-entry, without resending a mutation.
Independent control does not grant a new owner capability: non-cancellable
account-deletion/maintenance tasks remain non-cancellable, source-disposition
bodies remain analysis-only, and notification jobs remain concealed at every
owner task action. Root interruption retains its separate explicit audit boundary.

Root status distinguishes running/stalled/stopping/reconciling and progress-age
summary, plus pending upload cleanup/protected inputs. No payload or source
content is logged. Routine success is brief; pending/error status stays.
“Stalled” is an observation, not proof that stopping was requested or that the
old executor has exited. The aggregate snapshot stays read-only. A separate,
explicit Root execution-control region now requests a fenced stop and reads its
atomic audit receipt; it does not reset task rows or replay business operations.
See the [administration contract](ADMINISTRATION_CONTRACT.md#execution-interruption-and-recovery-local-2026-11-12).
Maintenance is the same single-slot child lane: four bounded categories rotate,
including between long sequences of jobs, with no concurrent executor.

The real process/PG local tests pass; Linux combined-process resource gates and
full release acceptance remain pending. See the single status ledger.

## In-app help and administrator runtime status (deployed 2026-10-02)

Personal settings and Offline Library share **Help & diagnostics**. It shows
the authenticated API connection, API version/build, the Web build, a guarded
inspection of this account's existing startup cache, the offline authorization
expiry, effective account limits and task-specific FAQ. Reading this panel does
not register a worker or download resources. Capability snapshots use the
existing account-bound Dexie v2 settings table; offline/failed refresh values
are explicitly last-known, never current. A generation fence surrounds cache
reads and writes. Expiry removes the panel with the private workspace; another
account cannot read or claim the snapshot. Package formats remain unchanged.

Diagnostics are generated only by the explicit copy action. The serializer
constructs a new fixed schema with validated enums, numbers, version/revision
strings and timestamps. It never serializes API objects, exceptions, shell
messages/missing-resource paths, account identifiers, filenames, content,
URLs, environment configuration, cookies or credentials. Copy failure keeps
the text selected for manual copying. Nothing is uploaded automatically.

`GET /api/app-info` is authenticated and non-cacheable. It returns only
`api_version` and the immutable image build `revision` (or null when unknown).
The existing `/api/health` three-field contract is unchanged. Release images
embed the full lowercase 40-character Git revision at build time; runtime
environment values do not replace it. See the deployment contract.

`GET /api/admin/runtime-status` is Root-only (ordinary accounts receive 404),
non-cacheable and read-only. It returns worker liveness, fixed job/import status
counts, storage summaries, latest system backup/restore statuses and mail
configuration presence. No names, IDs, payloads, errors, storage keys, addresses
or paths are included. This is a separate application service, not a proxy for
the loopback operator endpoint below.

Each PostgreSQL metric has a 1.5-second statement timeout and savepoint so one
failure does not poison later metrics. Local storage scans count at most 10,000
directory entries per root and use a 150ms cooperative time budget (an individual
filesystem call can still block). They never read file contents. Missing roots,
errors and partial scans are explicitly unavailable/incomplete. Object storage
shows database object-record count/logical bytes, not measured remote usage.
No/future heartbeat is unavailable; stale heartbeat is labelled stale, even
when metrics are complete. Mail configured does not imply tested delivery.
Latest archive status is derived without updating the backup record.

Worktree follow-up (2026-11-11): import counts include paused, previewed and
analyzing; canceled/cancelled normalize to one canceled count. Unknown states
contribute to fixed `other`, never disappear or expose arbitrary status strings.
Optional `source_cleanup` reports only unfinished explicitly discarded session
count and blocked count, not guessed residual bytes/files. The panel shows this
exception only when nonzero/unavailable. Extra queue states also appear only
when nonzero. Read-only runtime requests never retry disposal.

The administrator panel refreshes every 30 seconds while visible, pauses when
hidden and refreshes on return. A failed refresh retains the last result with
an outdated warning. No cleanup, restart, automated backup or notification
action is added. Tests and dated execution evidence distinguish these snapshots
from operational remediation and production validation.

Worktree follow-up (2026-11-11): runtime reads use the existing finite-request
helper with a 15-second bound including response-body reads and unmount abort.
Query keys include authentication generation; late retired responses cannot
populate the active view, and inactive runtime cache entries are not retained.
Temporary failures keep the same-generation snapshot, but 401/403/404 hide it
until a successful current read; a later transport error cannot reveal it again.
An explicit refresh remains available; no automatic mutation is issued.

The default view keeps worker/queue/storage summaries. Zero pending export
cleanup is silent; unavailable/nonzero cleanup remains visible. Archive task
history and mail configuration are under **More runtime information**, with a
closed-summary warning for failed/unknown/unavailable archive records. Labels
explicitly distinguish application `.cr` archive jobs from host backups.
Completion does not verify current artifact availability, a download, restore
success, off-site storage or the separately managed single host backup.
Historical failed job counts are labelled **Failure records**, not active jobs.
The bounded API metrics, read-only permission boundary and scan limits are unchanged.

## Existing operator observability

The current contract combines the Release C request/logging and bounded
aggregate diagnostics baseline with the Release L worker-liveness and protected
operator-access closure. It does not collect user analytics, Reader telemetry,
or business content.

## Request correlation and logs

FastAPI creates a server-owned UUID for every request. It is returned as
`X-Request-ID` and included in one structured completion event. Client request
IDs are not trusted. Raw Uvicorn access logging is disabled so query strings do
not bypass redaction.

Request logs contain only bounded operational fields: timestamp, event,
request ID, method, route template, status, duration and, for the principal
conversation, TOC, search and Files Panel read routes, a fixed endpoint family
and duration bucket. They never contain raw exception messages,
credentials or business content. Logging is best-effort and cannot fail a
business request or worker transition.

## Privacy boundary

Logs and diagnostics must not contain message or conversation text, Markdown
source, attachment contents or filenames, full storage paths, raw job payloads,
query strings, Cookies, Authorization headers, Share/cursor tokens, database
URLs, passwords or environment secrets. Aggregate counts, byte totals, bounded
timings and configured operational modes are allowed. Opaque IDs may appear in
transition logs when needed for correlation, but never as unbounded metric
labels or in diagnostics output.

New generic `BackgroundJob` failures store `TASK_FAILED` for unexpected
exceptions without formatting their messages. Only explicit user-facing domain
errors and a finite set of legacy authored `ValueError` conditions retain
bounded public details. Adaptive analysis mirrors this sanitized task error
into its session, while structured failure events keep exception class only.
Archive jobs retain their existing dedicated classification. The separate
canonical import worker also preserves authored draft diagnostics and stores
wrapped commit/unexpected failures as stable `IMPORT_COMMIT_FAILED` /
`IMPORT_FAILED` signals. At public read boundaries, including historical rows,
only vetted exact recovery codes/messages and bounded numeric draft/retry
diagnostics survive; all other text uses a safe family-specific fallback.
Reviewed fixed attachment derivative, scanner and download recovery messages
also survive; dynamic provider values or appended private details do not.
Task detail/list/receipt, import status/session, bound noise-scan job failures
and batch-deletion item failures share this policy. Stored historical values
are not rewritten. Extending recovery messages must explicitly extend the
projection's finite allowlist and compatibility tests; code-like prefixes or
error-class provenance from old string-only rows are not trusted.

## Worker liveness

The single production worker owns the `worker_runtime_states` row keyed by
`primary`. A process instance registers immediately, publishes an independent
heartbeat every 30 seconds and records `idle` or `busy` plus only the task
family (`import` or `job`). The row contains no task ID or payload. A heartbeat
is stale after 120 seconds, allowing four missed intervals and normal scheduling
jitter.

The heartbeat runs on a worker-owned background thread and continues while the
main worker thread executes a long synchronous task. Worker liveness commits
before a separate best-effort active-task heartbeat update, so a task-row
failure cannot roll back proof that the process is alive. A replaced instance
cannot overwrite the current instance row and stops claiming new tasks after
detecting replacement.

Worktree follow-up (2026-11-11, not deployed): housekeeping has one independent
single-flight thread in that same worker process. Successful current-worker
pulses request a pass; pulses while maintenance is running do not queue more
work. Shutdown, known supersession or worker-heartbeat failure prevents new
passes/items. Stopping uses a bounded join; an already-entered filesystem call
can still finish. No second user job is admitted.

Each pass has a 2-second cooperative budget and at most 20 export/20 expired
frozen-Share rows. The first family alternates to avoid starvation; exceptions
are isolated by family and log only category/class. PostgreSQL heartbeat and
maintenance transactions use `SET LOCAL statement_timeout = '1500ms'` and
`lock_timeout = '250ms'`; neither leaks to later pooled transactions. These are
statement/cooperative limits, not promises to interrupt every OS or connection
operation within two seconds. Expired Share selection skips locked Share rows.

Diagnostics derives these server-time states:

```text
recent heartbeat + idle = alive_idle
recent heartbeat + busy = alive_busy
heartbeat age >= stale threshold = stale
no worker row = unavailable
```

Job/import completion timestamps never prove process liveness. Processing task
counts and the most recent task heartbeat remain separate aggregates. This
distinction permits an orphaned processing row to coexist with an accurately
reported idle/stale worker state.

### Cooperative shutdown — local source, 2026-10-17

This follow-up is **not** in accepted production `3e68d1f`. The worker CLI
installs SIGTERM/SIGINT handlers before importing ORM/services and restores
the previous handlers when it returns or fails. A handler only sets a plain
flag; it does not log, acquire locks, query the database or interrupt a task.
An already-requested startup stops without registering a worker.

Once observed, shutdown prevents another claim. A claim committed but not yet
processed is requeued through state-conditional compensation without consuming
an attempt, including noise jobs. The write only changes rows still in
`processing`, preserving concurrently committed `cancelling`/`cancelled`
states and leaving already-requeued rows unchanged. An already-processing
task drains with its heartbeat still running; repeated signals do not cancel
it. The reporter stops on all exits, including startup failure. No new liveness
state/schema is added: the last heartbeat ages normally, and runtime readiness
also checks the process.

Idle polling retains its configured database deadline but checks the flag in
sleep slices of at most 250 ms. This bounds the **idle sleep**, not a blocked
database call, maintenance callback, heartbeat-thread join or active task.
Docker may still force a task exceeding its stop grace period; SIGKILL/OOM is
not caught. No service configuration or production deployment changed.
See [local evidence](../execution/WORKER_SHUTDOWN_2026-10-17.md).

## Protected diagnostics

`GET /api/internal/diagnostics` is omitted from the public OpenAPI schema and
requires both controls:

1. `ENABLE_INTERNAL_DIAGNOSTICS=true` in the API/worker environment.
2. A loopback API client (`127.0.0.1` or `::1`).

The production Nginx exact-prefix location always returns a concealed 404 for
the diagnostics path and never proxies it to Next.js. The authorized operator
path is the existing SSH public-key boundary followed by a request made inside
the API container to its loopback listener. There is no public HTTP credential,
hidden-link authorization or frontend entry.

Both denied and successful responses are non-cacheable. Successful responses
also carry `Pragma: no-cache`, `X-Content-Type-Options: nosniff`,
`X-Robots-Tag: noindex, noarchive` and the normal server-owned request ID.

Diagnostics returns only:

- worker state, heartbeat timestamp/age, task family and processing count;
- job/import status, stale, retry-exhausted, queue-age and bounded timing data;
- recent queue-wait and execution samples include fixed p50/p95/p99 percentiles
  alongside their averages and histograms; the sample remains capped at 500;
- Export/Offline record and cleanup classification aggregates;
- imports/exports/offline/assets file counts and byte totals;
- configured Scanner mode (`disabled` remains `disabled`, never `safe`).

The public `/api/health` endpoint stays coarse and separate. Diagnostics is
read-only, triggers no cleanup or remediation, hashes no files and caps its
filesystem scan at 2,000 entries / 150 ms per root and recent timing sample
at 500 rows. The general storage helper's higher default is not this report's
runtime budget.
The heavier explicit report is not a liveness probe: API/worker/PostgreSQL
readiness must use `deploy/verify_runtime_health.sh`, which checks existing
container health plus the singleton heartbeat with a read-only, 5-second
bounded PostgreSQL statement. It never starts another API interpreter or
walks storage. Its heartbeat threshold is read from the worker environment and
must be an integer from 1–86,400 seconds; missing, future, stale and unknown
states fail closed.

The operator full-report wrapper `deploy/run_internal_diagnostics.sh` is
serialized with a host-wide lock, admits work only with at least 512 MiB known
host-available memory, and rechecks after acquiring the lock. It runs the
already-loaded running API image as a one-off only, with a 256 MiB memory /
384 MiB memory-plus-swap ceiling, read-only filesystem and storage mounts,
no restart, and a hard 35-second timeout. Its diagnostics additionally require
256 MiB available at process admission, use transaction-local read-only and
PostgreSQL statement/lock/work-memory limits, and bound storage scans to 2,000
entries / 150 ms per root plus 1,000 cleanup files. Unknown/low memory is
reported as deferred (503 in-app, exit 75 in the operator command), not as a
service-health failure. Timeout cleanup is restricted to the unique one-off
whose Compose one-off label and immutable image match this invocation.
Never apply the resource overlay with `up`, and never run the full report in a
serving API container. These limits reduce this diagnostic-triggered OOM path;
they do not guarantee that unrelated host workloads or arbitrary upload/job
peaks cannot exhaust shared host memory.

## Failure behavior

A heartbeat or metric write failure is rate-limited in logs and must not expose
payload data. An unavailable metric degrades to unavailable/incomplete rather
than failing ordinary API traffic. Release L detects stale workers but does not
restart, kill, scale or otherwise remediate them automatically. Docker
`restart: unless-stopped` recovers an exited process where possible; it is
not a prevention or availability guarantee for host-wide OOM, host failure,
or repeated crash loops.

## Persistence and configuration

Alembic revision `20260816_0022` adds only the bounded singleton operational
state table. It does not change canonical conversation, attachment, Offline,
Dexie or package formats. `WORKER_HEARTBEAT_STALE_AFTER_SECONDS` must be at
least three times `WORKER_HEARTBEAT_INTERVAL_SECONDS`.

External APM, Prometheus/Grafana, alerting, automatic remediation and a general
metrics database remain out of scope.


## Temporary export reclamation (2026-10-06)

Root-only `GET /api/admin/runtime-status` adds the bounded `export_cleanup`
aggregate for expired/released temporary exports, including pending bytes/counts
and retry failures. Unavailable metrics remain unavailable rather than zero.
The existing worker requests bounded, single-flight reclamation independently
of its heartbeat and one user job (2026-11-11 worktree follow-up);
reading runtime status never deletes files or extends a download deadline.
No filenames, artifact IDs or source content are exposed by this metric. The
loopback diagnostics boundary remains unchanged.

Worktree follow-up2026-11-11 includes released/expired inactive private
Context-return uploads in the same `export_cleanup` aggregate. The single
exception-only UI summary is labelled **Temporary file cleanup**, not a second
panel. It is silent at zero, distinguishes pending and failed receipts, and
does not report unrelated restore uploads or historical orphan files as covered.
