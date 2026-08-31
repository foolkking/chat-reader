from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.models.import_record import ImportRecord
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services.artifact_lifecycle import scan_cleanup_candidates
from app.services.retry_policy import MAX_AUTOMATIC_ATTEMPTS
from app.services.task_retention import TERMINAL_IMPORT_STATUSES, TERMINAL_JOB_STATUSES, terminal_result_cutoff

ACTIVE_STATUSES = ("queued", "processing", "cancelling")
TIMING_SAMPLE_LIMIT = 500
TIMING_BUCKET_UPPER_BOUNDS_SECONDS = (1.0, 5.0, 15.0, 60.0, 300.0)
STORAGE_ENTRY_LIMIT = 100_000


def collect_diagnostics(db: Session, settings: Settings, *, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    job_rows = db.query(BackgroundJob.status, func.count(BackgroundJob.id)).group_by(BackgroundJob.status).all()
    import_rows = db.query(ImportRecord.status, func.count(ImportRecord.id)).group_by(ImportRecord.status).all()
    job_statuses = {str(status): int(count) for status, count in job_rows}
    import_statuses = {str(status): int(count) for status, count in import_rows}
    job_stale_cutoff = now - timedelta(seconds=settings.import_stale_after_seconds)
    stale_jobs = (
        db.query(func.count(BackgroundJob.id))
        .filter(
            BackgroundJob.status.in_(("processing", "cancelling")),
            or_(BackgroundJob.heartbeat_at.is_(None), BackgroundJob.heartbeat_at < job_stale_cutoff),
        )
        .scalar()
        or 0
    )
    stale_imports = (
        db.query(func.count(ImportRecord.id))
        .filter(
            ImportRecord.status == "processing",
            or_(ImportRecord.heartbeat_at.is_(None), ImportRecord.heartbeat_at < job_stale_cutoff),
        )
        .scalar()
        or 0
    )
    retry_exhausted_jobs = (
        db.query(func.count(BackgroundJob.id))
        .filter(BackgroundJob.status == "failed", BackgroundJob.attempt_count >= MAX_AUTOMATIC_ATTEMPTS)
        .scalar()
        or 0
    )
    retry_exhausted_imports = (
        db.query(func.count(ImportRecord.id))
        .filter(ImportRecord.status == "failed", ImportRecord.attempt_count >= MAX_AUTOMATIC_ATTEMPTS)
        .scalar()
        or 0
    )
    oldest_job = db.query(func.min(BackgroundJob.queued_at)).filter(BackgroundJob.status == "queued").scalar()
    oldest_import = db.query(func.min(ImportRecord.queued_at)).filter(ImportRecord.status == "queued").scalar()
    last_job_heartbeat = db.query(func.max(BackgroundJob.heartbeat_at)).scalar()
    last_import_heartbeat = db.query(func.max(ImportRecord.heartbeat_at)).scalar()
    worker_row = db.get(WorkerRuntimeState, "primary")
    active_job_count = int(job_statuses.get("processing", 0) + job_statuses.get("cancelling", 0))
    active_import_count = int(import_statuses.get("processing", 0))
    worker = worker_status(
        worker_row,
        now=now,
        stale_after_seconds=settings.worker_heartbeat_stale_after_seconds,
        active_job_count=active_job_count,
        active_import_count=active_import_count,
    )

    timing_rows = (
        db.query(BackgroundJob.queued_at, BackgroundJob.started_at, BackgroundJob.completed_at)
        .filter(BackgroundJob.completed_at.is_not(None))
        .order_by(BackgroundJob.completed_at.desc())
        .limit(TIMING_SAMPLE_LIMIT)
        .all()
    )
    job_timings = _timing_sample(timing_rows)
    terminal_cutoff = terminal_result_cutoff(settings.task_terminal_result_retention_seconds, now=now)
    terminal_job_count, oldest_terminal_job = (
        db.query(func.count(BackgroundJob.id), func.min(BackgroundJob.completed_at))
        .filter(
            BackgroundJob.status.in_(TERMINAL_JOB_STATUSES),
            BackgroundJob.completed_at.is_not(None),
            BackgroundJob.completed_at >= terminal_cutoff,
        )
        .one()
    )
    terminal_import_count, oldest_terminal_import = (
        db.query(func.count(ImportRecord.id), func.min(ImportRecord.completed_at))
        .filter(
            ImportRecord.status.in_(TERMINAL_IMPORT_STATUSES),
            ImportRecord.completed_at.is_not(None),
            ImportRecord.completed_at >= terminal_cutoff,
        )
        .one()
    )

    roots = {
        "offline": Path(settings.offline_storage_dir),
        "export": Path(settings.export_storage_dir),
    }
    cleanup = scan_cleanup_candidates(
        db,
        roots=roots,
        grace_seconds=settings.artifact_cleanup_grace_hours * 3600,
        max_files=STORAGE_ENTRY_LIMIT,
    )
    storage = {
        "imports": storage_usage(Path(settings.import_storage_dir)),
        "exports": storage_usage(Path(settings.export_storage_dir)),
        "offline": storage_usage(Path(settings.offline_storage_dir)),
        "assets": storage_usage(Path(settings.asset_storage_dir)),
    }
    return {
        "generated_at": now.isoformat(),
        "jobs": {
            "status_counts": job_statuses,
            "stale": int(stale_jobs),
            "retry_exhausted": int(retry_exhausted_jobs),
            "oldest_queue_age_seconds": _age_seconds(now, oldest_job),
            "attempts": _attempt_distribution(
                db.query(BackgroundJob.attempt_count, func.count(BackgroundJob.id))
                .group_by(BackgroundJob.attempt_count)
                .all()
            ),
            "recent_timing_sample": job_timings,
        },
        "imports": {
            "status_counts": import_statuses,
            "stale": int(stale_imports),
            "retry_exhausted": int(retry_exhausted_imports),
            "oldest_queue_age_seconds": _age_seconds(now, oldest_import),
            "attempts": _attempt_distribution(
                db.query(ImportRecord.attempt_count, func.count(ImportRecord.id))
                .group_by(ImportRecord.attempt_count)
                .all()
            ),
        },
        "artifacts": {
            "export_records": int(db.query(func.count(ExportArtifact.id)).scalar() or 0),
            "offline_records": int(db.query(func.count(OfflinePackageArtifact.id)).scalar() or 0),
            "cleanup": cleanup.summary,
            "cleanup_scan_complete": cleanup.complete,
            "historical_lifecycle_counts": "structured_logs_only",
        },
        "task_results": {
            "retention_seconds": settings.task_terminal_result_retention_seconds,
            "visible_job_count": int(terminal_job_count or 0),
            "visible_import_count": int(terminal_import_count or 0),
            "visible_total_count": int(terminal_job_count or 0) + int(terminal_import_count or 0),
            "oldest_visible_age_seconds": _age_seconds(
                now,
                min(filter(None, (oldest_terminal_job, oldest_terminal_import)), default=None),
            ),
        },
        "storage": storage,
        "system": {
            "worker_state": worker["status"],
            "worker_heartbeat_at": worker["heartbeat_at"],
            "worker_heartbeat_age_seconds": worker["heartbeat_age_seconds"],
            "worker_processing_task_count": worker["processing_task_count"],
            "worker_active_task_kind": worker["active_task_kind"],
            "last_task_heartbeat_age_seconds": _age_seconds(
                now,
                max(filter(None, (last_job_heartbeat, last_import_heartbeat)), default=None),
            ),
            "scanner": settings.attachment_scanner,
        },
    }


def worker_status(
    row: WorkerRuntimeState | None,
    *,
    now: datetime,
    stale_after_seconds: int,
    active_job_count: int,
    active_import_count: int,
) -> dict[str, Any]:
    processing_task_count = active_job_count + active_import_count
    if row is None:
        return {
            "status": "unavailable",
            "heartbeat_at": None,
            "heartbeat_age_seconds": None,
            "processing_task_count": processing_task_count,
            "active_task_kind": None,
        }
    heartbeat_age = _age_seconds(now, row.heartbeat_at)
    if heartbeat_age is None or heartbeat_age >= stale_after_seconds:
        status = "stale"
        active_task_kind = None
    elif row.state == "busy":
        status = "alive_busy"
        active_task_kind = row.task_kind
    else:
        status = "alive_idle"
        active_task_kind = None
    return {
        "status": status,
        "heartbeat_at": _utc(row.heartbeat_at).isoformat(),
        "heartbeat_age_seconds": heartbeat_age,
        "processing_task_count": processing_task_count,
        "active_task_kind": active_task_kind,
    }


def storage_usage(root: Path, *, max_entries: int = STORAGE_ENTRY_LIMIT) -> dict[str, int | bool]:
    root = root.resolve()
    if not root.exists():
        return {"file_count": 0, "bytes": 0, "complete": True}
    count = 0
    byte_size = 0
    stack = [root]
    complete = True
    while stack:
        directory = stack.pop()
        try:
            entries = os.scandir(directory)
        except OSError:
            complete = False
            continue
        with entries:
            for entry in entries:
                if count >= max_entries:
                    complete = False
                    stack.clear()
                    break
                try:
                    if entry.is_symlink():
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        count += 1
                        byte_size += entry.stat(follow_symlinks=False).st_size
                except OSError:
                    complete = False
    return {"file_count": count, "bytes": byte_size, "complete": complete}


def _attempt_distribution(rows: Iterable[tuple[int, int]]) -> dict[str, int]:
    distribution: dict[str, int] = {}
    for attempt, count in rows:
        key = "3+" if int(attempt) >= 3 else str(int(attempt))
        distribution[key] = distribution.get(key, 0) + int(count)
    return dict(sorted(distribution.items()))


def _timing_sample(rows: Iterable[tuple[datetime, datetime | None, datetime | None]]) -> dict[str, Any]:
    queue_wait: list[float] = []
    execution: list[float] = []
    for queued_at, started_at, completed_at in rows:
        if started_at is not None:
            queue_wait.append(max(0.0, (_utc(started_at) - _utc(queued_at)).total_seconds()))
        if started_at is not None and completed_at is not None:
            execution.append(max(0.0, (_utc(completed_at) - _utc(started_at)).total_seconds()))
    if not queue_wait and not execution:
        return {"available": False, "sample_size": 0}
    return {
        "available": True,
        "sample_size": max(len(queue_wait), len(execution)),
        "queue_wait_average_seconds": round(sum(queue_wait) / len(queue_wait), 3) if queue_wait else None,
        "execution_average_seconds": round(sum(execution) / len(execution), 3) if execution else None,
        "queue_wait_percentiles_seconds": _timing_percentiles(queue_wait),
        "execution_percentiles_seconds": _timing_percentiles(execution),
        "queue_wait_histogram": _duration_histogram(queue_wait),
        "execution_histogram": _duration_histogram(execution),
    }


def _timing_percentiles(values: list[float]) -> dict[str, float | None]:
    """Return stable nearest-rank percentiles for the bounded timing sample."""
    if not values:
        return {"p50": None, "p95": None, "p99": None}
    ordered = sorted(values)
    result: dict[str, float | None] = {}
    for name, fraction in (("p50", 0.50), ("p95", 0.95), ("p99", 0.99)):
        index = min(len(ordered) - 1, max(0, int(len(ordered) * fraction + 0.999999) - 1))
        result[name] = round(ordered[index], 3)
    return result


def _duration_histogram(values: list[float]) -> dict[str, Any]:
    counts = [0] * (len(TIMING_BUCKET_UPPER_BOUNDS_SECONDS) + 1)
    for value in values:
        bucket_index = len(TIMING_BUCKET_UPPER_BOUNDS_SECONDS)
        for index, upper_bound in enumerate(TIMING_BUCKET_UPPER_BOUNDS_SECONDS):
            if value <= upper_bound:
                bucket_index = index
                break
        counts[bucket_index] += 1

    buckets: list[dict[str, float | int | None]] = []
    lower_bound: float | None = None
    for index, upper_bound in enumerate(TIMING_BUCKET_UPPER_BOUNDS_SECONDS):
        buckets.append({
            "lower_bound_seconds_exclusive": lower_bound,
            "upper_bound_seconds_inclusive": upper_bound,
            "count": counts[index],
        })
        lower_bound = upper_bound
    buckets.append({
        "lower_bound_seconds_exclusive": lower_bound,
        "upper_bound_seconds_inclusive": None,
        "count": counts[-1],
    })
    return {"sample_size": len(values), "buckets": buckets}


def _age_seconds(now: datetime, value: datetime | None) -> float | None:
    if value is None:
        return None
    return round(max(0.0, (_utc(now) - _utc(value)).total_seconds()), 3)


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
