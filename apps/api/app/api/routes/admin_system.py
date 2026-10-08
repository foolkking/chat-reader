"""Root-only system Skill, policy, backup and audit administration."""

from __future__ import annotations
from app.services.skill_bundles import bundle_disposition

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status, File, Form, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.routes.tasks import background_job_read
from app.core.database import get_db
from app.core.config import get_settings
from app.models.administration import AdminAuditLog, SystemBackupRecord, SystemSkill
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.schemas.task import BackgroundTaskRead
from app.services.administration import record_admin_audit, request_id_from, require_root_admin
from app.services.background_jobs import queue_system_archive_export
from app.services.exporting.system_archive import SystemArchiveError, restore_system_archive
from app.services.feature_policies import POLICY_FIELDS, FeaturePolicyConflict, feature_policy_revision, get_feature_policy, update_feature_policy
from app.services.ownership import ownership_scope_from_request
from app.services.system_skills import (
    builtin_by_key,
    create_system_skill,
    list_system_skills,
    restore_bundled_system_skill,
    update_system_skill,
)


router = APIRouter(prefix="/api/admin", tags=["root-administration"])


@router.get("/runtime-status")
def read_runtime_status(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    require_root_admin(request, db)
    from app.services.admin_runtime import runtime_snapshot
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Robots-Tag"] = "noindex, noarchive"
    return runtime_snapshot(db, get_settings())


class FeaturePolicyUpdate(BaseModel):
    base_revision: str | None = Field(default=None, min_length=1, max_length=128)
    allow_share_links: bool | None = None
    allow_public_share: bool | None = None
    allow_share_password: bool | None = None
    allow_user_skills: bool | None = None
    allow_skill_import: bool | None = None
    allow_user_import: bool | None = None
    maximum_import_size_mb: int | None = Field(default=None, ge=1, le=10_240)
    maximum_merge_message_count: int | None = Field(default=None, ge=2, le=100_000)
    export_retention_minutes: int | None = Field(default=None, ge=1, le=60)
    export_release_on_close: bool | None = None


class SystemSkillCreate(BaseModel):
    category: str = Field(pattern="^(EXPORT_CONTEXT|CONVERSATION_RESCUE|CONTEXT_MAINTENANCE)$")
    locale: str = Field(pattern="^(zh-CN|en)$")
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=512 * 1024)
    default_enabled: bool = False


class SystemSkillUpdate(BaseModel):
    base_revision: int | None = Field(default=None, ge=0)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=512 * 1024)
    status: str | None = Field(default=None, pattern="^(ACTIVE|DISABLED)$")
    default_enabled: bool | None = None


class BackupCreate(BaseModel):
    include_archived: bool = True


@router.get("/features")
def read_features(request: Request, db: Session = Depends(get_db)) -> dict:
    require_root_admin(request, db)
    return _policy_payload(get_feature_policy(db))


