import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.schemas.task import BackgroundTaskRead, OfflineDownloadTarget, TaskCancellationRequest
from app.services.adaptive_import.contracts import AdaptiveImportError
from app.services.editing.message_edit_service import MessageEditError
from app.services.background_jobs import (
    ACTIVE_JOB_STATUSES,
    CANCELLABLE_JOB_TYPES,
    request_background_job_cancellation,
    retry_background_job,
)
from app.services.import_queue import ACTIVE_IMPORT_STATUSES, conversation_ids_for_import, primary_filename, retry_import_manually
from app.services.task_retention import TERMINAL_IMPORT_STATUSES, TERMINAL_JOB_STATUSES, terminal_result_cutoff
from app.services.task_errors import ARCHIVE_FAILURE_MESSAGE, public_import_failure, public_task_error
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request
from app.services.adaptive_import.source_cleanup import KEY as SOURCE_CLEANUP_KEY, UNFINISHED, public_receipt

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/active", response_model=list[BackgroundTaskRead])
def list_active_tasks(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
) -> list[BackgroundTaskRead]:
    cutoff = terminal_result_cutoff(settings.task_terminal_result_retention_seconds)
    # A cancelled import is not active work, but its explicitly requested file
    # cleanup can remain unfinished beyond the terminal notification window.
    pending_source_cleanup = db.query(ImportRecord).filter(
        ownership_scope.predicate(ImportRecord),
        ImportRecord.status.in_(("canceled", "cancelled")), ImportRecord.session_state == "CANCELED",
        ImportRecord.committed_at.is_(None), ImportRecord.conversation_id.is_(None),
        ImportRecord.analysis_summary[SOURCE_CLEANUP_KEY]["version"].as_integer() == 1,
        ImportRecord.analysis_summary[SOURCE_CLEANUP_KEY]["state"].as_string().in_(UNFINISHED),
    ).order_by(ImportRecord.updated_at.asc(), ImportRecord.id.asc()).limit(20).all()
    replaced_analysis_ids = []
    for record in pending_source_cleanup:
        try:
            replaced_analysis_ids.append(uuid.UUID(str((record.analysis_summary or {}).get("analysis_task_id"))))
        except (ValueError, TypeError, AttributeError):
            pass
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
            ImportRecord.phase != "analysis_failed",
            ImportRecord.completed_at.is_not(None),
            ImportRecord.completed_at >= cutoff,
            ImportRecord.id.not_in([record.id for record in pending_source_cleanup]),
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
            BackgroundJob.id.not_in(replaced_analysis_ids),
        )
        .order_by(BackgroundJob.completed_at.desc())
        .limit(max(0, 20 - len(active_jobs)))
        .all()
    )
    active_tasks = [_import_task(record, db) for record in active_imports] + [_job_task(job) for job in active_jobs]
    terminal_tasks = [_import_task(record, db) for record in [*recent_imports, *pending_source_cleanup]] + [_job_task(job) for job in [*pending_cleanup_jobs, *recent_jobs]]
    ordered = sorted(active_tasks, key=_active_task_sort_key) + sorted(terminal_tasks, key=_terminal_task_sort_key, reverse=True)
    # A worker can finish between these bounded READ COMMITTED queries. A row
    # seen as active can then also enter the terminal window; expose one task,
    # keeping its position and the latest projection rather than a duplicate.
    return list({task.job_id: task for task in ordered}.values())


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
        try:
            retry_background_job(job)
        except MessageEditError as exc:
            db.rollback()
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        db.commit()
        return _job_task(job)
    record = get_owned(db, ImportRecord, job_id, ownership_scope)
    if record is not None:
        db.refresh(record, with_for_update=True)
        receipt = public_receipt(record)
        if receipt and receipt["retryable"]:
            from app.services.adaptive_import.service import cancel_session
            cancel_session(record)
            db.commit()
            db.refresh(record)
            return _import_task(record, db)
        if record.status != "failed":
            return _import_task(record, db)
        if record.phase == "analysis_failed":
            raise HTTPException(409, detail="Retry the analysis task, not an import commit.")
        retry_import_manually(record, db)
        db.commit()
        return _import_task(record, db)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")


