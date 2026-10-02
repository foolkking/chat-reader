"""Root-owned system restore tasks with persistent, paginated ownership review."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from app.models.administration import SystemBackupRecord
from app.models.archive_restore import ArchiveRestoreAccount, ArchiveRestoreReceipt
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from app.services.exporting.archive_jobs import ACTIVE, UPLOAD_SCOPE, _existing, _lock_key, _new_job, _upload, _utc, owned_preview, receive_archive, require_account
from app.services.exporting.system_archive import SystemArchiveError, require_empty_system_instance, restore_system_archive
from app.services.exporting.system_archive_preflight import open_system_archive
from app.services.exporting.system_archive_configuration import require_configuration_restore_target


SYSTEM_JOB_TYPES = ("system_archive_export", "system_archive_preflight", "system_archive_restore")


def require_archive_admin(db, owner):
    user = require_account(db, owner)
    if user.role != "ADMIN":
        raise SystemArchiveError("System archive not found.", 404)
    return user


def receive_system_archive(db, source, *, owner, key):
    require_archive_admin(db, owner)
    return receive_archive(db, source, owner=owner, key=key, scope="system")


def system_preview(db, owner, preview_id, *, ready=True):
    require_archive_admin(db, owner)
    preview = owned_preview(db, owner, preview_id, scope="system")
    if ready and preview.status != "committed":
        raise SystemArchiveError("Wait for a successful archive preview before confirming restore.", 409)
    return preview


def account_rows(db, preview_id):
    return db.query(ArchiveRestoreAccount).filter_by(preview_job_id=preview_id).order_by(ArchiveRestoreAccount.source_key)


def ownership_revision(db, preview_id):
    digest = hashlib.sha256()
    for row in account_rows(db, preview_id).yield_per(250):
        digest.update(json.dumps([row.source_key, row.decision, str(row.target_user_id) if row.target_user_id else None], separators=(",", ":")).encode())
    return digest.hexdigest()


def _active_restore(db, owner, preview_id):
    return db.query(BackgroundJob.id).filter(BackgroundJob.owner_user_id == owner,
        BackgroundJob.job_type == "system_archive_restore", BackgroundJob.status.in_(ACTIVE),
        BackgroundJob.idempotency_key.startswith(f"system-restore:{preview_id}:")).first() is not None


def _review_lock(db, owner, preview_id):
    _lock_key(db, owner, "system_archive_review", str(preview_id))


def update_account_choice(db, *, owner, preview_id, source_key, decision, target_user_id, base_revision):
    preview = system_preview(db, owner, preview_id)
    _review_lock(db, owner, preview_id)
    if _active_restore(db, owner, preview_id) or db.get(ArchiveRestoreReceipt, (owner, preview.result["content_digest"])):
        raise SystemArchiveError("This archive already has a confirmed restore. View its task before changing ownership.", 409)
    if ownership_revision(db, preview_id) != base_revision:
        raise SystemArchiveError("Ownership choices changed in another view. Refresh before saving.", 409)
    _upload(db, preview, lock=True)
    row = db.get(ArchiveRestoreAccount, (preview_id, source_key))
    if row is None:
        raise SystemArchiveError("Archive source account not found.", 404)
    if row.source_role == "ADMIN":
        raise SystemArchiveError("An archived Root Admin must map to the current Root Admin.", 409)
    if decision == "NEW":
        if row.source_role != "USER" or target_user_id is not None:
            raise SystemArchiveError("Only archived ordinary identities can create a new account.", 422)
        if db.query(User.id).filter(User.normalized_email == row.normalized_email).first():
            raise SystemArchiveError("This email already exists. Select an existing target account.", 409)
        row.decision, row.target_user_id = "NEW", None
    elif decision == "EXISTING":
        target = db.get(User, target_user_id) if target_user_id else None
        if target is None:
            raise SystemArchiveError("An ownership mapping target is unavailable.", 409)
        row.decision, row.target_user_id = "EXISTING", target.id
    else:
        raise SystemArchiveError("Unsupported ownership decision.", 422)
    db.flush()
    return ownership_revision(db, preview_id)


def _confirmed_mapping(db, preview, owner):
    mapping, destinations = {}, set()
    for row in account_rows(db, preview.id).yield_per(250):
        if row.decision == "NEW":
            if row.source_role != "USER" or db.query(User.id).filter(User.normalized_email == row.normalized_email).first():
                raise SystemArchiveError("An archived email already exists. Review ownership before restoring.", 409)
            continue
        if row.decision == "UNSET" or row.target_user_id is None or db.get(User, row.target_user_id) is None:
            raise SystemArchiveError("Choose a target account for every unresolved source before restoring.", 409)
        if row.source_role == "ADMIN" and row.target_user_id != owner:
            raise SystemArchiveError("An archived Root Admin must map to the current Root Admin.", 409)
        if preview.result.get("configuration_included") and row.source_key != "unowned":
            if row.target_user_id in destinations:
                raise SystemArchiveError("Configuration restore requires a distinct target for each archived account.", 409)
            destinations.add(row.target_user_id)
        mapping[row.source_key] = str(row.target_user_id)
    return mapping


def queue_system_restore(db, *, owner, preview_id, expected_digest, base_revision):
    preview = system_preview(db, owner, preview_id)
    _review_lock(db, owner, preview_id)
    if preview.result.get("content_digest") != expected_digest:
        raise SystemArchiveError("Archive changed since preview. Preview it again.", 409)
    revision = ownership_revision(db, preview_id)
    if revision != base_revision:
        raise SystemArchiveError("Ownership choices changed. Review them before confirming.", 409)
    key = f"system-restore:{preview.id}:{revision}"
    existing = _existing(db, owner, "system_archive_restore", key)
    if existing and existing.status != "cancelled":
        return existing
    _upload(db, preview, lock=True)
    previous = db.get(ArchiveRestoreReceipt, (owner, expected_digest))
    if previous is None:
        require_empty_system_instance(db)
        if preview.result.get("configuration_included"):
            require_configuration_restore_target(db)
        _confirmed_mapping(db, preview, owner)
    job = _new_job(db, owner, "system_archive_restore", key, {
        "parent_task_id": str(preview.id), "content_digest": expected_digest, "ownership_revision": revision,
    })
    db.add(SystemBackupRecord(operation="RESTORE", status="QUEUED", requested_by_user_id=owner,
        background_job_id=job.id, content_digest=expected_digest, summary={}))
    db.flush()
    return job


def discard_system_upload(db, *, owner, preview_id):
    from app.core.config import get_settings
    preview = system_preview(db, owner, preview_id, ready=False)
    _review_lock(db, owner, preview_id)
    artifact = db.query(ExportArtifact).filter_by(job_id=preview.id, scope_type=UPLOAD_SCOPE).with_for_update().one_or_none()
    if artifact is None:
        return None
    if preview.status in ACTIVE or _active_restore(db, owner, preview.id):
        raise SystemArchiveError("Cancel or finish the archive task before removing its upload.", 409)
    root, path = Path(get_settings().export_storage_dir).resolve(), Path(artifact.storage_uri).resolve()
    db.delete(artifact)
    return path if path.is_relative_to(root) else None


def _save_source_accounts(db, job, archive):
    db.query(ArchiveRestoreAccount).filter_by(preview_job_id=job.id).delete(synchronize_session=False)
    source_root = False
    if archive.version == 5:
        for index, row in enumerate(archive.rows("users"), start=1):
            root = row["role"] == "ADMIN"
            source_root |= root
            collision = not root and db.query(User.id).filter(User.normalized_email == row["normalized_email"]).first() is not None
            db.add(ArchiveRestoreAccount(preview_job_id=job.id, source_key=row["id"], source_role=row["role"],
                normalized_email=row["normalized_email"], display_name=row.get("display_name"),
                decision="ROOT" if root else "UNSET" if collision else "NEW", target_user_id=job.owner_user_id if root else None))
            if index % 250 == 0:
                db.flush()
    for source in sorted(archive.referenced_owners):
        if archive.version == 5 and source != "unowned":
            continue
        db.add(ArchiveRestoreAccount(preview_job_id=job.id, source_key=source,
            source_role="UNOWNED" if source == "unowned" else "LEGACY",
            decision="EXISTING" if source_root else "UNSET", target_user_id=job.owner_user_id if source_root else None))
    db.flush()


def process_system_archive_job(db, job, report):
    require_archive_admin(db, job.owner_user_id)
    payload, last_report = job.payload or {}, 0.0
    phase_state = ["validating", 5, 0, 1]
    def progress(phase, percent, done, total):
        nonlocal last_report
        phase_state[:] = [phase, percent, done, total]
        last_report = time.monotonic()
        report(*phase_state)
    def heartbeat():
        nonlocal last_report
        if time.monotonic() - last_report >= 1:
            last_report = time.monotonic()
            report(*phase_state)
    preview = job if job.job_type == "system_archive_preflight" else system_preview(db, job.owner_user_id, uuid.UUID(payload["parent_task_id"]))
    if job.job_type == "system_archive_restore":
        _review_lock(db, job.owner_user_id, preview.id)
    artifact, path = _upload(db, preview, check_expiry=job.job_type == "system_archive_preflight", lock=True)
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            heartbeat()
    if digest.hexdigest() != artifact.sha256:
        raise SystemArchiveError("The uploaded archive changed. Upload it again.", 409)
    if job.job_type == "system_archive_preflight":
        with open_system_archive(path, heartbeat=heartbeat) as archive:
            _save_source_accounts(db, job, archive)
            result = archive.preview()
            result.pop("source_accounts", None)
            return {**result, "account_count": account_rows(db, job.id).count(),
                    "already_restored": db.get(ArchiveRestoreReceipt, (job.owner_user_id, archive.content_digest)) is not None,
                    "expires_at": _utc(artifact.expires_at).isoformat()}
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": int.from_bytes(hashlib.sha256(b"system-archive-restore").digest()[:8], "big", signed=True)})
    previous = db.get(ArchiveRestoreReceipt, (job.owner_user_id, payload["content_digest"]), populate_existing=True)
    if previous:
        return {**previous.result, "already_restored": True, "parent_task_id": str(preview.id)}
    if ownership_revision(db, preview.id) != payload["ownership_revision"]:
        raise SystemArchiveError("Ownership choices changed. Confirm a new restore from the preview.", 409)
    mapping = _confirmed_mapping(db, preview, job.owner_user_id)
    counts = restore_system_archive(db, path, target_root_id=job.owner_user_id, owner_mapping=mapping,
        expected_digest=payload["content_digest"], progress_callback=progress, heartbeat=heartbeat)
    result = {"restore_id": str(uuid.uuid5(job.owner_user_id, f"system-archive:{payload['content_digest']}")),
        "counts": counts, "parent_task_id": str(preview.id), "already_restored": False,
        "missing_assets": preview.result.get("missing_assets", 0), "preferences_imported": bool(counts.get("preferences"))}
    db.add(ArchiveRestoreReceipt(owner_user_id=job.owner_user_id, content_digest=payload["content_digest"],
        restore_id=uuid.UUID(result["restore_id"]), result=result))
    db.flush()
    return result


def sync_system_archive_record(db, job, *, result=None, status=None):
    record = db.query(SystemBackupRecord).filter_by(background_job_id=job.id).one_or_none()
    if record is None:
        return
    record.status = status or {"queued": "QUEUED", "processing": "RUNNING", "cancelling": "RUNNING",
        "failed": "FAILED", "cancelled": "CANCELLED", "committed": "COMPLETED"}.get(job.status, record.status)
    record.started_at = job.started_at
    if record.status in {"COMPLETED", "FAILED", "CANCELLED"}:
        record.completed_at = datetime.now(timezone.utc)
        from app.models.administration import AdminAuditLog
        from app.services.administration import record_admin_audit
        action = f"SYSTEM_{record.operation}_{record.status}"
        if not db.query(AdminAuditLog.id).filter_by(action=action, resource_id=str(job.id)).first():
            record_admin_audit(db, actor_user_id=job.owner_user_id, action=action,
                resource_type="system_archive_task", resource_id=job.id,
                result="FAILURE" if record.status == "FAILED" else "SUCCESS",
                metadata={"already_restored": bool((result or {}).get("already_restored"))})
    else:
        record.completed_at = None
    if result:
        record.summary = {"restored_counts": result.get("counts", {}), "already_restored": result.get("already_restored", False)}
        record.artifact_name, record.byte_size = result.get("filename"), result.get("byte_size")
