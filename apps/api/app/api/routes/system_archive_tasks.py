"""Root-only asynchronous archive review and restoration; legacy routes remain."""
import uuid

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.archive_restore import ArchiveRestoreAccount
from app.models.background_job import BackgroundJob
from app.models.user import User
from app.api.routes.tasks import background_job_read
from app.schemas.task import BackgroundTaskRead
from app.services.administration import require_root_admin, record_admin_audit, request_id_from
from app.services.exporting.archive_jobs import archive_task_result
from app.services.exporting.system_archive import SystemArchiveError, require_empty_system_instance
from app.services.exporting.system_archive_configuration import require_configuration_restore_target
from app.services.exporting.system_archive_jobs import (
    SYSTEM_JOB_TYPES, account_rows, discard_system_upload, ownership_revision, queue_system_restore,
    receive_system_archive, system_preview, update_account_choice,
)

router = APIRouter(prefix="/api/system/archive", tags=["system-archive"])


class OwnershipChoice(BaseModel):
    decision: str = Field(pattern="^(NEW|EXISTING)$")
    target_user_id: uuid.UUID | None = None
    base_revision: str = Field(pattern="^[0-9a-f]{64}$")


class RestoreConfirmation(BaseModel):
    preview_job_id: uuid.UUID
    content_digest: str = Field(pattern="^[0-9a-f]{64}$")
    ownership_revision: str = Field(pattern="^[0-9a-f]{64}$")


@router.get("/capabilities")
def capabilities(request: Request, db: Session = Depends(get_db)):
    require_root_admin(request, db)
    settings = get_settings()
    reason = None
    try:
        require_empty_system_instance(db)
        require_configuration_restore_target(db)
    except SystemArchiveError as exc:
        reason = str(exc)
    return {"maximum_upload_bytes": settings.bundle_max_compressed_bytes, "upload_lifetime_hours": 24,
            "empty_instance": reason is None, "restore_blocked_reason": reason,
            "smtp_configured": bool(settings.smtp_host and settings.smtp_from_address)}


@router.get("/tasks", response_model=list[BackgroundTaskRead])
def archive_tasks(request: Request, limit: int = Query(default=30, ge=1, le=100),
                  before: uuid.UUID | None = None, db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    query = db.query(BackgroundJob).filter(BackgroundJob.owner_user_id == actor.id, BackgroundJob.job_type.in_(SYSTEM_JOB_TYPES))
    if before:
        cursor = query.filter(BackgroundJob.id == before).one_or_none()
        if cursor is None:
            raise HTTPException(404, "Archive task cursor not found.")
        query = query.filter(or_(BackgroundJob.created_at < cursor.created_at,
            and_(BackgroundJob.created_at == cursor.created_at, BackgroundJob.id < cursor.id)))
    items = []
    for job in query.order_by(BackgroundJob.created_at.desc(), BackgroundJob.id.desc()).limit(limit):
        item = background_job_read(job)
        item.result = archive_task_result(db, job)
        items.append(item)
    return items


@router.post("/previews", response_model=BackgroundTaskRead, status_code=202)
def upload_archive(request: Request, file: UploadFile = File(...),
                   key: str = Header(alias="Idempotency-Key", min_length=1, max_length=160),
                   db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    try:
        job = receive_system_archive(db, file.file, owner=actor.id, key=key)
        db.commit()
        return background_job_read(job)
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get("/previews/{preview_id}/accounts")
def preview_accounts(preview_id: uuid.UUID, request: Request, offset: int = Query(default=0, ge=0),
                     limit: int = Query(default=50, ge=1, le=100), unresolved_only: bool = False,
                     db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    try:
        system_preview(db, actor.id, preview_id)
        query = account_rows(db, preview_id)
        unresolved = query.filter(or_(ArchiveRestoreAccount.decision == "UNSET",
            and_(ArchiveRestoreAccount.decision.in_(("ROOT", "EXISTING")), ArchiveRestoreAccount.target_user_id.is_(None)))).count()
        total = query.count()
        if unresolved_only:
            query = query.filter(or_(ArchiveRestoreAccount.decision == "UNSET",
                and_(ArchiveRestoreAccount.decision.in_(("ROOT", "EXISTING")), ArchiveRestoreAccount.target_user_id.is_(None))))
        matched = query.count()
        rows = query.offset(offset).limit(limit).all()
        target_ids = [row.target_user_id for row in rows if row.target_user_id]
        emails = [row.normalized_email for row in rows if row.normalized_email]
        users = db.query(User).filter(or_(User.id.in_(target_ids), User.normalized_email.in_(emails))).all()
        by_id, by_email = {user.id: user for user in users}, {user.normalized_email: user for user in users}
        def identity(user):
            return {"id": str(user.id), "email": user.normalized_email, "display_name": user.display_name, "role": user.role} if user else None
        return {"total": total, "matched": matched, "unresolved": unresolved, "offset": offset, "limit": limit,
            "revision": ownership_revision(db, preview_id), "items": [{
                "source_key": row.source_key, "role": row.source_role, "email": row.normalized_email,
                "display_name": row.display_name, "decision": row.decision,
                "target": identity(by_id.get(row.target_user_id)), "suggested_target": identity(by_email.get(row.normalized_email)),
            } for row in rows]}
    except SystemArchiveError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.get("/account-targets")
def account_targets(request: Request, q: str = Query(default="", max_length=200),
                    offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100),
                    db: Session = Depends(get_db)):
    require_root_admin(request, db)
    query = db.query(User)
    if q.strip():
        query = query.filter(or_(User.normalized_email.contains(q.strip(), autoescape=True), User.display_name.contains(q.strip(), autoescape=True)))
    return {"total": query.count(), "items": [{"id": str(user.id), "email": user.normalized_email,
        "display_name": user.display_name, "role": user.role, "status": user.status}
        for user in query.order_by(User.normalized_email, User.id).offset(offset).limit(limit)]}


@router.patch("/previews/{preview_id}/accounts/{source_key}")
def save_choice(preview_id: uuid.UUID, source_key: str, payload: OwnershipChoice,
                request: Request, db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    try:
        revision = update_account_choice(db, owner=actor.id, preview_id=preview_id, source_key=source_key,
            decision=payload.decision, target_user_id=payload.target_user_id, base_revision=payload.base_revision)
        db.commit()
        return {"revision": revision}
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.post("/restores", response_model=BackgroundTaskRead, status_code=202)
def confirm_restore(payload: RestoreConfirmation, request: Request, db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    try:
        job = queue_system_restore(db, owner=actor.id, preview_id=payload.preview_job_id,
            expected_digest=payload.content_digest, base_revision=payload.ownership_revision)
        # The job/backup record owns the final result. This audit records the
        # explicit confirmation without source emails, content or filenames.
        from app.models.administration import AdminAuditLog
        exists = db.query(AdminAuditLog.id).filter_by(action="SYSTEM_RESTORE_QUEUED", resource_id=str(job.id)).first()
        if not exists:
            record_admin_audit(db, actor_user_id=actor.id, action="SYSTEM_RESTORE_QUEUED", resource_type="system_restore_task",
                               resource_id=job.id, request_id=request_id_from(request))
        db.commit()
        return background_job_read(job)
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc


@router.delete("/previews/{preview_id}", status_code=204)
def remove_upload(preview_id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    try:
        path = discard_system_upload(db, owner=actor.id, preview_id=preview_id)
        db.commit()
        if path:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
