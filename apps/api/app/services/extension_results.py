"""Receipts describe a committed Reader operation, not a requested destination."""
from datetime import datetime
from uuid import UUID

from sqlalchemy import select

from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.import_record import ImportRecord
from app.services.task_errors import adaptive_import_failure, public_import_failure


def public_append_status(record):
    """Device-visible telemetry, not the owner's selection, target or review."""
    from app.services.adaptive_import.resource_wait import public_wait

    summary = record.analysis_summary if isinstance(record.analysis_summary, dict) else {}
    phases = {"receiving", "analyzing", "grouping", "profile_resolution", "input_recovery", "ready", "queued",
              "waiting_resources", "resource_paused", "parsing", "persisting", "paused", "canceled",
              "analysis_failed", "failed", "completed"}
    phase = record.phase if isinstance(record.phase, str) and record.phase in phases else None
    progress = record.progress if type(record.progress) is int and 0 <= record.progress <= 100 else None
    wait = result = None
    raw = summary.get("resource_wait")
    if (phase == "waiting_resources" and record.status in {"queued", "analyzing"} and isinstance(raw, dict)
            and isinstance(raw.get("reason"), str) and type(raw.get("remaining_seconds")) in (int, float)):
        wait = public_wait(summary)
        if wait is not None:
            stamp = wait["next_retry_at"]
            try:
                parsed = datetime.fromisoformat(stamp) if isinstance(stamp, str) and len(stamp) <= 40 else None
            except ValueError:
                parsed = None
            wait["next_retry_at"] = parsed.isoformat() if parsed and parsed.utcoffset() is not None else None
    raw = summary.get("append_result")
    if (record.status == "committed" and isinstance(raw, dict) and type(raw.get("partial")) is bool
            and all(type(raw.get(key)) is int and 0 <= raw[key] <= 2**53 - 1 for key in ("added", "skipped"))):
        result = {key: raw[key] for key in ("added", "skipped", "partial")}
    return {"progress": progress, "phase": phase, "wait": wait, "result": result}


def public_failure(record):
    """Device diagnostics are finite metadata, never exception text or source details.

    Recovery describes the next user action, not permission to enqueue work. The
    existing retry endpoint still checks ownership, retained source and task locks.
    A package integrity failure cannot be repaired by replaying the same bytes.
    """
    if record.status != "failed":
        return None
    summary = record.analysis_summary if isinstance(record.analysis_summary, dict) else {}
    stage = "commit" if record.phase == "failed" else "analysis"
    failure = public_import_failure(summary.get("failure"), error_message=record.error_message, stage=stage)
    if failure is None:
        failure = adaptive_import_failure("TASK_FAILED", stage, False)
    code = failure["code"]
    recovery = "system_support"
    if code == "IMPORT_STORAGE_FULL":
        recovery = "free_storage"
    elif code in {
        "UPLOAD_MEMORY_PRESSURE", "SMALL_IMPORT_BUDGET_EXCEEDED",
        "UPLOAD_QUEUE_FULL", "UPLOAD_QUEUE_TIMEOUT", "IMPORT_RESOURCE_WAIT_EXPIRED",
    }:
        recovery = "review_in_reader" if summary.get("append_only") else "retry_existing"
    elif code in {
        "APPEND_REVIEW_CHANGED",
        "NO_MESSAGE_STRUCTURE", "DOCUMENT_NOT_TRANSCRIPT", "IMPORT_PLAN_INVALID",
        "SOURCE_MISSING", "MARKDOWN_EMPTY", "MARKDOWN_ENCODING_INVALID",
        "MARKDOWN_FENCE_UNCLOSED", "ZIP_MARKDOWN_REQUIRED",
    }:
        recovery = "review_in_reader"
    return {"code": code, "stage": failure["stage"], "recovery": recovery}


def project_at(db, owner_id, cid):
    row = db.execute(select(Project.id, Project.name, Project.is_default, Project.is_archived)
                     .join(ProjectConversation, ProjectConversation.project_id == Project.id)
                     .where(ProjectConversation.conversation_id == cid, Project.owner_user_id == owner_id)).first()
    if row and row.is_archived:
        return {"state": "unavailable"}
    if not row or row.is_default:
        return {"state": "unclassified"}
    return {"state": "project", "id": str(row.id), "name": row.name}


def write_outcome(db, record, target, action, added, partial):
    completeness = "partial" if partial else "complete"
    if not partial and action in ("unchanged", "appended"):
        # An append does not repair an earlier missing resource. A legacy or pruned
        # receipt cannot establish the completeness of the retained prefix either.
        prior = db.scalar(select(ImportRecord.analysis_summary["extension_result"]["completeness"].as_string())
                          .where(ImportRecord.conversation_id == target.id, ImportRecord.owner_user_id == record.owner_user_id,
                                 ImportRecord.status == "committed", ImportRecord.id != record.id)
                          .order_by(ImportRecord.committed_at.desc(), ImportRecord.id.desc()).limit(1))
        completeness = prior if prior in ("partial", "complete") else "unknown"
    record.analysis_summary = {**record.analysis_summary, "extension_outcome": action,
        "extension_result": {"version": 1, "action": action, "added_messages": added,
                             "completeness": completeness}}


def snapshot_project(db, record, cid):
    # Called after attaching the real project, in the same transaction as the message writes.
    project = project_at(db, record.owner_user_id, cid)
    record.analysis_summary = {**record.analysis_summary, "extension_result": {
        **record.analysis_summary["extension_result"], "saved_project": project}}


def public_result(db, record, saved):
    result = (record.analysis_summary or {}).get("extension_result")
    if not saved or saved.deleted_at or not result or result.get("version") != 1:
        return None
    at_save = result.get("saved_project") or {"state": "unavailable"}
    if at_save.get("state") == "project":
        visible = db.scalar(select(Project.id).where(Project.id == UUID(at_save["id"]),
                            Project.owner_user_id == record.owner_user_id, Project.is_archived.is_(False)))
        if not visible:
            at_save = {"state": "unavailable"}
    return {**result, "saved_project": at_save, "current_project": project_at(db, record.owner_user_id, saved.id)}