@router.post("/{job_id}/cancel", response_model=BackgroundTaskRead)
def cancel_task(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    ownership_scope: OwnershipScope = Depends(ownership_scope_from_request),
    payload: TaskCancellationRequest | None = None,
) -> BackgroundTaskRead:
    job = db.query(BackgroundJob).filter(BackgroundJob.id == job_id, ownership_scope.predicate(BackgroundJob)).with_for_update().populate_existing().one_or_none()
    if job is None:
        record = get_owned(db, ImportRecord, job_id, ownership_scope)
        if record is not None:
            db.refresh(record, with_for_update=True)
            if record.status == "queued" and record.phase == "waiting_resources":
                # Claim and cancel take the same record lock. Keep the draft
                # so a user can explicitly queue it again, without re-upload.
                record.status = "cancelled"
                record.phase = "cancelled"
                record.session_state = "READY"
                record.next_run_at = None
                record.completed_at = datetime.now(timezone.utc)
                record.analysis_summary = {key: value for key, value in (record.analysis_summary or {}).items()
                                           if key != "resource_wait"}
                db.commit()
                return _import_task(record, db)
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import tasks cannot be cancelled here.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    try:
        if payload is not None:
            request_background_job_cancellation(job, source_disposition=payload.source_disposition)
        else:
            request_background_job_cancellation(job)
        if job.job_type == "adaptive_import_analysis":
            import_id = uuid.UUID(str((job.payload or {}).get("import_id")))
            record = db.get(ImportRecord, import_id)
            if record is not None and record.status != "committed":
                if job.status == "cancelled":
                    from app.services.adaptive_import.service import finish_analysis_stop

                    finish_analysis_stop(record, job)
                    record.completed_at = job.completed_at
        db.commit()
    except (MessageEditError, AdaptiveImportError) as exc:
        db.rollback()
        status_code = getattr(exc, "status_code", status.HTTP_409_CONFLICT)
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    return _job_task(job)


def background_job_read(job: BackgroundJob) -> BackgroundTaskRead:
    return _job_task(job)


def _job_task(job: BackgroundJob) -> BackgroundTaskRead:
    from app.services.adaptive_import.resource_wait import public_wait
    payload = job.payload or {}
    result = dict(job.result or {})
    if job.job_type == "conversation_batch_delete" and isinstance(result.get("failed"), list):
        result["failed"] = [
            {**item, "error": public_task_error(item.get("error"), fallback="CONVERSATION_DELETE_FAILED")
             or "CONVERSATION_DELETE_FAILED"}
            for item in result["failed"] if isinstance(item, dict)
        ]
    if job.job_type == "adaptive_import_analysis" and payload.get("import_id") and not result.get("import_id"):
        result["import_id"] = payload["import_id"]
    if job.job_type == "content_noise_scan" and isinstance(result.get("cleanup_apply"), dict):
        result["cleanup_apply"] = {key: value for key, value in result["cleanup_apply"].items() if key != "response"}
    from sqlalchemy.orm import object_session
    if job.job_type == "context_return":
        # A hint belongs to the current private source/target, not a stored
        # earlier response. Never expose payload paths or foreign target IDs.
        result.pop("context_return_recovery", None)
        if job.status == "failed" and (db := object_session(job)) is not None:
            from app.services.context_return_jobs import context_return_recovery
            result["context_return_recovery"] = context_return_recovery(db, job)
    if job.job_type in {"personal_archive_preflight", "system_archive_preflight"} and (db := object_session(job)) is not None:
        from app.services.exporting.archive_jobs import archive_task_result
        result = archive_task_result(db, job)
    from app.models.export_artifact import ExportArtifact
    from app.services.export_retention import EXPORT_JOB_TYPES, artifact_status
    if job.job_type in EXPORT_JOB_TYPES and job.status == "committed" and (db := object_session(job)) is not None:
        artifact = db.query(ExportArtifact).filter_by(job_id=job.id).one_or_none()
        if artifact is not None and artifact.scope_type != "archive_upload":
            current = artifact_status(artifact)
            result.update(artifact_status=current["status"], expires_at=current["expires_at"],
                          download_url=current["download_url"], retention_seconds=current["retention_seconds"],
                          release_on_close=current["release_on_close"], can_regenerate=current["status"] != "available")
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
        source_label=payload.get("source_label") or payload.get("title"),
        export_format=_task_export_format(job.job_type, payload),
        offline_target=_offline_download_target(job.job_type, payload),
        result=result,
        resource_wait=public_wait(result) if job.phase in {"waiting_resources", "resource_paused"} else None,
        failure=(
            public_import_failure(
                result.get("failure"), error_message=job.error_message,
            ) if job.job_type == "adaptive_import_analysis" and job.status == "failed" else None
        ),
        error_message=public_task_error(
            job.error_message,
            fallback=ARCHIVE_FAILURE_MESSAGE if job.job_type.startswith(("personal_archive_", "system_archive_")) else "TASK_FAILED",
        ),
        queued_at=job.queued_at,
        started_at=job.started_at,
        heartbeat_at=job.heartbeat_at,
        completed_at=job.completed_at,
        updated_at=job.updated_at,
        cancellation_requested_at=payload.get("cancellation_requested_at"),
        progress_updated_at=result.get("progress_updated_at"),
        cancellable=job.job_type in CANCELLABLE_JOB_TYPES and job.status in {"queued", "processing", "cancelling"},
        attempt_count=job.attempt_count,
    )


