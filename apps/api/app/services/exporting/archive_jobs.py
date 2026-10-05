"""Durable personal archive jobs and private, expiring upload artifacts."""
from __future__ import annotations

import hashlib
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from app.services.assets.asset_store import LocalAssetStore
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.archive_transaction import track_archive_object
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from app.services.exporting.system_archive import SystemArchiveError


PERSONAL_JOB_TYPES = ("personal_archive_export", "personal_archive_preflight", "personal_archive_restore")
ACTIVE = ("queued", "processing", "cancelling")
UPLOAD_SCOPE = "archive_upload"


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def require_account(db, owner):
    user = db.get(User, owner, populate_existing=True) if owner else None
    if user is None or not user.can_login:
        raise SystemArchiveError("The backup account is unavailable.", 403)
    return user


def _lock_key(db, owner, kind, key):
    if db.get_bind().dialect.name == "postgresql":
        digest = hashlib.sha256(f"archive-job:{owner}:{kind}:{key}".encode()).digest()
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int.from_bytes(digest[:8], "big", signed=True)})


def _existing(db, owner, kind, key):
    _lock_key(db, owner, kind, key)
    return db.query(BackgroundJob).filter_by(owner_user_id=owner, job_type=kind, idempotency_key=key).order_by(BackgroundJob.created_at.desc()).first()


def _new_job(db, owner, kind, key, payload):
    job = BackgroundJob(id=uuid.uuid4(), owner_user_id=owner, job_type=kind, payload=payload,
                        idempotency_key=key, status="queued", phase="queued", result={})
    db.add(job)
    db.flush()
    return job


def queue_personal_export(db: Session, *, owner, include_archived: bool, key: str):
    require_account(db, owner)
    existing = _existing(db, owner, "personal_archive_export", key)
    if existing:
        if existing.payload.get("include_archived") != include_archived:
            raise SystemArchiveError("This request key was already used for different backup options.", 409)
        return existing
    return _new_job(db, owner, "personal_archive_export", key, {"include_archived": include_archived})


def receive_personal_archive(db: Session, source, *, owner, key: str):
    return receive_archive(db, source, owner=owner, key=key, scope="personal")


