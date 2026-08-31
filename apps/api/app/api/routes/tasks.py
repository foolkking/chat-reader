import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.schemas.task import BackgroundTaskRead
from app.services.background_jobs import (
    ACTIVE_JOB_STATUSES,
    request_background_job_cancellation,
    retry_background_job,
)
from app.services.import_queue import ACTIVE_IMPORT_STATUSES, conversation_ids_for_import, primary_filename, retry_import_manually
from app.services.task_retention import TERMINAL_IMPORT_STATUSES, TERMINAL_JOB_STATUSES, terminal_result_cutoff

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/active", response_model=list[BackgroundTaskRead])
def list_active_tasks(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> list[BackgroundTaskRead]:
    cutoff = terminal_result_cutoff(settings.task_terminal_result_retention_seconds)
    active_imports = (
        db.query(ImportRecord)
        .filter(ImportRecord.status.in_(ACTIVE_IMPORT_STATUSES))
        .order_by(ImportRecord.queued_at.asc(), ImportRecord.created_at.asc())
        .limit(20)
        .all()
    )
    recent_imports = (
        db.query(ImportRecord)
        .filter(
            ImportRecord.status.in_(TERMINAL_IMPORT_STATUSES),
            ImportRecord.completed_at.is_not(None),
            ImportRecord.completed_at >= cutoff,
        )
        .order_by(ImportRecord.completed_at.desc())
        .limit(max(0, 20 - len(active_imports)))
        .all()
    )
    active_jobs = (
        db.query(BackgroundJob)
        .filter(BackgroundJob.status.in_(ACTIVE_JOB_STATUSES))
        .order_by(BackgroundJob.queued_at.asc(), BackgroundJob.created_at.asc())
        .limit(20)
        .all()
    )
    recent_jobs = (
        db.query(BackgroundJob)
        .filter(
            BackgroundJob.status.in_(TERMINAL_JOB_STATUSES),
            BackgroundJob.completed_at.is_not(None),
            BackgroundJob.completed_at >= cutoff,
        )
        .order_by(BackgroundJob.completed_at.desc())
        .limit(max(0, 20 - len(active_jobs)))
        .all()
    )
    active_tasks = [_import_task(record, db) for record in active_imports] + [_job_task(job) for job in active_jobs]
    terminal_tasks = [_import_task(record, db) for record in recent_imports] + [_job_task(job) for job in recent_jobs]
    return sorted(active_tasks, key=_active_task_sort_key) + sorted(terminal_tasks, key=_terminal_task_sort_key, reverse=True)


def _active_task_sort_key(task: BackgroundTaskRead):
    return task.queued_at or task.started_at or task.completed_at


def _terminal_task_sort_key(task: BackgroundTaskRead):
    return task.completed_at or task.started_at or task.queued_at


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
        retry_import_manually(record, db)
        db.commit()
        return _import_task(record, db)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")


@router.post("/{job_id}/cancel", response_model=BackgroundTaskRead)
def cancel_task(job_id: uuid.UUID, db: Session = Depends(get_db)) -> BackgroundTaskRead:
    job = db.get(BackgroundJob, job_id)
    if job is None:
        record = db.get(ImportRecord, job_id)
        if record is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import tasks cannot be cancelled here.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    try:
        request_background_job_cancellation(job)
        db.commit()
    except Exception as exc:
        db.rollback()
        status_code = getattr(exc, "status_code", status.HTTP_409_CONFLICT)
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return _job_task(job)


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
        cancellable=job.job_type in {"conversation_merge", "conversation_batch_delete"} and job.status in {"queued", "processing", "cancelling"},
        attempt_count=job.attempt_count,
    )


def _job_label(job_type: str) -> str:
    if job_type == "conversation_batch_delete":
        return "\u5220\u9664\u5bf9\u8bdd"
    return {
        "conversation_merge": "合并对话",
        "conversation_export": "导出归档",
        "conversation_auto_clean": "清理对话内容",
        "content_noise_scan": "后台审查噪音",
        "conversation_derived_rebuild": "重建派生数据",
        "toc_refresh": "更新目录",
        "offline_package": "生成离线资料库",
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
        cancellable=False,
        attempt_count=record.attempt_count,
    )
