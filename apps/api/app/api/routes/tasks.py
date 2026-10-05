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
    CANCELLABLE_JOB_TYPES,
    request_background_job_cancellation,
    retry_background_job,
)
from app.services.import_queue import ACTIVE_IMPORT_STATUSES, conversation_ids_for_import, primary_filename, retry_import_manually
from app.services.task_retention import TERMINAL_IMPORT_STATUSES, TERMINAL_JOB_STATUSES, terminal_result_cutoff
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/active", response_model=list[BackgroundTaskRead])
def list_active_tasks(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> list[BackgroundTaskRead]:
    cutoff = terminal_result_cutoff(settings.task_terminal_result_retention_seconds)
    active_imports = (
        db.query(ImportRecord)
        .filter(
            ownership_scope.predicate(ImportRecord),
            ImportRecord.status.in_(ACTIVE_IMPORT_STATUSES),
        )
        .order_by(ImportRecord.queued_at.asc(), ImportRecord.created_at.asc())
        .limit(20)
        .all()
    )
    recent_imports = (
        db.query(ImportRecord)
        .filter(
            ownership_scope.predicate(ImportRecord),
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
        .filter(
            ownership_scope.predicate(BackgroundJob),
            BackgroundJob.status.in_(ACTIVE_JOB_STATUSES),
            BackgroundJob.job_type != "support_notification",
        )
        .order_by(BackgroundJob.queued_at.asc(), BackgroundJob.created_at.asc())
        .limit(20)
        .all()
    )
    # Canonical deletion is terminal, but unreleased file cleanup is still work.
    # Keep a separate bounded window so these rows cannot starve active jobs.
    pending_cleanup_jobs = db.query(BackgroundJob).filter(
        ownership_scope.predicate(BackgroundJob),
        BackgroundJob.job_type == "user_account_delete",
        BackgroundJob.status == "committed",
        BackgroundJob.result["asset_cleanup_pending"].as_integer() > 0,
    ).order_by(BackgroundJob.completed_at.asc(), BackgroundJob.id.asc()).limit(20).all()
    recent_jobs = (
        db.query(BackgroundJob)
        .filter(
            ownership_scope.predicate(BackgroundJob),
            BackgroundJob.status.in_(TERMINAL_JOB_STATUSES),
            BackgroundJob.job_type != "support_notification",
            BackgroundJob.completed_at.is_not(None),
            BackgroundJob.completed_at >= cutoff,
            BackgroundJob.id.not_in([job.id for job in pending_cleanup_jobs]),
        )
        .order_by(BackgroundJob.completed_at.desc())
        .limit(max(0, 20 - len(active_jobs)))
        .all()
    )
    active_tasks = [_import_task(record, db) for record in active_imports] + [_job_task(job) for job in active_jobs]
    terminal_tasks = [_import_task(record, db) for record in recent_imports] + [_job_task(job) for job in [*pending_cleanup_jobs, *recent_jobs]]
    return sorted(active_tasks, key=_active_task_sort_key) + sorted(terminal_tasks, key=_terminal_task_sort_key, reverse=True)


def _active_task_sort_key(task: BackgroundTaskRead):
    return task.queued_at or task.started_at or task.completed_at


def _terminal_task_sort_key(task: BackgroundTaskRead):
    return task.completed_at or task.started_at or task.queued_at


@router.get("/{job_id}", response_model=BackgroundTaskRead)
def get_task(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> BackgroundTaskRead:
    job = get_owned(db, BackgroundJob, job_id, ownership_scope)
    if job is not None:
        if job.job_type == "support_notification":
            raise HTTPException(404, detail="Task not found.")
        return _job_task(job)
    record = get_owned(db, ImportRecord, job_id, ownership_scope)
    if record is not None:
        return _import_task(record, db)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")


@router.post("/{job_id}/retry", response_model=BackgroundTaskRead)
def retry_task(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> BackgroundTaskRead:
    job = db.query(BackgroundJob).filter(BackgroundJob.id == job_id, ownership_scope.predicate(BackgroundJob)).with_for_update().populate_existing().one_or_none()
    if job is not None:
        if job.job_type == "support_notification":
            raise HTTPException(404, detail="Task not found.")
        if job.job_type == 'context_validation':
            raise HTTPException(410, detail={'code': 'CONTEXT_VALIDATION_RETIRED', 'next_action': 'update_files'})
        retry_background_job(job)
        db.commit()
        return _job_task(job)
    record = get_owned(db, ImportRecord, job_id, ownership_scope)
    if record is not None:
        if record.status != "failed":
            return _import_task(record, db)
        retry_import_manually(record, db)
        db.commit()
        return _import_task(record, db)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")


@router.post("/{job_id}/cancel", response_model=BackgroundTaskRead)
def cancel_task(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> BackgroundTaskRead:
    job = get_owned(db, BackgroundJob, job_id, ownership_scope)
    if job is None:
        record = get_owned(db, ImportRecord, job_id, ownership_scope)
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
    result = dict(job.result or {})
    if job.job_type == "user_account_delete" and payload.get("target_user_id"):
        result["target_user_id"] = payload["target_user_id"]
    if payload.get("parent_task_id") and not result.get("parent_task_id"):
        result["parent_task_id"] = payload["parent_task_id"]
    return BackgroundTaskRead(
        job_id=job.id,
        job_type=job.job_type,
        status=job.status,
        phase=job.phase,
        progress=job.progress,
        processed_items=job.processed_items,
        total_items=job.total_items,
        label=payload.get("title") or _job_label(job.job_type),
        result=result,
        error_message=job.error_message,
        queued_at=job.queued_at,
        started_at=job.started_at,
        heartbeat_at=job.heartbeat_at,
        completed_at=job.completed_at,
        cancellable=job.job_type in CANCELLABLE_JOB_TYPES and job.status in {"queued", "processing", "cancelling"},
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
        "personal_archive_export": "备份我的数据",
        "personal_archive_preflight": "预检个人归档",
        "personal_archive_restore": "恢复个人归档",
        "system_archive_export": "备份系统数据",
        "system_archive_preflight": "预检系统归档",
        "system_archive_restore": "恢复系统归档",
        "user_account_delete": "删除用户账户",
        "context_object_cleanup": "清理接续文件",
        "skill_object_cleanup": "清理 Skill 文件",
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