@router.put("/features")
def write_features(payload: FeaturePolicyUpdate, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = require_root_admin(request, db)
    try:
        row, changes = update_feature_policy(
            db,
            actor_user_id=actor.id,
            values=payload.model_dump(exclude_none=True, exclude={"base_revision"}),
            base_revision=payload.base_revision,
        )
    except FeaturePolicyConflict as error:
        raise HTTPException(status_code=409, detail="FEATURE_POLICY_CHANGED") from error
    if changes:
        record_admin_audit(
            db,
            actor_user_id=actor.id,
            action="GLOBAL_FEATURE_CHANGED",
            resource_type="instance_feature_policy",
            resource_id="1",
            metadata={"changed_fields": list(changes)},
            request_id=request_id_from(request),
        )
    result = _policy_payload(row)
    db.commit()
    return result


@router.get("/system-skills")
def read_system_skills(request: Request, effective: bool = False, db: Session = Depends(get_db)) -> list[dict]:
    require_root_admin(request, db)
    if effective:
        from app.services.system_skills import effective_system_skills
        result = [{**_system_skill_payload(row), "legacy_default_conflict": conflict}
                  for row, conflict in effective_system_skills(db)]
        db.commit()
        return result
    rows = list_system_skills(db)
    db.commit()
    return [_system_skill_payload(row) for row in rows]


@router.post('/system-skills/bundle', status_code=201)
async def create_system_bundle(request: Request, category: str = Form(...), locale: str = Form(...),
                               name: str = Form(...), file: UploadFile = File(...),
                               default_enabled: bool = Form(False), db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    from app.services.skill_bundles import MAX_UPLOAD, parse_bundle, save_revision
    if not (file.filename or '').lower().endswith(('.zip', '.md')):
        raise HTTPException(422, 'Upload a Skill ZIP or Markdown file.')
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD: raise HTTPException(413, 'Skill Bundle exceeds upload limit.')
    try:
        bundle = parse_bundle(data, file.filename or '')
        row = create_system_skill(db, actor_user_id=actor.id, category=category, locale=locale,
                                  name=name, content=bundle.content, default_enabled=default_enabled)
        save_revision(db, row, bundle, base_revision=0, preserve_baseline=False)
        record_admin_audit(db, actor_user_id=actor.id, action='SYSTEM_SKILL_CREATED',
                           resource_type='system_skill', resource_id=row.id, request_id=request_id_from(request))
        db.commit(); db.refresh(row)
        return _system_skill_payload(row)
    except ValueError as exc:
        db.rollback(); raise HTTPException(422, str(exc)) from exc


@router.post('/system-skills/{skill_id}/revisions')
async def replace_system_bundle(skill_id: uuid.UUID, request: Request, file: UploadFile = File(...),
                                base_revision: int = Form(..., ge=0), db: Session = Depends(get_db)):
    actor = require_root_admin(request, db)
    row = _system_skill(db, skill_id)
    from app.services.skill_bundles import MAX_UPLOAD, parse_bundle, save_revision
    if not (file.filename or '').lower().endswith(('.zip', '.md')):
        raise HTTPException(422, 'Upload a Skill ZIP or Markdown file.')
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD: raise HTTPException(413, 'Skill Bundle exceeds upload limit.')
    try:
        from app.services.system_skills import lock_system_category
        lock_system_category(db, row.category)
        save_revision(db, row, parse_bundle(data, file.filename or ''), base_revision=base_revision)
        update_system_skill(db, row, actor_user_id=actor.id, default_enabled=True)
        record_admin_audit(db, actor_user_id=actor.id, action='SYSTEM_SKILL_UPDATED',
                           resource_type='system_skill', resource_id=row.id, request_id=request_id_from(request))
        db.commit(); db.refresh(row)
        return _system_skill_payload(row)
    except RuntimeError as exc:
        db.rollback(); raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        db.rollback(); raise HTTPException(422, str(exc)) from exc


@router.get('/system-skills/{skill_id}/revisions')
def system_bundle_revisions(skill_id: uuid.UUID, request: Request, offset: int = Query(0, ge=0),
                            limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db)):
    require_root_admin(request, db)
    row = _system_skill(db, skill_id)
    from app.services.skill_bundles import revision_query
    from app.models.skill_bundle import SkillBundleRevision
    return [{'revision': r.revision, 'digest': r.digest, 'source_kind': r.source_kind,
             'byte_size': r.byte_size, 'created_at': r.created_at, 'is_current': r.revision == row.bundle_revision}
            for r in revision_query(db, row).order_by(SkillBundleRevision.revision.desc()).offset(offset).limit(limit).all()]


@router.get('/system-skills/{skill_id}/revisions/{number}/bundle')
def system_revision_download(skill_id: uuid.UUID, number: int, request: Request, db: Session = Depends(get_db)):
    require_root_admin(request, db)
    row = _system_skill(db, skill_id)
    from app.api.routes.skills import _revision
    from app.services.skill_bundles import download_revision
    return Response(download_revision(db, _revision(db, row, number)), media_type='application/zip', headers={
        'Content-Disposition': bundle_disposition(row.name), 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'})


@router.get('/system-skills/{skill_id}/revisions/{number}/members')
def system_revision_members(skill_id: uuid.UUID, number: int, request: Request, db: Session = Depends(get_db)):
    require_root_admin(request, db)
    from app.api.routes.skills import _revision
    from app.services.skill_bundles import member_rows
    revision = _revision(db, _system_skill(db, skill_id), number)
    return [{'path': member.path, 'byte_size': obj.byte_size, 'sha256': obj.sha256}
            for member, obj in member_rows(db, revision)]


@router.get('/system-skills/{skill_id}/revisions/{number}/member')
def system_revision_member(skill_id: uuid.UUID, number: int, request: Request, path: str = Query(...), db: Session = Depends(get_db)):
    require_root_admin(request, db)
    from app.api.routes.skills import _revision
    from app.services.skill_bundles import member_rows, read_member
    revision = _revision(db, _system_skill(db, skill_id), number)
    obj = next((obj for member, obj in member_rows(db, revision) if member.path == path), None)
    if obj is None: raise HTTPException(404, 'Skill member not found.')
    return Response(read_member(obj), media_type='text/plain', headers={
        'Content-Disposition': 'attachment; filename="skill-member.txt"', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox"})


@router.post("/system-skills", status_code=status.HTTP_201_CREATED)
def add_system_skill(payload: SystemSkillCreate, request: Request, db: Session = Depends(get_db)) -> dict:
    require_root_admin(request, db)
    raise HTTPException(422, 'Upload a Skill ZIP Bundle through /system-skills/bundle.')


@router.get("/system-skills/{skill_id}")
def read_system_skill(skill_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    require_root_admin(request, db)
    row = _system_skill(db, skill_id)
    return {**_system_skill_payload(row), "content": row.content}


@router.patch("/system-skills/{skill_id}")
def edit_system_skill(
    skill_id: uuid.UUID,
    payload: SystemSkillUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    actor = require_root_admin(request, db)
    row = _system_skill(db, skill_id)
    if payload.content is not None:
        raise HTTPException(422, 'Replace the Skill with a ZIP Bundle.')
    previous_status = row.status
    try:
        update_system_skill(db, row, actor_user_id=actor.id, **payload.model_dump(exclude_none=True))
        action = "SYSTEM_SKILL_UPDATED"
        if row.status != previous_status:
            action = "SYSTEM_SKILL_ENABLED" if row.status == "ACTIVE" else "SYSTEM_SKILL_DISABLED"
        record_admin_audit(
            db,
            actor_user_id=actor.id,
            action=action,
            resource_type="system_skill",
            resource_id=row.id,
            metadata={"category": row.category, "locale": row.locale},
            request_id=request_id_from(request),
        )
        db.commit()
        db.refresh(row)
        return _system_skill_payload(row)
    except RuntimeError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/system-skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_system_skill(skill_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> None:
    actor = require_root_admin(request, db)
    row = _system_skill(db, skill_id)
    if row.source_kind == "BUNDLED":
        raise HTTPException(status_code=409, detail="Bundled Skills cannot be deleted; restore the built-in version instead.")
    peers = db.query(SystemSkill).filter(
        SystemSkill.category == row.category,
    ).order_by(SystemSkill.id).with_for_update().populate_existing().all()
    if row.status == "ACTIVE" and not any(peer.id != row.id and peer.status == "ACTIVE" for peer in peers):
        raise HTTPException(status_code=409, detail="Keep at least one active system Skill for this purpose.")
    record_admin_audit(
        db,
        actor_user_id=actor.id,
        action="SYSTEM_SKILL_DELETED",
        resource_type="system_skill",
        resource_id=row.id,
        metadata={"category": row.category, "locale": row.locale},
        request_id=request_id_from(request),
    )
    from app.services.skill_cleanup import detach_skill_history, queue_skill_cleanup
    keys = detach_skill_history(db, row)
    queue_skill_cleanup(db, keys, owner_user_id=actor.id)
    db.delete(row)
    db.commit()


@router.post("/system-skills/{skill_id}/restore")
def restore_system_skill(skill_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = require_root_admin(request, db)
    row = _system_skill(db, skill_id)
    try:
        restore_bundled_system_skill(db, row, actor_user_id=actor.id)
        record_admin_audit(
            db,
            actor_user_id=actor.id,
            action="SYSTEM_SKILL_RESTORED",
            resource_type="system_skill",
            resource_id=row.id,
            metadata={"bundled_key": row.bundled_key},
            request_id=request_id_from(request),
        )
        db.commit()
        db.refresh(row)
        return _system_skill_payload(row)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/backups")
def list_backups(request: Request, db: Session = Depends(get_db)) -> list[dict]:
    require_root_admin(request, db)
    rows = db.query(SystemBackupRecord).order_by(SystemBackupRecord.created_at.desc()).limit(100).all()
    changed = False
    for row in rows:
        changed = _sync_backup_record(db, row) or changed
    if changed:
        db.commit()
    return [_backup_payload(row) for row in rows]


@router.post("/backups", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def create_backup(
    payload: BackupCreate,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    actor = require_root_admin(request, db)
    try:
        job = queue_system_archive_export(
            db,
            include_archived=payload.include_archived,
            idempotency_key=idempotency_key,
            ownership_scope=ownership_scope_from_request(request),
        )
    except SystemArchiveError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
    record = db.query(SystemBackupRecord).filter(SystemBackupRecord.background_job_id == job.id).one_or_none()
    if record is None:
        record = SystemBackupRecord(
            operation="BACKUP",
            status="QUEUED",
            requested_by_user_id=actor.id,
            background_job_id=job.id,
            summary={"include_archived": payload.include_archived},
        )
        db.add(record)
        db.flush()
        record_admin_audit(
            db,
            actor_user_id=actor.id,
            action="SYSTEM_BACKUP",
            resource_type="system_backup",
            resource_id=record.id,
            metadata={"background_job_id": job.id},
            request_id=request_id_from(request),
        )
    db.commit()
    return background_job_read(job)


@router.post("/backups/{backup_id}/restore")
def restore_backup(backup_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    actor = require_root_admin(request, db)
    backup = db.get(SystemBackupRecord, backup_id)
    if backup is None or backup.operation != "BACKUP" or backup.background_job_id is None:
        raise HTTPException(status_code=404, detail="Backup not found.")
    _sync_backup_record(db, backup)
    artifact = db.query(ExportArtifact).filter(ExportArtifact.job_id == backup.background_job_id).one_or_none()
    if backup.status != "COMPLETED" or artifact is None:
        raise HTTPException(status_code=409, detail="Backup is not ready for restore.")
    record = SystemBackupRecord(
        operation="RESTORE",
        status="RUNNING",
        requested_by_user_id=actor.id,
        source_backup_id=backup.id,
        artifact_name=artifact.filename,
        started_at=datetime.now(timezone.utc),
        summary={},
    )
    db.add(record)
    db.commit()
    try:
        restored = restore_system_archive(db, Path(artifact.storage_uri), target_root_id=actor.id)
        record = db.get(SystemBackupRecord, record.id)
        assert record is not None
        record.status = "COMPLETED"
        record.summary = {"restored_counts": restored}
        record.completed_at = datetime.now(timezone.utc)
        record_admin_audit(
            db,
            actor_user_id=actor.id,
            action="SYSTEM_RESTORE",
            resource_type="system_backup_restore",
            resource_id=record.id,
            metadata={"source_backup_id": backup.id},
            request_id=request_id_from(request),
        )
        db.commit()
        return _backup_payload(record)
    except SystemArchiveError as exc:
        db.rollback()
        record = db.get(SystemBackupRecord, record.id)
        assert record is not None
        record.status = "FAILED"
        record.summary = {"error_code": "RESTORE_REJECTED"}
        record.completed_at = datetime.now(timezone.utc)
        record_admin_audit(
            db,
            actor_user_id=actor.id,
            action="SYSTEM_RESTORE",
            resource_type="system_backup_restore",
            resource_id=record.id,
            result="FAILURE",
            metadata={"source_backup_id": backup.id},
            request_id=request_id_from(request),
        )
        db.commit()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/audit/page")
def paginated_audit_events(
    request: Request,
    action: str = Query(default="", max_length=64),
    actor: str = Query(default="", max_length=200),
    target: str = Query(default="", max_length=200),
    result: str = Query(default="ALL", pattern="^(ALL|SUCCESS|FAILURE|DENIED)$"),
    created_after: datetime | None = None,
    created_before: datetime | None = None,
    actor_user_id: uuid.UUID | None = None,
    target_user_id: uuid.UUID | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    require_root_admin(request, db)
    from app.services.admin_audit import audit_page
    start = _audit_time(created_after)
    end = _audit_time(created_before)
    if start and end and start > end:
        raise HTTPException(422, "The end time must be after the start time.")
    return audit_page(db, action=action, actor=actor, target=target, result=result,
        created_after=start, created_before=end, offset=offset, limit=limit,
        actor_user_id=actor_user_id, target_user_id=target_user_id)


@router.get("/audit/actions")
def audit_action_choices(request: Request, db: Session = Depends(get_db)) -> list[str]:
    require_root_admin(request, db)
    return [row[0] for row in db.query(AdminAuditLog.action).distinct().order_by(AdminAuditLog.action).limit(200)]


def _audit_time(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        raise HTTPException(422, "Audit time filters require a timezone.")
    return value.astimezone(timezone.utc)


@router.get("/audit")
def list_audit_events(
    request: Request,
    action: str | None = None,
    target_user_id: uuid.UUID | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> list[dict]:
    require_root_admin(request, db)
    query = db.query(AdminAuditLog)
    if action:
        query = query.filter(AdminAuditLog.action == action)
    if target_user_id:
        query = query.filter(AdminAuditLog.target_user_id == target_user_id)
    rows = query.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()).limit(max(1, min(limit, 250))).all()
    return [
        {
            "id": str(row.id),
            "actor_user_id": str(row.actor_user_id),
            "action": row.action,
            "target_user_id": str(row.target_user_id) if row.target_user_id else None,
            "resource_type": row.resource_type,
            "resource_id": row.resource_id,
            "result": row.result,
            "metadata": row.event_metadata,
            "request_id": row.request_id,
            "created_at": row.created_at,
        }
        for row in rows
    ]


def _policy_payload(row) -> dict:
    return {**{field: getattr(row, field) for field in POLICY_FIELDS}, "updated_at": row.updated_at, "revision": feature_policy_revision(row)}


def _system_skill(db: Session, skill_id: uuid.UUID) -> SystemSkill:
    row = db.get(SystemSkill, skill_id)
    if row is None:
        raise HTTPException(status_code=404, detail="System Skill not found.")
    return row


def _system_skill_payload(row: SystemSkill) -> dict:
    builtin_url = None
    if row.bundled_key:
        builtin_url = builtin_by_key(row.bundled_key).content_url
    return {
        "id": str(row.id),
        "skill_key": row.skill_key,
        "category": row.category,
        "locale": row.locale,
        "name": row.name,
        "source_kind": row.source_kind,
        "status": row.status,
        "default_enabled": row.default_enabled,
        "is_customized": row.source_kind == "BUNDLED" and row.content is not None,
        "byte_size": row.byte_size,
        "bundle_revision": row.bundle_revision,
        "bundle_url": f'/api/skills/system/{row.id}/bundle?revision={row.bundle_revision}' if row.bundle_revision or row.content is not None else builtin_by_key(row.bundled_key).bundle_url if row.bundled_key and row.content is None else None,
        "builtin_content_url": builtin_url,
        "updated_at": row.updated_at,
    }


def _sync_backup_record(db: Session, row: SystemBackupRecord) -> bool:
    if row.background_job_id is None:
        return False
    job = db.get(BackgroundJob, row.background_job_id)
    if job is None:
        return False
    mapped = {
        "queued": "QUEUED",
        "processing": "RUNNING",
        "cancelling": "RUNNING",
        "cancelled": "CANCELLED",
        "committed": "COMPLETED",
        "failed": "FAILED",
    }.get(job.status, row.status)
    changed = mapped != row.status
    row.status = mapped
    row.started_at = job.started_at
    row.completed_at = job.completed_at
    if job.result:
        row.artifact_name = job.result.get("filename") or row.artifact_name
        row.byte_size = job.result.get("byte_size") or row.byte_size
    return changed


def _backup_payload(row: SystemBackupRecord) -> dict:
    return {
        "id": str(row.id),
        "operation": row.operation,
        "status": row.status,
        "background_job_id": str(row.background_job_id) if row.background_job_id else None,
        "source_backup_id": str(row.source_backup_id) if row.source_backup_id else None,
        "artifact_name": row.artifact_name,
        "byte_size": row.byte_size,
        "summary": row.summary,
        "created_at": row.created_at,
        "started_at": row.started_at,
        "completed_at": row.completed_at,
    }
