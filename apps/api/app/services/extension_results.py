"""Receipts describe a committed Reader operation, not a requested destination."""
from uuid import UUID

from sqlalchemy import select

from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.import_record import ImportRecord


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
