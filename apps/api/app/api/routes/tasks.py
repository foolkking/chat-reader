import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.schemas.task import BackgroundTaskRead
from app.services.background_jobs import ACTIVE_JOB_STATUSES, retry_background_job
from app.services.import_queue import ACTIVE_IMPORT_STATUSES, conversation_ids_for_import, primary_filename, queue_import

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/active", response_model=list[BackgroundTaskRead])
def list_active_tasks(db: Session = Depends(get_db)) -> list[BackgroundTaskRead]:
    imports = (
        db.query(ImportRecord)
        .filter(ImportRecord.status.in_((*ACTIVE_IMPORT_STATUSES, "failed")))
        .order_by(ImportRecord.queued_at.asc(), ImportRecord.created_at.asc())
        .limit(20)
        .all()
    )
    jobs = (
        db.query(BackgroundJob)
        .filter(BackgroundJob.status.in_((*ACTIVE_JOB_STATUSES, "failed")))
        .order_by(BackgroundJob.queued_at.asc(), BackgroundJob.created_at.asc())
        .limit(20)
        .all()
    )
    tasks = [_import_task(record, db) for record in imports] + [_job_task(job) for job in jobs]
    return sorted(tasks, key=lambda task: task.queued_at or task.started_at or task.completed_at)


@router.get("/{job_id}", response_model=BackgroundTaskRead)
def get_task(job_id: uuid.UUID, db: Session = Depends(get_db)) -> BackgroundTaskRead:
    job = db.get(BackgroundJob, job_id)
    if job is not None:
        return _job_task(job)
    record = db.get(ImportRecord, job_id)
    if record is not None:
        return _import_task(record, db)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")


@router.post("/{job_id}/retry", response_model=BackgroundTaskRead)
def retry_task(job_id: uuid.UUID, db: Session = Depends(get_db)) -> BackgroundTaskRead:
    job = db.get(BackgroundJob, job_id)
    if job is not None:
        retry_background_job(job)
        db.commit()
        return _job_task(job)
    record = db.get(ImportRecord, job_id)
    if record is not None:
        if record.status != "failed":
            return _import_task(record, db)
        queue_import(record, db)
        db.commit()
        return _import_task(record, db)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")


def background_job_read(job: BackgroundJob) -> BackgroundTaskRead:
    return _job_task(job)


def _job_task(job: BackgroundJob) -> BackgroundTaskRead:
    payload = job.payload or {}
    return BackgroundTaskRead(
        job_id=job.id,
        job_type=job.job_type,
        status=job.status,
        phase=job.phase,
        progress=job.progress,
        processed_items=job.processed_items,
        total_items=job.total_items,
        label=payload.get("title") or _job_label(job.job_type),
        result=job.result or {},
        error_message=job.error_message,
        queued_at=job.queued_at,
        started_at=job.started_at,
        heartbeat_at=job.heartbeat_at,
        completed_at=job.completed_at,
    )


def _job_label(job_type: str) -> str:
    return {
        "conversation_merge": "合并对话",
        "conversation_export": "导出归档",
        "conversation_auto_clean": "清理对话内容",
    }.get(job_type, "后台任务")


def _import_task(record: ImportRecord, db: Session) -> BackgroundTaskRead:
    conversation_ids = conversation_ids_for_import(db, record)
    return BackgroundTaskRead(
        job_id=record.id,
        job_type="import",
        status=record.status,
        phase=record.phase,
        progress=record.progress,
        processed_items=record.processed_messages,
        total_items=record.total_messages,
        label=primary_filename(record),
        result={"conversation_ids": [str(value) for value in conversation_ids]},
        error_message=record.error_message,
        queued_at=record.queued_at,
        started_at=record.started_at,
        heartbeat_at=record.heartbeat_at,
        completed_at=record.completed_at,
    )
