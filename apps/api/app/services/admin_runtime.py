"""Root-only bounded snapshots; no proxying internal operator diagnostics."""

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.administration import SystemBackupRecord
from app.models.attachment import AssetObject, AttachmentUploadItem
from app.models.task_execution_control import TaskExecutionControl
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.worker_runtime_state import WorkerRuntimeState
from app.models.export_artifact import ExportArtifact
from app.services.diagnostics import storage_usage, worker_status

STATUSES = ("queued", "processing", "cancelling", "committed", "failed", "cancelled")
IMPORT_STATUSES = (*STATUSES, "paused", "previewed", "analyzing")


def _metric(db: Session, read):
    try:
        with db.begin_nested():
            if db.get_bind().dialect.name == "postgresql":
                db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
                db.execute(text("SET LOCAL lock_timeout = '250ms'"))
            return {"available": True, **read()}
    except Exception:
        return {"available": False}


def _counts(db: Session, model) -> dict[str, int]:
    rows = db.query(model.status, func.count(model.id)).group_by(model.status).all()
    states = IMPORT_STATUSES if model is ImportRecord else STATUSES
    counts = {state: 0 for state in (*states, "other")}
    for state, count in rows:
        state = "cancelled" if state == "canceled" else state
        counts[state if state in counts else "other"] += int(count)
    return counts


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


def _export_cleanup(db: Session, now: datetime) -> dict:
    from app.services.export_retention import cleanup_job_clause
    rows = db.query(ExportArtifact.lifecycle_state, func.count(ExportArtifact.id), func.sum(ExportArtifact.byte_size)).join(
        BackgroundJob, BackgroundJob.id == ExportArtifact.job_id,
    ).filter(cleanup_job_clause(), ExportArtifact.lifecycle_state != "reclaimed",
             (ExportArtifact.expires_at <= now) | ExportArtifact.release_requested_at.is_not(None),
    ).group_by(ExportArtifact.lifecycle_state).all()
    return {"pending_count": sum(int(count) for _, count, _ in rows),
            "pending_bytes": sum(int(size or 0) for _, _, size in rows),
            "failed_count": sum(int(count) for state, count, _ in rows if state == "retry")}


def _source_cleanup(db: Session) -> dict:
    from app.services.adaptive_import.source_cleanup import KEY, UNFINISHED
    # PostgreSQL must see the same bound JSON path in SELECT and GROUP BY.
    state = ImportRecord.analysis_summary[KEY]["state"].as_string()
    rows = db.query(state, func.count(ImportRecord.id)).filter(
        ImportRecord.status.in_(("canceled", "cancelled")), ImportRecord.session_state == "CANCELED",
        ImportRecord.committed_at.is_(None), ImportRecord.conversation_id.is_(None),
        ImportRecord.analysis_summary[KEY]["version"].as_integer() == 1,
        state.in_(UNFINISHED),
    ).group_by(state).all()
    return {"pending_count": sum(int(count) for _, count in rows),
            "blocked_count": sum(int(count) for state, count in rows if state == "blocked")}


def _upload_cleanup(db: Session) -> dict:
    rows = db.query(AttachmentUploadItem.validation_status, func.count(AttachmentUploadItem.id)).filter(
        AttachmentUploadItem.temporary_storage_key.is_not(None),
    ).group_by(AttachmentUploadItem.validation_status).all()
    return {
        "pending_count": sum(int(count) for state, count in rows if state in {"committed", "abandoned"}),
        "protected_count": sum(int(count) for state, count in rows if state not in {"committed", "abandoned"}),
        "failed_count": db.query(func.count(AttachmentUploadItem.id)).filter_by(error_code="cleanup_pending").scalar(),
    }


def _execution(db: Session, now: datetime) -> dict | None:
    control = db.get(TaskExecutionControl, "primary")
    if control is None or control.finished_at:
        return None
    model = ImportRecord if control.task_kind == "import" else BackgroundJob
    task = db.get(model, control.task_id)
    # A late control row must not turn canonical completion back into failure.
    if task is None or task.status not in {"processing", "cancelling"}:
        return {"state": "reconciling"}
    age = max(0, int((now - _utc(control.progress_at)).total_seconds()))
    return {"state": "stopping" if control.stop_requested_at else "stalled" if age >= 300 else "running",
            "progress_age_seconds": age}


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
        snapshot["execution"] = _execution(db, now)
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
    export_cleanup = _metric(db, lambda: _export_cleanup(db, now))
    source_cleanup = _metric(db, lambda: _source_cleanup(db))
    upload_cleanup = _metric(db, lambda: _upload_cleanup(db))
    return {"generated_at": now.isoformat(), "worker": worker, "queue": queue,
        "storage": storage, "backup": backup, "restore": restore, "export_cleanup": export_cleanup,
        "source_cleanup": source_cleanup, "upload_cleanup": upload_cleanup,
        "mail": {"configured": bool(settings.smtp_host and settings.smtp_from_address)},
        "complete": all(metric["available"] for metric in (worker, queue, backup, restore, export_cleanup, source_cleanup, upload_cleanup))
                    and worker.get("status") not in {None, "unavailable"}
                    and all(metric.get("available") and metric.get("complete") for metric in storage.values())}


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
