# Worker cooperative shutdown — 2026-10-17

## Boundary and evidence before editing

This is a local-only follow-up after production accepted `3e68d1f`. The user
explicitly prohibited proactive CI, push and deployment for continued
optimization. No production operation is part of this batch.

During the accepted OOM repair deployment, the old idle worker failed to exit
within both the first 60-second and second 120-second Docker stop grace
periods. Docker forced exit 137 with `OOMKilled=false`; this was planned
maintenance, not another host OOM. The last log was normal heartbeat startup.

Before editing, `app/workers/import_worker.py` directly called
`run_task_worker_forever()` without signal handlers. Its loop only exited
when the heartbeat reporter was superseded, and idle polling used an
unconditional sleep. Therefore there was no cooperative SIGTERM stop path;
interrupting a busy task could also leave it for stale-task recovery.

## Intended local contract

- Register SIGTERM/SIGINT only in the worker CLI, **before** ORM/service
  imports, restoring previous handlers on every exit, including partial
  registration failure. A handler sets a plain flag only: no database/logging/
  locks. Stop requests during imports prevent worker registration afterward.
- Idle waits observe the flag within a 250-ms sleep slice without increasing
  the configured frequency of database polling.
- Stop admitting new tasks when shutdown is observed. A claimed task not yet
  processing is requeued using the existing compensation, without consuming
  an attempt. Active synchronous work drains normally with heartbeat running;
  repeated signals do not cancel it or start a second task.
- Stop the heartbeat reporter on all loop exits, including startup failure.
  Preserve current liveness schema and stale-task recovery semantics.
- This is not a promise to finish a long/blocking task before Docker's stop
  grace period. It does not handle SIGKILL/OOM or claim a production fix.

## Initial shutdown verification

The initial focused entrypoint run failed **2/2** because the old entrypoint
had no testable signal-owning `main`; that is a regression boundary, not a
second production reproduction. Final local related regression passes
**109 / 4 skipped** across:

- `test_worker_shutdown.py`, `test_worker_liveness.py`, `test_import_queue.py`;
- `test_context_return.py`, `test_export_retention.py`, `test_tasks_api.py`;
- `test_observability.py`, `test_offline_task_recovery.py`.

The new tests dispatch real Python SIGTERM/SIGINT handlers on Windows, test
restoration after ordinary/partial-startup failure, inject a stop during the
service import, preserve idle poll deadlines, and cover all five admission/
processing boundaries for import, ordinary job and noise job. Existing SQLite
tests exercise the real requeue's attempt compensation and liveness while a
task is blocked. Production PostgreSQL/concurrency and Linux PID 1 are not
covered by this local suite.

Cold-process import of the CLI verifies that neither SQLAlchemy nor
`app.services.task_worker` is loaded before `main`. All four changed/new Python
files parse; changed-document links, added-text secret-pattern scan and
`git diff --check` pass. Tests and artifacts use the designated task temp
directory. No Web/Reader/offline schema, migration or service configuration
changed. Production remains `3e68d1f` and database 0051; no CI, push or deployment
was performed.

The first local related suite passed **108 / 4 skipped**, before the additional
startup-import fence. This is retained as an intermediate result, not final
verification. All four skips are the explicit POSIX external-signal process
cases: Windows terminates on `send_signal(SIGTERM)` rather than delivering the
POSIX signal contract. Local Docker Desktop's Linux engine is not running; it
was not started, no image was built/pulled, and no remote host was used for tests.
No Linux PID 1 acceptance is claimed.

## Cancellation-safe compensation follow-up

The shutdown path also exercises the pre-existing unstarted-claim compensation.
It previously read `processing`, then wrote `queued` without a write-time state
condition. A cancellation committing between those operations could therefore
be overwritten, revive the task and reduce its attempt count.

Four deterministic SQLite cases reproduced this before the fix: ordinary
conversation-merge and noise-scan jobs, each with an independently committed
`cancelling` or `cancelled` state, were incorrectly returned to `queued`. The
tests call the real cancellation service on a second connection immediately
before the compensation UPDATE; terminal cancellation uses the real worker's
cancellation branch. All four failed on state/snapshot assertions, not setup.

Compensation now uses one state-conditional UPDATE for imports and background
jobs: only the same ID still in `processing` can return to `queued`. Attempt
compensation is evaluated in SQL and cannot go below zero. Already queued,
terminal, cancelling or missing rows remain unchanged. This is not a new
claim-ownership/fencing protocol; no schema, task API or admission order changes.

Focused SQLite regression passes **20/20**, including both task families,
attempt counts 0/1/2, repeated compensation, missing/non-processing rows and
all four cancellation races. Comparisons cover the complete persisted row,
not just the visible status.

Separate disposable **PostgreSQL 17** integration passes **4/4** after migrating
each fresh test database to head. For both ordinary and noise jobs:

- A cancellation transaction holds the actual row lock; a second worker
  connection attempts compensation. `pg_stat_activity` confirms a lock wait
  before cancellation commits. Compensation then preserves the entire
  `cancelling` row, including attempts and timestamps.
- In the reverse serialized order, compensation returns the claim, cancellation
  makes it terminal, and neither another compensation nor `claim_next_job`
  revives/reclaims it.

The first PostgreSQL attempt had **four fixture setup errors**: the synthetic
job omitted the migrated schema's required owner. The fixture now creates a
synthetic owner; no constraint or production model was weakened. Both newly
initialized local clusters stopped cleanly afterward, with no PID files or
listener left on the task's port. No existing database was reused. This narrow
integration supersedes the initial batch's “no PostgreSQL concurrency coverage”
boundary only for the cancellation/compensation cases above; it is not full
PostgreSQL, Linux PID 1, container, memory/load or production acceptance.
The integration module's opt-in guard was separately checked: all four cases
skip when `SETTINGS_POSTGRES_INTEGRATION` is unset.

Final related regression across the same eight API modules passes **127 /
4 skipped**; all skips remain the Windows-inapplicable POSIX external-signal
cases. The existing Starlette/httpx deprecation warning is not suppressed.
Cold CLI import, six relevant Python syntax checks, changed-document links,
added-text secret-pattern scan and `git diff --check` pass. No Web gate was
rerun and no frontend, schema or service configuration changed. Results are
local only: no CI, push, deployment or production operation occurred.
