"""Bounded account-owned collection projection; never reads message bodies."""
import uuid

from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.reading_position import ReadingPosition
from app.models.user_feature_entry import UserFeatureEntry
from app.services.user_feature_entries import entry_read


def reading_list_summary(db, *, subject_key, ownership_scope, state, q, project_id, sort, limit, offset):
    entries = db.query(UserFeatureEntry).filter(
        UserFeatureEntry.subject_key == subject_key,
        UserFeatureEntry.collection == "reading-list",
    ).order_by(UserFeatureEntry.id).limit(500).all()
    ids = set()
    for entry in entries:
        try:
            ids.add(uuid.UUID(str(entry.value.get("conversation_id"))))
        except (ValueError, TypeError, AttributeError):
            continue
    conversations = {
        row.id: row for row in db.query(Conversation.id, Conversation.title, Conversation.display_title)
        .filter(Conversation.id.in_(ids), Conversation.deleted_at.is_(None), ownership_scope.predicate(Conversation)).all()
    } if ids else {}
    projects = {}
    if conversations:
        for cid, pid, name in db.query(ProjectConversation.conversation_id, Project.id, Project.name).join(
            Project, Project.id == ProjectConversation.project_id,
        ).filter(ProjectConversation.conversation_id.in_(list(conversations)), ownership_scope.predicate(Project),
                 Project.is_default.is_(False)).order_by(Project.name, Project.id):
            projects.setdefault(cid, []).append({"id": str(pid), "name": name})
    positions = {
        row.conversation_id: row for row in db.query(
            ReadingPosition.conversation_id, ReadingPosition.message_id, ReadingPosition.updated_at,
        ).filter(ReadingPosition.conversation_id.in_(list(conversations)), ReadingPosition.subject_key == subject_key)
    } if conversations else {}
    items = []
    query = q.strip().casefold()
    for entry in entries:
        try:
            cid = uuid.UUID(str(entry.value.get("conversation_id")))
        except (ValueError, TypeError, AttributeError):
            continue
        conversation = conversations.get(cid)
        title = (conversation.display_title or conversation.title) if conversation else None
        member_projects = projects.get(cid, [])
        if query and (not title or query not in title.casefold()):
            continue
        if project_id and not any(project["id"] == str(project_id) for project in member_projects):
            continue
        position = positions.get(cid)
        items.append({
            "entry": entry_read(entry).model_dump(mode="json"),
            "title": title, "projects": member_projects,
            "available": conversation is not None,
            "resume_available": position is not None and position.message_id is not None,
            "last_read_at": position.updated_at.isoformat() if position else None,
        })
    counts = {"unread": 0, "read": 0, "all": len(items)}
    for item in items:
        value = item["entry"]["value"].get("state", "unread")
        counts[value if value in ("unread", "read") else "unread"] += 1
    if state != "all":
        items = [item for item in items if item["entry"]["value"].get("state", "unread") == state]
    items.sort(key=lambda item: (
        (item["last_read_at"] or "") if sort == "last_read" else item["entry"]["created_at"],
        item["entry"]["id"],
    ), reverse=sort != "added_asc")
    total = len(items)
    return {"items": items[offset:offset + limit], "counts": counts, "total": total,
            "limit": limit, "offset": offset, "has_more": offset + limit < total}
