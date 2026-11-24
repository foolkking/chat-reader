"""Resolve project membership on the server. A changed preview never queues a partial job."""
import hashlib
import json
import uuid

from sqlalchemy import func, select

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.services.exporting.export_service import ExportError
from app.services.ownership import get_owned
from app.services.projects.project_service import project_member_query


class ProjectExportChanged(ExportError):
    def __init__(self, review):
        super().__init__("BATCH_EXPORT_PROJECT_CHANGED", 409)
        self.review = review


def _stamp(project, origin, selected, count, active):
    identity = [str(project.id), project.name, project.is_archived, origin.mode, origin.sort, origin.direction,
                list(map(str, selected)) if selected is not None else None, count, active]
    return hashlib.sha256(json.dumps(identity, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


def project_review(db, scope, origin, selected=None):
    project = get_owned(db, Project, origin.project_id, scope)
    if project is None:
        raise ExportError("BATCH_EXPORT_SOURCE_UNAVAILABLE", 404)
    query = project_member_query(db, project.id, origin.sort, origin.direction, scope)
    limit = min(5000, get_settings().bundle_max_entries)
    if selected is None:
        # Exact count and ordered IDs from ONE query/snapshot, no message bodies.
        rows = query.with_entities(ProjectConversation.conversation_id, func.count().over()).limit(limit + 1).all()
        count = rows[0][1] if rows else 0
        active = [str(r[0]) for r in rows] if count <= limit else []
    else:
        matches = set(r[0] for r in query.order_by(None).with_entities(ProjectConversation.conversation_id)
                      .filter(ProjectConversation.conversation_id.in_(selected)))
        active = [str(i) for i in selected if i in matches]
        count = len(active)
    result = {"name": project.name, "archived": project.is_archived, "active_ids": active,
              "count": count, "limit": limit, "reviewed": _stamp(project, origin, selected, count, active)}
    if selected is not None and 0 < count < len(selected):
        # An archived project also needs an explicit decision. Bind the second
        # button to exactly the remaining list as seen in THIS same snapshot.
        result["remaining_reviewed"] = _stamp(project, origin, active, count, active)
    return result


def check_project_scope(db, scope, origin, ids, *, can_export_original=True):
    whole = origin.mode == "whole"
    review = project_review(db, scope, origin, None if whole else ids)
    all_active = review["active_ids"] == list(map(str, ids))
    # Selected: the first click is enough if nothing left. A changed selection
    # requires the user's explicit decision on this exact still-owned original list.
    if whole:
        valid = all_active and origin.reviewed == review["reviewed"]
    else:
        valid = origin.reviewed == review["reviewed"] if origin.reviewed else all_active and not review["archived"]
    if not valid or not can_export_original:
        if not whole:
            # Missing, deleted and no-longer-owned are deliberately indistinguishable.
            # No stamp, including a previously issued one, authorizes missing sources.
            review["can_export_original"] = can_export_original
        original = list(map(str, ids))
        if review["count"] <= review["limit"]:
            current = review["active_ids"]
            before, after = set(original), set(current)
            added = [i for i in current if i not in before]
            removed = [i for i in original if i not in after]
            # Read a few *currently accessible* titles only on a conflict. Never
            # disclose a deleted/foreign title, even if its ID was in the request.
            sample = [uuid.UUID(i) for i in added[:3] + removed[:3]]
            titles = {str(i): title[:120] for i, title in db.execute(select(
                Conversation.id, Conversation.display_title).where(Conversation.id.in_(sample),
                scope.predicate(Conversation), Conversation.deleted_at.is_(None))) if title} if sample else {}
            def changes(items):
                return {"count": len(items), "titles": [titles[i] for i in items[:3] if i in titles]}
            review["changes"] = {"added": changes(added), "removed": changes(removed),
                                 "order_changed": not added and not removed and original != current}
        raise ProjectExportChanged(review)
    return review["name"]
