import time
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.services.background_jobs import (
    claim_next_job,
    process_background_job,
    recover_stale_jobs,
)
from app.services.import_queue import (
    claim_next_import,
    process_import,
    recover_stale_imports,
)
from app.services.worker_liveness import WorkerHeartbeatReporter


def run_task_worker_forever() -> None:
    settings = get_settings()
    reporter = WorkerHeartbeatReporter(interval_seconds=settings.worker_heartbeat_interval_seconds)
    reporter.start()
    try:
        while not reporter.superseded:
            processed = run_task_worker_iteration(settings, reporter)
            if not processed and not reporter.superseded:
                time.sleep(settings.import_worker_poll_seconds)
    finally:
        reporter.stop()


def run_task_worker_iteration(settings, reporter: WorkerHeartbeatReporter) -> bool:
    if reporter.superseded:
        return False
    task_kind: str | None
    task_id = None
    with SessionLocal() as db:
        recover_stale_imports(db, settings.import_stale_after_seconds)
        recover_stale_jobs(db, settings.import_stale_after_seconds)
        task_kind = _oldest_task_kind(db)
        task_id = claim_next_import(db) if task_kind == "import" else claim_next_job(db) if task_kind == "job" else None
        db.commit()
    if task_id is None or task_kind is None:
        reporter.set_idle()
        return False
    if not reporter.set_busy(task_kind, task_id):
        _requeue_unstarted_task(task_kind, task_id)
        return False
    try:
        if task_kind == "import":
            process_import(task_id)
        else:
            process_background_job(task_id)
    finally:
        reporter.set_idle()
    return True


def _requeue_unstarted_task(
    task_kind: str,
    task_id: uuid.UUID,
    session_factory: sessionmaker | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    with (session_factory or SessionLocal)() as db:
        if task_kind == "import":
            task = db.get(ImportRecord, task_id)
        else:
            task = db.get(BackgroundJob, task_id)
        if task is None or task.status != "processing":
            return
        task.status = "queued"
        task.phase = "queued"
        task.queued_at = now
        task.started_at = None
        task.heartbeat_at = None
        task.attempt_count = max(0, task.attempt_count - 1)
        task.error_message = "Worker ownership changed before processing; task requeued."
        db.commit()


def _oldest_task_kind(db) -> str | None:
    import_row = (
        db.query(ImportRecord.id, ImportRecord.queued_at)
        .filter(ImportRecord.status == "queued")
        .order_by(ImportRecord.queued_at.asc(), ImportRecord.created_at.asc())
        .first()
    )
    job_row = (
        db.query(BackgroundJob.id, BackgroundJob.queued_at)
        .filter(BackgroundJob.status == "queued")
        .order_by(BackgroundJob.queued_at.asc(), BackgroundJob.created_at.asc())
        .first()
    )
    if import_row is None:
        return "job" if job_row is not None else None
    if job_row is None:
        return "import"
    import_time = import_row.queued_at or datetime.min.replace(tzinfo=timezone.utc)
    job_time = job_row.queued_at or datetime.min.replace(tzinfo=timezone.utc)
    return "import" if import_time <= job_time else "job"
