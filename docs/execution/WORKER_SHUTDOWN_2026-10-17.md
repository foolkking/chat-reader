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

## Verification

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
