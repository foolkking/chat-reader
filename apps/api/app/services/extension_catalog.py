"""Bounded, metadata-only conversation projection for the native side panel."""
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import String, and_, cast, func, select, or_

from app.models.attachment import Attachment
from app.models.conversation import Conversation as C
from app.models.project import Project
from app.models.project_conversation import ProjectConversation as PC
from app.models.recent_item import RecentItem
from app.models.search_document import SearchDocument
from app.services.ownership import get_owned
from app.services.search.search_service import SearchServiceError, _escape_like_pattern, query_terms, search


def catalog(db, owner, q, project_id, scope, view, offset, limit):
    if project_id is not None:
        project = get_owned(db, Project, project_id, owner)
        if not project or project.is_archived:
            raise HTTPException(404)
    pin = PC.is_pinned if project_id else C.is_global_pinned
    base = (select(C.id, C.display_title, C.title, C.updated_at, C.imported_at, RecentItem.last_opened_at,
                   Project.id.label("pid"), Project.name.label("project_name"), Project.is_default,
                   Project.is_archived, pin.label("pinned"))
            .outerjoin(PC, PC.conversation_id == C.id)
            .outerjoin(Project, and_(Project.id == PC.project_id, owner.predicate(Project)))
            .outerjoin(RecentItem, RecentItem.conversation_id == C.id)
            .where(owner.predicate(C), C.status == "active", C.deleted_at.is_(None)))
    if project_id:
        base = base.where(Project.id == project_id)
    if scope == "unclassified":
        base = base.where(or_(PC.id.is_(None), Project.is_default.is_(True)))
    if view == "pinned":
        base = base.where(pin.is_(True))
    hits = {}
    listing = view
    if q.strip():
        try:
            page = search(db, q, limit=limit, offset=offset, project_id=project_id, grouped=True, terms_mode=True,
                          unclassified_only=scope == "unclassified", pinned_only=view == "pinned", ownership_scope=owner)
        except SearchServiceError as exc:
            raise HTTPException(400, "Search unavailable.") from exc
        hits = {r.conversation_id: r for r in page.items}
        by_id = {row.id: row for row in db.execute(base.where(C.id.in_(hits.keys())))}
        rows = [by_id[cid] for cid in hits if cid in by_id]
        listing, more = "search", page.has_more
    else:
        # Only fall back if there are NO opened conversations in this scope, not at the end of page 1.
        if view == "recent":
            opened = base.where(RecentItem.last_opened_at.is_not(None))
            if db.scalar(opened.with_only_columns(C.id).limit(1)) is not None:
                base = opened.order_by(RecentItem.last_opened_at.desc())
            else:
                listing = "updated"
        if listing != "recent":
            if listing == "library":  # original v1 clients: pinned first, then most recently updated
                base = base.order_by(pin.desc())
            base = base.order_by(func.coalesce(C.updated_at, C.imported_at).desc())
        batch = db.execute(base.order_by(C.id).offset(offset).limit(limit + 1)).all()
        rows, more = batch[:limit], len(batch) > limit
    ids = [r.id for r in rows]
    visible = (Attachment.conversation_id.in_(ids), Attachment.deleted_at.is_(None), Attachment.status != "detached")
    counts = dict(db.execute(select(Attachment.conversation_id, func.count(Attachment.id))
                             .where(*visible).group_by(Attachment.conversation_id)).all()) if ids else {}
    # Filename references also appear in message Markdown. The representative might
    # legitimately be a message; preserve its rank and identify real attachment hits
    # separately, only for this authorized page. Match the existing terms-mode index.
    attachment_hits = {}
    if hits and ids:
        aid = SearchDocument.metadata_["attachment_id"].as_string()
        attachment_hits = {cid: (n, UUID(one) if n == 1 else None) for cid,n,one in db.execute(
            select(SearchDocument.conversation_id, func.count(func.distinct(aid)), func.min(aid))
            .join(Attachment, and_(Attachment.conversation_id == SearchDocument.conversation_id,
                                   func.replace(cast(Attachment.id, String), "-", "") == func.replace(aid, "-", "")))
            .where(*visible, SearchDocument.document_type == "attachment",
                   *(SearchDocument.search_text.ilike(f"%{_escape_like_pattern(term.lower())}%", escape="\\")
                     for term in query_terms(q.strip())))
            .group_by(SearchDocument.conversation_id))}
    items = []
    for r in rows:
        hit = hits.get(r.id)
        pid = r.pid if not r.is_archived and not r.is_default else None
        items.append({"id": r.id, "title": r.display_title or r.title, "project_id": pid,
                      "project_name": r.project_name if pid else None, "project_unavailable": bool(r.is_archived),
                      "pinned": bool(r.pinned), "attachment_count": counts.get(r.id, 0),
                      "date_kind": "opened" if listing == "recent" else "updated" if r.updated_at else "imported",
                      "date": r.last_opened_at if listing == "recent" else r.updated_at or r.imported_at,
                      "match_kind": hit.document_type if hit else None,
                      "attachment_match": r.id in attachment_hits,
                      "match_attachment_id": attachment_hits.get(r.id, (0, None))[1]})
    return {"items": items, "has_more": more, "listing": listing}