def _offline_download_target(job_type: str, payload: dict) -> OfflineDownloadTarget | None:
    """Navigation metadata only; a new admission rechecks source ownership."""
    if job_type != "offline_package":
        return None
    scope, mode = payload.get("scope"), payload.get("include_assets", "all")
    if scope not in ("conversation", "project", "all") or mode not in ("none", "small", "all"):
        return None
    try:
        return OfflineDownloadTarget(
            scope=scope, include_assets=mode,
            conversation_id=uuid.UUID(str(payload.get("conversation_id"))) if scope == "conversation" else None,
            project_id=uuid.UUID(str(payload.get("project_id"))) if scope == "project" else None,
        )
    except (ValueError, TypeError):
        return None


def _task_export_format(job_type: str, payload: dict) -> str | None:
    if job_type == "conversation_export":
        value = payload.get("export_format", "cr_v2")
        return value if value in {"cr_v2", "context_package", "markdown_bundle", "canjson_bundle", "markdown_v2", "canjson_v2"} else None
    return {
        "conversation_batch_export": "canjson_batch",
        "context_package_export": "context_package",
        "attachment_batch_download": "attachments_zip",
        "personal_archive_export": "cr_v2",
        "system_archive_export": "cr_v2",
    }.get(job_type)


def _job_label(job_type: str) -> str:
    if job_type == "conversation_batch_delete":
        return "\u5220\u9664\u5bf9\u8bdd"
    return {
        "adaptive_import_analysis": "分析导入文件",
        "conversation_merge": "合并对话",
        "conversation_export": "导出归档",
        "conversation_batch_export": "批量导出对话",
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
    from app.services.adaptive_import.resource_wait import public_wait
    receipt = public_receipt(record)
    conversation_ids = [] if receipt else conversation_ids_for_import(db, record)
    return BackgroundTaskRead(
        job_id=record.id,
        job_type="import",
        status="cancelled" if record.status == "canceled" else record.status,
        phase=record.phase,
        progress=record.progress,
        processed_items=record.processed_messages,
        total_items=record.total_messages,
        label=primary_filename(record),
        source_label=primary_filename(record),
        result={"conversation_ids": [str(value) for value in conversation_ids],
                **({"source_cleanup": receipt} if receipt else {})},
        error_message=public_task_error(record.error_message, fallback="IMPORT_FAILED"),
        resource_wait=public_wait(record.analysis_summary) if record.phase in {"waiting_resources", "resource_paused"} else None,
        failure=(
            public_import_failure(
                (record.analysis_summary or {}).get("failure"),
                error_message=record.error_message, stage="commit",
            ) if record.status == "failed" else None
        ),
        queued_at=record.queued_at or record.created_at,
        started_at=record.started_at,
        heartbeat_at=record.heartbeat_at,
        completed_at=record.completed_at,
        cancellable=record.status == "queued" and record.phase == "waiting_resources",
        attempt_count=record.attempt_count,
    )
