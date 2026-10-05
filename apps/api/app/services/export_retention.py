"""Bounded export reclamation, coordinated with real response lifetimes.

All lease/reclamation transitions lock the artifact row first. A crashed download
loses its renewable lease; a crashed unlink is retried from durable reclaiming.
No archive upload or canonical/offline object is eligible for this lifecycle.
"""
from __future__ import annotations

import logging
import stat
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import or_, select

from app.core.observability import structured_event
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact, ExportArtifactLease
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.services.feature_policies import get_feature_policy
from app.services.ownership import get_owned

logger = logging.getLogger(__name__)
EXPORT_JOB_TYPES = frozenset({"conversation_export", "system_archive_export", "personal_archive_export", "attachment_batch_download"})
VIEWER_SECONDS = 45
DOWNLOAD_SECONDS = 90


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def finalize_export_lifetime(db, job, result: dict, *, now=None) -> None:
    """Called immediately before the worker's existing successful outer commit."""
    if job.job_type not in EXPORT_JOB_TYPES or not result.get("artifact_id"):
        return
    artifact = db.get(ExportArtifact, uuid.UUID(result["artifact_id"]))
    if artifact is None or artifact.job_id != job.id or artifact.scope_type == "archive_upload":
        raise RuntimeError("Export publication is missing its final artifact")
    policy = get_feature_policy(db)
    timestamp = now or now_utc()
    artifact.retention_seconds = policy.export_retention_minutes * 60
    artifact.expires_at = timestamp + timedelta(seconds=artifact.retention_seconds)
    artifact.release_on_close = policy.export_release_on_close
    artifact.policy_updated_at = policy.updated_at
    result.update({"expires_at": artifact.expires_at.isoformat(), "artifact_status": "available",
                   "retention_seconds": artifact.retention_seconds, "release_on_close": artifact.release_on_close})


def regenerate_export(db, artifact, ownership_scope, key):
    """Re-admit the original options against current owned data, never a stale snapshot."""
    from app.services.background_jobs import queue_attachment_download, queue_conversation_export, queue_system_archive_export
    from app.services.exporting.archive_jobs import _lock_key, queue_personal_export
    original = db.get(BackgroundJob, artifact.job_id)
    payload = original.payload or {}
    request_key = f"regenerate:{artifact.id}:{key}"
    _lock_key(db, ownership_scope.owner_user_id, "export_regenerate", request_key)
    if original.job_type == "conversation_export":
        options = {name: payload[name] for name in (
            "include_description", "include_annotations", "include_notebook", "include_metadata", "include_source_refs",
            "export_format", "context_scope", "context_attachment_policy", "continuation_policy",
        ) if name in payload}
        job = queue_conversation_export(db, conversation_id=uuid.UUID(payload["conversation_id"]),
            idempotency_key=request_key, ownership_scope=ownership_scope,
            start_message_id=uuid.UUID(payload["start_message_id"]) if payload.get("start_message_id") else None, **options)
    elif original.job_type == "attachment_batch_download":
        job = queue_attachment_download(db, conversation_id=uuid.UUID(payload["conversation_id"]),
            attachment_ids=[uuid.UUID(value) for value in payload["attachment_ids"]],
            idempotency_key=request_key, ownership_scope=ownership_scope)
    elif original.job_type == "personal_archive_export":
        job = queue_personal_export(db, owner=ownership_scope.owner_user_id,
                                   include_archived=bool(payload.get("include_archived", True)), key=request_key)
    elif original.job_type == "system_archive_export":
        job = queue_system_archive_export(db, include_archived=bool(payload.get("include_archived", True)),
                                          idempotency_key=request_key, ownership_scope=ownership_scope)
    else:
        raise HTTPException(404, "Export not found.")
    job.payload = {**job.payload, "parent_task_id": str(original.id)}
    db.flush()
    return job


