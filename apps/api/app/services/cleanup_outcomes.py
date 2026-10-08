"""Small owner-scoped cleanup receipts on the existing scan task."""
from __future__ import annotations

import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupOccurrence, ContentCleanupScan
from app.models.import_record import utc_now
from app.services.ownership import OwnershipScope


def completed_job(db: Session, scan_id: uuid.UUID, scope: OwnershipScope) -> BackgroundJob | None:
    job = db.query(BackgroundJob).filter(
        scope.predicate(BackgroundJob), BackgroundJob.job_type == "content_noise_scan",
        BackgroundJob.idempotency_key == f"cleanup-apply:{scan_id}",
    ).populate_existing().one_or_none()
    if job is None or (job.result or {}).get("scan_id") != str(scan_id):
        return None
    receipt = (job.result or {}).get("cleanup_apply")
    return job if isinstance(receipt, dict) and receipt.get("status") == "COMPLETED" else None


def dismissed_job(db: Session, scan_id: uuid.UUID, scope: OwnershipScope) -> BackgroundJob | None:
    job = db.query(BackgroundJob).filter(scope.predicate(BackgroundJob),
        BackgroundJob.job_type == "content_noise_scan", BackgroundJob.idempotency_key == f"cleanup-dismiss:{scan_id}").populate_existing().one_or_none()
    receipt = (job.result or {}).get("cleanup_dismissal") if job else None
    return job if job and (job.result or {}).get("scan_id") == str(scan_id) and isinstance(receipt, dict) and receipt.get("status") == "DISMISSED" else None


def save_dismissed_outcome(db: Session, scan: ContentCleanupScan) -> None:
    job = db.query(BackgroundJob).filter_by(id=scan.background_job_id).populate_existing().with_for_update().one_or_none() if scan.background_job_id else None
    if job and (job.owner_user_id != scan.owner_user_id or job.job_type != "content_noise_scan" or (job.payload or {}).get("scan_id") != str(scan.id)):
        raise ValueError("Noise scan task binding changed.")
    if job and (job.status in {"processing", "cancelling"} or (job.status == "queued" and scan.status != "READY")):
        raise ValueError("Wait for the cleanup scan to finish before dismissing it.")
    if job is None:
        job = BackgroundJob(owner_user_id=scan.owner_user_id, job_type="content_noise_scan", payload={"scan_id": str(scan.id)}, result={})
        db.add(job)
    if job.idempotency_key and not job.idempotency_key.startswith("cleanup-dismiss:"):
        job.payload = {**(job.payload or {}), "cleanup_request_key": (job.payload or {}).get("cleanup_request_key") or job.idempotency_key}
    now = utc_now()
    job.idempotency_key = f"cleanup-dismiss:{scan.id}"
    job.result = {**(job.result or {}), "scan_id": str(scan.id), "cleanup_dismissal": {"status": "DISMISSED", "dismissed_at": now.isoformat()}}
    job.status = "committed"
    job.phase = "completed"
    job.progress = 100
    job.processed_items = scan.processed_messages
    job.total_items = scan.total_messages
    job.completed_at = now
    job.heartbeat_at = now
    job.error_message = None


def save_completed_outcome(db: Session, scan: ContentCleanupScan, response: dict) -> None:
    # Called before deleting the scan, inside the caller's final transaction.
    # APPLIED markers include earlier committed conversations after an interruption.
    db.flush()
    applied = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan.id, decision="APPLIED").count()
    job = db.query(BackgroundJob).filter_by(id=scan.background_job_id).populate_existing().with_for_update().one_or_none() if scan.background_job_id else None
    if job is not None and (job.owner_user_id != scan.owner_user_id or job.job_type != "content_noise_scan" or (job.payload or {}).get("scan_id") != str(scan.id)):
        raise ValueError("Noise scan task binding changed.")
    if job is None:
        job = BackgroundJob(owner_user_id=scan.owner_user_id, job_type="content_noise_scan",
                            payload={"scan_id": str(scan.id)}, result={})
        db.add(job)
    now = utc_now()
    if job.idempotency_key and not job.idempotency_key.startswith("cleanup-apply:"):
        # Completion has its own lookup key. Preserve admission identity, including
        # tasks created by a previous version before this payload member existed.
        job.payload = {**(job.payload or {}), "cleanup_request_key": (job.payload or {}).get("cleanup_request_key") or job.idempotency_key}
    job.idempotency_key = f"cleanup-apply:{scan.id}"
    job.result = {**(job.result or {}), "scan_id": str(scan.id), "cleanup_apply": {
        "status": "COMPLETED", "applied": applied, "conflicts": 0, "remaining": 0,
        "completed_at": now.isoformat(), "response": response,
    }}
    job.status = "committed"
    job.phase = "completed"
    job.progress = 100
    job.processed_items = scan.processed_messages
    job.total_items = scan.total_messages
    job.completed_at = now
    job.heartbeat_at = now
    job.error_message = None


def read_outcome(db: Session, scan_id: uuid.UUID, scope: OwnershipScope) -> dict | None:
    job = completed_job(db, scan_id, scope)
    if job is not None:
        return {key: value for key, value in job.result["cleanup_apply"].items() if key != "response"}
    # Read one consistent live state. Without the lock, completion could delete
    # the scan between loading it and recovering its lease/counting decisions.
    scan = db.query(ContentCleanupScan).filter(ContentCleanupScan.id == scan_id, scope.predicate(ContentCleanupScan)).populate_existing().with_for_update().one_or_none()
    if scan is None:
        # Completion may have committed between the two reads.
        job = completed_job(db, scan_id, scope)
        return {key: value for key, value in job.result["cleanup_apply"].items() if key != "response"} if job else None
    from app.services.content_cleanup import recover_expired_apply
    scan = recover_expired_apply(db, scan)
    counts = dict(db.query(ContentCleanupOccurrence.decision, func.count(ContentCleanupOccurrence.id))
                  .filter_by(scan_id=scan_id).group_by(ContentCleanupOccurrence.decision).all())
    return {"status": "APPLYING" if scan.status == "APPLYING" else "REVIEW",
            "applied": counts.get("APPLIED", 0), "conflicts": counts.get("CONFLICT", 0),
            "remaining": counts.get("DELETE", 0), "completed_at": None}
