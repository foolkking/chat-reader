import time
from datetime import datetime, timezone

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


def run_task_worker_forever() -> None:
    settings = get_settings()
    while True:
        with SessionLocal() as db:
            recover_stale_imports(db, settings.import_stale_after_seconds)
            recover_stale_jobs(db, settings.import_stale_after_seconds)
            task_kind = _oldest_task_kind(db)
            task_id = claim_next_import(db) if task_kind == "import" else claim_next_job(db) if task_kind == "job" else None
            db.commit()
        if task_id is None:
            time.sleep(settings.import_worker_poll_seconds)
            continue
        if task_kind == "import":
            process_import(task_id)
        else:
            process_background_job(task_id)


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