def owned_export(db, artifact_id, ownership_scope, *, lock=False):
    query = select(ExportArtifact).where(ExportArtifact.id == artifact_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    artifact = db.scalar(query)
    if artifact is None or artifact.scope_type == "archive_upload":
        raise HTTPException(404, "Export not found.")
    job = get_owned(db, BackgroundJob, artifact.job_id, ownership_scope)
    if job is None or job.job_type not in EXPORT_JOB_TYPES:
        raise HTTPException(404, "Export not found.")
    if job.status != "committed":
        raise HTTPException(409, "Export artifact is not ready.")
    return artifact


def require_available(artifact, *, now=None):
    if artifact.lifecycle_state != "active" or utc(artifact.expires_at) <= (now or now_utc()):
        raise HTTPException(410, detail={"code": "EXPORT_EXPIRED", "next_action": "regenerate"})


def artifact_status(artifact, *, now=None) -> dict:
    timestamp = now or now_utc()
    state = artifact.lifecycle_state
    status = "available" if state == "active" and utc(artifact.expires_at) > timestamp else "expired" if state == "active" else state
    if status == "available":
        from app.core.config import get_settings
        from app.services.artifact_lifecycle import validate_final_artifact
        try:
            path = Path(artifact.storage_uri).resolve()
            if not path.is_relative_to(Path(get_settings().export_storage_dir).resolve()) or not validate_final_artifact(path, expected_size=artifact.byte_size):
                status = "unavailable"
        except (OSError, ValueError):
            status = "unavailable"
    return {"artifact_id": str(artifact.id), "status": status,
            "expires_at": utc(artifact.expires_at).isoformat(), "server_now": timestamp.isoformat(),
            "retention_seconds": artifact.retention_seconds, "release_on_close": artifact.release_on_close,
            "download_url": f"/api/exports/{artifact.id}/download" if status == "available" else None,
            "next_action": None if status == "available" else "regenerate",
            "failure_code": artifact.failure_code}


def acquire_viewer(db, artifact, lease_id, *, now=None):
    timestamp = now or now_utc()
    require_available(artifact, now=timestamp)
    lease = db.get(ExportArtifactLease, (artifact.id, lease_id))
    if lease is not None and lease.kind != "viewer":
        raise HTTPException(409, "Export usage changed. Reopen the result.")
    if lease is None:
        lease = ExportArtifactLease(artifact_id=artifact.id, id=lease_id, kind="viewer")
        db.add(lease)
    # A view heartbeat never extends the artifact deadline.
    lease.expires_at = min(utc(artifact.expires_at), timestamp + timedelta(seconds=VIEWER_SECONDS))
    db.flush()


def release_viewer(db, artifact, lease_id, *, now=None):
    lease = db.get(ExportArtifactLease, (artifact.id, lease_id))
    if lease is not None and lease.kind == "viewer":
        db.delete(lease)
        if artifact.release_on_close and artifact.lifecycle_state == "active":
            artifact.release_requested_at = now or now_utc()
        db.flush()


def claim_download(db, artifact, lease_id, *, now=None):
    timestamp = now or now_utc()
    require_available(artifact, now=timestamp)
    lease = db.get(ExportArtifactLease, (artifact.id, lease_id))
    if lease is not None:
        if lease.kind != "claim" or utc(lease.expires_at) <= timestamp:
            raise HTTPException(409, "Download claim already used or expired.")
        return lease.id
    lease = ExportArtifactLease(artifact_id=artifact.id, id=lease_id, kind="claim",
                                expires_at=min(utc(artifact.expires_at), timestamp + timedelta(seconds=15)))
    db.add(lease)
    db.flush()
    return lease.id


def acquire_download(db, artifact, *, claim_id=None, now=None):
    timestamp = now or now_utc()
    require_available(artifact, now=timestamp)
    if claim_id is not None:
        lease = db.get(ExportArtifactLease, (artifact.id, claim_id))
        if lease is None or lease.kind != "claim" or utc(lease.expires_at) <= timestamp:
            raise HTTPException(410, detail={"code": "EXPORT_CLAIM_EXPIRED", "next_action": "retry_download"})
        lease.kind = "download"
        lease.expires_at = timestamp + timedelta(seconds=DOWNLOAD_SECONDS)
    else:
        lease = ExportArtifactLease(artifact_id=artifact.id, kind="download",
                                    expires_at=timestamp + timedelta(seconds=DOWNLOAD_SECONDS))
        db.add(lease)
    artifact.download_count += 1
    db.flush()
    return lease.id


def renew_download(factory, artifact_id, lease_id, *, now=None) -> bool:
    with factory() as db:
        artifact = db.scalar(select(ExportArtifact).where(ExportArtifact.id == artifact_id).with_for_update())
        if artifact is None or artifact.lifecycle_state != "active":
            return False
        lease = db.get(ExportArtifactLease, (artifact_id, lease_id))
        timestamp = now or now_utc()
        if lease is None or lease.kind != "download" or utc(lease.expires_at) <= timestamp:
            return False
        # Only an active response, not a browser status request, can renew this.
        lease.expires_at = timestamp + timedelta(seconds=DOWNLOAD_SECONDS)
        db.commit()
        return True


def release_download(factory, artifact_id, lease_id):
    with factory() as db:
        artifact = db.scalar(select(ExportArtifact).where(ExportArtifact.id == artifact_id).with_for_update())
        if artifact is None:
            return
        lease = db.get(ExportArtifactLease, (artifact_id, lease_id))
        if lease is not None and lease.kind == "download":
            db.delete(lease)
        db.commit()


def _eligible(db, artifact, timestamp):
    if artifact.scope_type == "archive_upload" or artifact.lifecycle_state == "reclaimed":
        return False
    job = db.get(BackgroundJob, artifact.job_id)
    if job is None or job.status != "committed" or job.job_type not in EXPORT_JOB_TYPES:
        return False
    if artifact.retry_at is not None and utc(artifact.retry_at) > timestamp:
        return False
    expired = utc(artifact.expires_at) <= timestamp
    if not expired and artifact.release_requested_at is None and artifact.lifecycle_state == "active":
        return False
    leases = select(ExportArtifactLease.id).where(ExportArtifactLease.artifact_id == artifact.id,
                                                ExportArtifactLease.expires_at > timestamp)
    # At expiry only actual transfers may defer physical removal.
    if expired:
        leases = leases.where(ExportArtifactLease.kind == "download")
    return db.scalar(leases.limit(1)) is None


def _safe_file(db, artifact, root: Path) -> Path:
    path = Path(artifact.storage_uri).absolute()
    if (path != path.resolve() or path.parent != root / str(artifact.job_id)
            or path.suffix not in {".cr", ".zip"}):
        raise ValueError("unsafe_path")
    if db.scalar(select(ExportArtifact.id).where(ExportArtifact.storage_uri == artifact.storage_uri,
                                               ExportArtifact.id != artifact.id).limit(1)) is not None:
        raise ValueError("shared_reference")
    if db.scalar(select(OfflinePackageArtifact.id).where(OfflinePackageArtifact.storage_uri == artifact.storage_uri).limit(1)) is not None:
        raise ValueError("offline_reference")
    try:
        info = path.lstat()
    except FileNotFoundError:
        return path
    if not stat.S_ISREG(info.st_mode) or info.st_size != artifact.byte_size or info.st_nlink != 1:
        raise ValueError("file_changed")
    return path


def reclaim_exports(factory, root: Path, *, now=None, limit=20) -> dict:
    """Bounded maintenance, callable while the worker is busy with a long job."""
    timestamp = now or now_utc()
    root = root.resolve()
    counts = {"reclaimed": 0, "bytes": 0, "failed": 0, "deferred": 0}
    with factory() as db:
        # Exclude occupied rows before LIMIT so large numbers of slow downloads
        # cannot starve other expired artifacts. _eligible rechecks under lock.
        active_download = select(ExportArtifactLease.id).where(
            ExportArtifactLease.artifact_id == ExportArtifact.id,
            ExportArtifactLease.kind == "download", ExportArtifactLease.expires_at > timestamp).exists()
        ids = list(db.scalars(select(ExportArtifact.id).where(
            ExportArtifact.scope_type != "archive_upload", ExportArtifact.lifecycle_state != "reclaimed",
            ExportArtifact.job_id.in_(select(BackgroundJob.id).where(
                BackgroundJob.job_type.in_(EXPORT_JOB_TYPES), BackgroundJob.status == "committed")),
            or_(ExportArtifact.expires_at <= timestamp, ExportArtifact.release_requested_at.is_not(None),
                ExportArtifact.lifecycle_state.in_(["reclaiming", "retry"])),
            or_(ExportArtifact.retry_at.is_(None), ExportArtifact.retry_at <= timestamp), ~active_download,
        ).order_by(ExportArtifact.expires_at, ExportArtifact.id).limit(min(max(limit, 1), 100))))
    for artifact_id in ids:
        with factory() as db:
            artifact = db.scalar(select(ExportArtifact).where(ExportArtifact.id == artifact_id).with_for_update(skip_locked=True))
            if artifact is None or not _eligible(db, artifact, timestamp):
                counts["deferred"] += 1
                continue
            artifact.lifecycle_state = "reclaiming"
            db.commit()
        with factory() as db:
            artifact = db.scalar(select(ExportArtifact).where(ExportArtifact.id == artifact_id).with_for_update(skip_locked=True))
            if artifact is None or not _eligible(db, artifact, timestamp):
                counts["deferred"] += 1
                continue
            try:
                path = _safe_file(db, artifact, root)
                existed = path.exists()
                path.unlink(missing_ok=True)
            except (OSError, ValueError) as exc:
                artifact.lifecycle_state = "retry"
                artifact.failure_count += 1
                artifact.failure_code = str(exc) if isinstance(exc, ValueError) else "unlink_failed"
                artifact.retry_at = timestamp + timedelta(seconds=min(3600, 15 * 2 ** min(artifact.failure_count, 8)))
                counts["failed"] += 1
            else:
                artifact.lifecycle_state = "reclaimed"
                artifact.reclaimed_at = timestamp
                artifact.failure_code = None
                artifact.retry_at = None
                db.query(ExportArtifactLease).filter_by(artifact_id=artifact.id).delete(synchronize_session=False)
                counts["reclaimed"] += 1
                counts["bytes"] += artifact.byte_size if existed else 0
            job = db.get(BackgroundJob, artifact.job_id)
            job.result = {**(job.result or {}), "artifact_status": artifact.lifecycle_state, "download_url": None,
                          "can_regenerate": True, "expires_at": utc(artifact.expires_at).isoformat()}
            db.commit()
    if counts["reclaimed"] or counts["failed"]:
        structured_event(logger, logging.INFO, "export_reclamation", **counts)
    return counts
