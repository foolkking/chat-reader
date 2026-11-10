"""Durable, bounded resource backoff. Never sleeps with a transaction or slot."""
from datetime import datetime, timedelta, timezone
from sqlalchemy import or_

from app.services.task_errors import adaptive_import_failure, import_failure_from_exception


def eligible(model, now=None):
    return or_(model.next_run_at.is_(None), model.next_run_at <= (now or datetime.now(timezone.utc)))


def finish_wait(row, field):
    data = dict(getattr(row, field) or {})
    waiting = dict(data.get("resource_wait") or {})
    since = waiting.pop("waiting_since", None)
    if since:
        duration = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(since)).total_seconds())
        waiting["waited_seconds"] = min(1800, waiting.get("waited_seconds", 0) + duration)
    if waiting:
        data["resource_wait"] = waiting
        setattr(row, field, data)
    row.next_run_at = None


def defer_resource(row, record, exc, *, stage):
    failure = import_failure_from_exception(exc, stage=stage)
    if (record.source_profile != "adaptive_json_markdown" or failure["code"] not in {
            "UPLOAD_MEMORY_PRESSURE", "UPLOAD_QUEUE_FULL", "UPLOAD_QUEUE_TIMEOUT"}):
        return False
    now = datetime.now(timezone.utc)
    field = "analysis_summary" if row is record else "result"
    data = dict(getattr(row, field) or {})
    wait = dict(data.get("resource_wait") or {})
    attempt = int(wait.get("checks", 0)) + 1
    remaining = max(0, 1800 - float(wait.get("waited_seconds", 0)))
    delay = min(15 if attempt == 1 else 30 if attempt == 2 else 60, remaining)
    wait.update(reason=failure["code"], checks=attempt, remaining_seconds=remaining)
    exhausted = remaining <= 0
    terminal_failure = adaptive_import_failure("IMPORT_RESOURCE_WAIT_EXPIRED", stage, True) if exhausted else None
    if not exhausted:
        wait["waiting_since"] = now.isoformat()
    row.next_run_at = None if exhausted else now + timedelta(seconds=delay)
    wait["next_retry_at"] = row.next_run_at.isoformat() if row.next_run_at else None
    data.update(resource_wait=wait, failure=terminal_failure)
    setattr(row, field, data)
    row.status = "failed" if exhausted else "queued"
    row.phase = "resource_paused" if exhausted else "waiting_resources"
    row.attempt_count = max(0, row.attempt_count - 1)
    row.heartbeat_at = now
    row.completed_at = now if exhausted else None
    row.started_at = None
    row.error_message = "IMPORT_RESOURCE_WAIT_EXPIRED" if exhausted else None
    if row is record:
        record.session_state = "FAILED" if exhausted else "READY"
    else:
        record.status = "failed" if exhausted else "analyzing"
        record.session_state = "FAILED" if exhausted else "ANALYZING"
        record.phase = "analysis_failed" if exhausted else "waiting_resources"
        record.error_message = row.error_message
        record.analysis_summary = {**(record.analysis_summary or {}), "resource_wait": wait,
                                   "failure": terminal_failure}
    return True


def public_wait(data):
    raw = (data or {}).get("resource_wait")
    if not isinstance(raw, dict):
        return None
    if raw.get("reason") not in {"UPLOAD_MEMORY_PRESSURE", "UPLOAD_QUEUE_FULL", "UPLOAD_QUEUE_TIMEOUT"}:
        return None
    remaining = raw.get("remaining_seconds")
    if not isinstance(remaining, (float, int)) or not 0 <= remaining <= 1800:
        return None
    return {key: raw.get(key) for key in ("reason", "next_retry_at", "remaining_seconds")}
