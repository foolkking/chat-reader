"""A fresh interpreter: no ORM connections, parser contents or File objects copied."""
import os
import sys
import uuid


def main():
    # Docker/Linux: losing the supervisor must not orphan a second executor.
    # Set this before importing parsers; verify the parent after prctl's race.
    if sys.platform == "linux":
        import ctypes
        import signal
        if ctypes.CDLL(None).prctl(1, signal.SIGKILL) != 0:
            return 3
        if os.getppid() != int(os.environ["CHAT_READER_EXECUTION_PARENT"]):
            return 3
    kind, task_id, token = sys.argv[1:4]
    task_id, token = uuid.UUID(task_id), uuid.UUID(token)
    from app.core.database import SessionLocal, engine
    from app.services.execution_control import EXECUTION_LOCK, ExecutionStopped, monitor_execution, session_lease
    from app.services.execution_reconciliation import reconcile
    with session_lease(engine, EXECUTION_LOCK) as lease:
        if lease is None:
            return 3
        if kind == "maintenance":
            from pathlib import Path
            from app.core.config import get_settings
            from app.services.worker_maintenance import run_worker_maintenance
            run_worker_maintenance(SessionLocal, Path(get_settings().export_storage_dir), should_continue=lambda: True,
                                   start_lane=task_id.int % 4)
            return 0
        if kind == "recovery":
            from app.core.config import get_settings
            from app.services.background_jobs import recover_stale_jobs
            from app.services.import_queue import recover_stale_imports
            from app.services.worker_maintenance import bound_worker_transaction
            with SessionLocal() as db:
                bound_worker_transaction(db)
                recover_stale_imports(db, get_settings().import_stale_after_seconds)
                recover_stale_jobs(db, get_settings().import_stale_after_seconds)
                db.commit()
            return 0
        if "--reconcile" not in sys.argv:
            try:
                with monitor_execution(token, SessionLocal, lease):
                    if kind == "import":
                        from app.services.import_queue import process_import
                        process_import(task_id)
                    else:
                        from app.models.background_job import BackgroundJob
                        from app.services.background_jobs import process_background_job
                        with SessionLocal() as db:
                            row = db.get(BackgroundJob, task_id)
                            if row is None or (row.payload or {}).get("execution_token") != token.hex:
                                raise ExecutionStopped()
                            execution = (row.attempt_count, row.started_at, token.hex)
                        process_background_job(task_id, expected_execution=execution)
            except ExecutionStopped:
                pass
        return 0 if reconcile(kind, task_id, token, SessionLocal) else 2


if __name__ == "__main__":
    raise SystemExit(main())
