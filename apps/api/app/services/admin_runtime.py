"""Root-only bounded snapshots; no proxying internal operator diagnostics."""

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.administration import SystemBackupRecord
from app.models.attachment import AssetObject
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services.diagnostics import storage_usage, worker_status

STATUSES = ("queued", "processing", "cancelling", "committed", "failed", "cancelled")


def _metric(db: Session, read):
    try:
        with db.begin_nested():
            if db.get_bind().dialect.name == "postgresql":
                db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
            return {"available": True, **read()}
    except Exception:
        return {"available": False}


def _counts(db: Session, model) -> dict[str, int]:
    rows = db.query(model.status, func.count(model.id)).filter(model.status.in_(STATUSES)).group_by(model.status).all()
    counts = dict(rows)
    return {state: int(counts.get(state, 0)) for state in STATUSES}


def _backup(db: Session, operation: str) -> dict:
    row = db.query(SystemBackupRecord, BackgroundJob).outerjoin(BackgroundJob, BackgroundJob.id == SystemBackupRecord.background_job_id).filter(
        SystemBackupRecord.operation == operation,
    ).order_by(SystemBackupRecord.created_at.desc(), SystemBackupRecord.id.desc()).first()
    if row is None:
        return {"record": None}
    record, job = row
    status_map = {"queued": "QUEUED", "processing": "RUNNING", "cancelling": "RUNNING", "committed": "COMPLETED", "failed": "FAILED", "cancelled": "CANCELLED"}
    status = status_map.get(job.status, record.status) if job else record.status
    return {"record": {"status": status if status in set(status_map.values()) else "UNKNOWN",
        "created_at": record.created_at, "completed_at": job.completed_at if job else record.completed_at}}


def _local_storage(root: str) -> dict:
    try:
        path = Path(root)
        if not path.is_dir():
            return {"available": False, "complete": False}
        usage = storage_usage(path, max_entries=10_000, time_budget_seconds=0.15)
        return {"available": True, **usage}
    except (OSError, ValueError, RuntimeError):
        return {"available": False, "complete": False}


def runtime_snapshot(db: Session, settings: Settings, *, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    queue = _metric(db, lambda: {"jobs": _counts(db, BackgroundJob), "imports": _counts(db, ImportRecord)})
    def read_worker():
        row = db.get(WorkerRuntimeState, "primary")
        snapshot = worker_status(row, now=now, stale_after_seconds=settings.worker_heartbeat_stale_after_seconds,
            active_job_count=sum(queue.get("jobs", {}).get(key, 0) for key in ("processing", "cancelling")),
            active_import_count=queue.get("imports", {}).get("processing", 0))
        if not queue["available"]:
            snapshot["processing_task_count"] = None
        # A future timestamp cannot prove liveness after a server clock change.
        if row and row.heartbeat_at and _utc(row.heartbeat_at) > now:
            snapshot.update(status="unavailable", heartbeat_age_seconds=None, active_task_kind=None)
        if snapshot.get("active_task_kind") not in {"import", "job"}:
            snapshot["active_task_kind"] = None
        return snapshot
    worker = _metric(db, read_worker)
    storage = {name: _local_storage(root) for name, root in (
        ("imports", settings.import_storage_dir), ("exports", settings.export_storage_dir), ("offline", settings.offline_storage_dir),
    )}
    if settings.asset_storage_backend == "local":
        storage["assets"] = {"kind": "local", **_local_storage(settings.asset_storage_dir)}
    else:
        def logical_assets():
            count, size = db.query(func.count(AssetObject.id), func.sum(AssetObject.byte_size)).filter(AssetObject.status != "deleted").one()
            return {"file_count": int(count), "bytes": int(size or 0), "complete": True}
        storage["assets"] = {"kind": "object_records", **_metric(db, logical_assets)}
    backup = _metric(db, lambda: _backup(db, "BACKUP"))
    restore = _metric(db, lambda: _backup(db, "RESTORE"))
    return {"generated_at": now.isoformat(), "worker": worker, "queue": queue,
        "storage": storage, "backup": backup, "restore": restore,
        "mail": {"configured": bool(settings.smtp_host and settings.smtp_from_address)},
        "complete": all(metric["available"] for metric in (worker, queue, backup, restore))
                    and worker.get("status") not in {None, "unavailable"}
                    and all(metric.get("available") and metric.get("complete") for metric in storage.values())}


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