def receive_archive(db: Session, source, *, owner, key: str, scope: str):
    """Only stream bytes on the API thread; ZIP parsing belongs to the worker."""
    require_account(db, owner)
    if scope not in {"personal", "system"}:
        raise ValueError("Unsupported archive upload scope.")
    existing = _existing(db, owner, f"{scope}_archive_preflight", key)
    if existing:
        return existing
    job = _new_job(db, owner, f"{scope}_archive_preflight", key, {})
    root = Path(get_settings().export_storage_dir).resolve()
    directory = root / str(job.id)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{scope}-restore.cr"
    temporary = directory / f".{scope}-restore.cr.tmp.{uuid.uuid4().hex}"
    digest, size = hashlib.sha256(), 0
    try:
        with temporary.open("xb") as destination:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > get_settings().bundle_max_compressed_bytes:
                    raise SystemArchiveError("Archive exceeds the upload size limit.", 413)
                digest.update(chunk)
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
        os.chmod(temporary, 0o600)
        if not size:
            raise SystemArchiveError("Select a non-empty archive.")
        # API rollback/commit failure removes the newly accepted file, including
        # Session.close(). No user-supplied filename becomes a storage path.
        track_archive_object(db, LocalAssetStore(root), path.relative_to(root).as_posix())
        temporary.replace(path)
        artifact = ExportArtifact(job_id=job.id, scope_type=UPLOAD_SCOPE, format=f"{scope}-archive-upload",
            filename=path.name, storage_uri=str(path), sha256=digest.hexdigest(), byte_size=size,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
        db.add(artifact)
        db.flush()
        job.payload = {"upload_artifact_id": str(artifact.id)}
        return job
    finally:
        temporary.unlink(missing_ok=True)


def _upload(db, preview_job, *, check_expiry=True, lock=False):
    query = db.query(ExportArtifact).filter_by(job_id=preview_job.id, scope_type=UPLOAD_SCOPE)
    if lock:
        query = query.with_for_update()
    artifact = query.one_or_none()
    if artifact is None:
        raise SystemArchiveError("The uploaded archive is no longer available. Upload it again.", 410)
    if check_expiry and _utc(artifact.expires_at) <= datetime.now(timezone.utc):
        raise SystemArchiveError("The uploaded archive has expired. Upload it again.", 410)
    root = Path(get_settings().export_storage_dir).resolve()
    path = Path(artifact.storage_uri).resolve()
    if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size != artifact.byte_size:
        raise SystemArchiveError("The uploaded archive is unavailable. Upload it again.", 410)
    return artifact, path


def owned_preview(db, owner, preview_id, *, scope="personal"):
    job = db.query(BackgroundJob).filter_by(id=preview_id, owner_user_id=owner, job_type=f"{scope}_archive_preflight").one_or_none()
    if job is None:
        raise SystemArchiveError("Archive preview not found.", 404)
    return job


def queue_personal_restore(db: Session, *, owner, preview_id, expected_digest, include_preferences=False):
    require_account(db, owner)
    preview = owned_preview(db, owner, preview_id)
    key = f"personal-restore:{preview.id}"
    existing = _existing(db, owner, "personal_archive_restore", key)
    if existing and existing.status != "cancelled":
        if (existing.payload.get("content_digest") != expected_digest or
                existing.payload.get("include_preferences") != include_preferences):
            raise SystemArchiveError("This preview has already been confirmed with different restore options.", 409)
        return existing
    if preview.status != "committed":
        raise SystemArchiveError("Wait for a successful archive preview before confirming restore.", 409)
    if preview.result.get("content_digest") != expected_digest:
        raise SystemArchiveError("Archive changed since preview. Preview it again.", 409)
    _upload(db, preview, lock=True)
    return _new_job(db, owner, "personal_archive_restore", key, {
        "parent_task_id": str(preview.id), "content_digest": expected_digest,
        "include_preferences": include_preferences,
    })


def discard_personal_upload(db, *, owner, preview_id):
    """Release only the uploaded source, never canonical restored data."""
    preview = owned_preview(db, owner, preview_id)
    # The same key orders confirmation and discard; the artifact lock also
    # protects a restore already executing in the worker transaction.
    _lock_key(db, owner, "personal_archive_restore", f"personal-restore:{preview.id}")
    artifact = db.query(ExportArtifact).filter_by(job_id=preview.id, scope_type=UPLOAD_SCOPE).with_for_update().one_or_none()
    if artifact is None:
        return None
    active_restore = db.query(BackgroundJob.id).filter(
        BackgroundJob.owner_user_id == owner, BackgroundJob.job_type == "personal_archive_restore",
        BackgroundJob.idempotency_key == f"personal-restore:{preview.id}", BackgroundJob.status.in_(ACTIVE),
    ).first()
    if preview.status in ACTIVE or active_restore:
        raise SystemArchiveError("Cancel or finish the archive task before removing its upload.", 409)
    path = Path(artifact.storage_uri).resolve()
    root = Path(get_settings().export_storage_dir).resolve()
    db.delete(artifact)
    return path if path.is_relative_to(root) else None


def archive_task_result(db, job):
    """Attach current artifact state for settings re-entry, without storage paths."""
    result = dict(job.result or {})
    if (job.payload or {}).get("parent_task_id"):
        result.setdefault("parent_task_id", job.payload["parent_task_id"])
    artifact = db.query(ExportArtifact).filter_by(job_id=job.id).one_or_none()
    if job.job_type in {"personal_archive_export", "personal_archive_preflight", "system_archive_export", "system_archive_preflight"}:
        result["expires_at"] = _utc(artifact.expires_at).isoformat() if artifact else None
        result["artifact_available"] = False
        if artifact and artifact.lifecycle_state == "active" and _utc(artifact.expires_at) > datetime.now(timezone.utc):
            path = Path(artifact.storage_uri).resolve()
            root = Path(get_settings().export_storage_dir).resolve()
            result["artifact_available"] = path.is_relative_to(root) and path.is_file() and path.stat().st_size == artifact.byte_size
        if artifact and artifact.scope_type != UPLOAD_SCOPE:
            from app.services.export_retention import artifact_status
            current = artifact_status(artifact)
            result.update(artifact_status=current["status"], retention_seconds=current["retention_seconds"],
                          release_on_close=current["release_on_close"], download_url=current["download_url"],
                          can_regenerate=current["status"] != "available")
    return result


def process_personal_archive_job(db, job, report):
    require_account(db, job.owner_user_id)
    payload = job.payload or {}
    phase_state = ["validating", 5, 0, 1]
    last_report = 0.0

    def progress(phase, percent, done, total):
        nonlocal last_report
        phase_state[:] = [phase, percent, done, total]
        last_report = time.monotonic()
        report(phase, percent, done, total)

    def heartbeat():
        nonlocal last_report
        if time.monotonic() - last_report >= 1:
            last_report = time.monotonic()
            report(*phase_state)

    if job.job_type == "personal_archive_export":
        artifact = create_personal_archive(db, job_id=job.id, owner_user_id=job.owner_user_id,
            include_archived=bool(payload.get("include_archived", True)), progress_callback=progress)
        return {"artifact_id": str(artifact.id), "filename": artifact.filename, "byte_size": artifact.byte_size,
                **artifact.archive_summary,
                "expires_at": _utc(artifact.expires_at).isoformat(), "download_url": f"/api/exports/{artifact.id}/download"}
    preview_job = job if job.job_type == "personal_archive_preflight" else owned_preview(db, job.owner_user_id, uuid.UUID(payload["parent_task_id"]))
    # Confirmation admits a queued restore before expiration. Its source remains
    # protected until the admitted task terminates, even across a worker restart.
    artifact, path = _upload(db, preview_job, check_expiry=job.job_type == "personal_archive_preflight", lock=True)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            heartbeat()
    if digest.hexdigest() != artifact.sha256:
        raise SystemArchiveError("The uploaded archive changed. Upload it again.", 409)
    if job.job_type == "personal_archive_preflight":
        preview = inspect_personal_archive(path, heartbeat=heartbeat)
        return {**preview, "expires_at": _utc(artifact.expires_at).isoformat()}
    result = restore_personal_archive(db, path, owner_user_id=job.owner_user_id,
        expected_digest=payload["content_digest"], include_preferences=bool(payload.get("include_preferences")),
        progress_callback=progress, heartbeat=heartbeat)
    return {**result, "parent_task_id": str(preview_job.id)}


def archive_job_error(exc):
    # Validation errors contain only server-authored static messages. SQLAlchemy,
    # scanner and OS errors may carry user content, parameters or storage paths.
    if isinstance(exc, SystemArchiveError):
        return str(exc)[:500]
    return "Archive operation failed. Your current data was preserved; retry the task or upload the archive again."
