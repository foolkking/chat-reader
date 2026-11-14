"""Lightweight archive task projection; safe in the supervisor interpreter."""
from datetime import datetime, timezone
from app.models.administration import SystemBackupRecord

SYSTEM_JOB_TYPES = ("system_archive_export", "system_archive_preflight", "system_archive_restore")
PERSONAL_JOB_TYPES = ("personal_archive_export", "personal_archive_preflight", "personal_archive_restore")

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
