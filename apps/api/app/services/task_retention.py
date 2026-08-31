from __future__ import annotations

from datetime import datetime, timedelta, timezone

TERMINAL_JOB_STATUSES = ("committed", "failed", "cancelled")
TERMINAL_IMPORT_STATUSES = ("committed", "failed")


def terminal_result_cutoff(retention_seconds: int, *, now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    return current - timedelta(seconds=retention_seconds)
