"""Execution status is owned by the bound worker job, not the scan cursor."""
from sqlalchemy.orm import Session
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan


def scan_job(db: Session, scan: ContentCleanupScan) -> BackgroundJob | None:
    job = db.get(BackgroundJob, scan.background_job_id) if scan.background_job_id else None
    if job and job.owner_user_id == scan.owner_user_id and job.job_type == "content_noise_scan" and (job.payload or {}).get("scan_id") == str(scan.id):
        return job
    return None


def scan_status(scan: ContentCleanupScan, job: BackgroundJob | None) -> str:
    # READY/APPLYING are the review lifecycle, independent of the finished worker.
    if job and scan.status in {"QUEUED", "SCANNING", "FAILED"}:
        if job.status in {"cancelled", "failed"}:
            return job.status.upper()
        if job.status in {"queued", "processing", "cancelling"} and scan.status != "FAILED":
            return "QUEUED" if job.status == "queued" else "SCANNING"
    return scan.status
