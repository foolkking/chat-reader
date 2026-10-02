import uuid

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.routes.tasks import background_job_read
from app.core.database import get_db
from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.schemas.task import BackgroundTaskRead
from app.services.exporting.archive_jobs import (
    PERSONAL_JOB_TYPES, archive_task_result, discard_personal_upload,
    queue_personal_export, queue_personal_restore, receive_personal_archive, require_account,
)
from app.services.exporting.system_archive import SystemArchiveError
from app.services.ownership import OwnershipScope, ownership_scope_from_request

router = APIRouter(prefix="/api/me/archive", tags=["personal-archive"])


class PersonalExportRequest(BaseModel):
    include_archived: bool = True


class PersonalRestoreRequest(BaseModel):
    preview_job_id: uuid.UUID
    content_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    include_preferences: bool = False


@router.get("/capabilities")
def archive_capabilities(db: Session = Depends(get_db), scope: OwnershipScope = Depends(ownership_scope_from_request)):
    try:
        require_account(db, scope.owner_user_id)
        return {"maximum_upload_bytes": get_settings().bundle_max_compressed_bytes, "upload_lifetime_hours": 24}
    except SystemArchiveError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get("/tasks", response_model=list[BackgroundTaskRead])
def personal_archive_tasks(limit: int = Query(default=30, ge=1, le=100), before: uuid.UUID | None = None,
                           db: Session = Depends(get_db), scope: OwnershipScope = Depends(ownership_scope_from_request)):
    try:
        require_account(db, scope.owner_user_id)
        query = db.query(BackgroundJob).filter(BackgroundJob.owner_user_id == scope.owner_user_id,
                                               BackgroundJob.job_type.in_(PERSONAL_JOB_TYPES))
        if before:
            cursor = query.filter(BackgroundJob.id == before).one_or_none()
            if cursor is None:
                raise SystemArchiveError("Archive task cursor not found.", 404)
            from sqlalchemy import or_, and_
            query = query.filter(or_(BackgroundJob.created_at < cursor.created_at,
                and_(BackgroundJob.created_at == cursor.created_at, BackgroundJob.id < cursor.id)))
        result = []
        for job in query.order_by(BackgroundJob.created_at.desc(), BackgroundJob.id.desc()).limit(limit):
            item = background_job_read(job)
            item.result = archive_task_result(db, job)
            result.append(item)
        return result
    except SystemArchiveError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post("/exports", response_model=BackgroundTaskRead, status_code=202)
def export_personal_archive(payload: PersonalExportRequest,
        key: str = Header(alias="Idempotency-Key", min_length=1, max_length=160),
        db: Session = Depends(get_db), scope: OwnershipScope = Depends(ownership_scope_from_request)):
    try:
        job = queue_personal_export(db, owner=scope.owner_user_id, include_archived=payload.include_archived, key=key)
        db.commit()
        return background_job_read(job)
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post("/previews", response_model=BackgroundTaskRead, status_code=202)
def preview_personal_archive(file: UploadFile = File(...),
        key: str = Header(alias="Idempotency-Key", min_length=1, max_length=160),
        db: Session = Depends(get_db), scope: OwnershipScope = Depends(ownership_scope_from_request)):
    try:
        job = receive_personal_archive(db, file.file, owner=scope.owner_user_id, key=key)
        db.commit()
        return background_job_read(job)
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post("/restores", response_model=BackgroundTaskRead, status_code=202)
def confirm_personal_restore(payload: PersonalRestoreRequest,
        db: Session = Depends(get_db), scope: OwnershipScope = Depends(ownership_scope_from_request)):
    try:
        job = queue_personal_restore(db, owner=scope.owner_user_id, preview_id=payload.preview_job_id,
            expected_digest=payload.content_digest, include_preferences=payload.include_preferences)
        db.commit()
        return background_job_read(job)
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.delete("/previews/{preview_id}", status_code=204)
def discard_upload(preview_id: uuid.UUID, db: Session = Depends(get_db),
                   scope: OwnershipScope = Depends(ownership_scope_from_request)):
    try:
        require_account(db, scope.owner_user_id)
        path = discard_personal_upload(db, owner=scope.owner_user_id, preview_id=preview_id)
        db.commit()
        if path:
            # A failed physical unlink leaves a discoverable, unreferenced
            # managed artifact for the existing manual cleanup service.
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
