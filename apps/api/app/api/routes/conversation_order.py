"""Scope-fenced anchor placement; clients never replace a partial loaded list."""
import hashlib
import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.recent_item import RecentItem
from app.schemas.preferences import ScopedSort
from app.services.ownership import get_owned, ownership_scope_from_request, subject_key_from_request
from app.services.preferences import get_or_create_preferences
from app.services.navigation_order_lock import lock_navigation_order

router = APIRouter(prefix="/api/conversation-order", tags=["conversations"])
GAP = 1024


class OrderChange(BaseModel):
    scope: Literal["all", "unclassified", "project"]
    project_id: uuid.UUID | None = None
    expected_version: str = Field(min_length=64, max_length=64)
    conversation_id: uuid.UUID | None = None
    before_id: uuid.UUID | None = None
    after_id: uuid.UUID | None = None
    initialize_from: ScopedSort | None = None
    rebuild: bool = False


def snapshot(db, request, scope, project_id, *, lock=False):
    owner = ownership_scope_from_request(request)
    # A preference sync may hold the first fence before reaching canonical rows.
    # Both reads and writes must fail promptly instead of waiting behind it.
    preference = get_or_create_preferences(db, subject_key_from_request(request), nowait=True)
    if lock:
        # Never wait on a writer while holding its preference fence. An import/
        # restore can already hold canonical rows or the navigation fence.
        lock_navigation_order(db.connection(), owner.owner_user_id, nowait=True)
    if scope == "project" and (project_id is None or get_owned(db, Project, project_id, owner) is None):
        raise HTTPException(404, "Project not found.")
    if scope != "project" and project_id is not None:
        raise HTTPException(422, "Project is outside this scope.")
    query = db.query(Conversation).filter(owner.predicate(Conversation), Conversation.deleted_at.is_(None),
        Conversation.status.in_(("active", "archived")) if scope == "all" else Conversation.status == "active")
    if scope == "project":
        query = query.join(ProjectConversation).filter(ProjectConversation.project_id == project_id)
    elif scope == "unclassified":
        query = query.filter(~db.query(ProjectConversation.id).join(Project).filter(
            ProjectConversation.conversation_id == Conversation.id, Project.is_default.is_(False)).exists())
    # Lock only canonical rows, not nullable outer-join sides on PostgreSQL.
    if lock:
        try:
            query.with_entities(Conversation.id).order_by(Conversation.id).with_for_update(of=Conversation, nowait=True).all()
        except OperationalError as exc:
            if getattr(exc.orig, "sqlstate", None) != "55P03":
                raise
            db.rollback()
            raise HTTPException(409, "Conversation is changing. Refresh before reordering.") from exc
    relation = ProjectConversation
    if scope == "project":
        rank, pin = relation.sort_order, relation.is_pinned
    else:
        rank = Conversation.unclassified_sort_order if scope == "unclassified" else Conversation.manual_sort_order
        pin = Conversation.is_global_pinned
    rows = query.outerjoin(RecentItem, RecentItem.conversation_id == Conversation.id).with_entities(
        Conversation.id, rank.label("rank"), pin.label("pin"), Conversation.imported_at,
        Conversation.display_title, Conversation.sort_time, Conversation.updated_at,
        Conversation.created_at, Conversation.message_count, RecentItem.last_opened_at,
    ).order_by(rank.asc(), Conversation.id.asc()).all()
    key = f"_manual:{scope}:{project_id or ''}"
    revision = (preference.field_revisions or {}).get(key, 0)
    digest = hashlib.sha256(json.dumps([key, revision, [tuple(str(value) for value in row) for row in rows]]).encode()).hexdigest()
    return query, rows, rank, pin, preference, key, digest


@router.get("")
def read_order(request: Request, scope: Literal["all", "unclassified", "project"] = "all",
               project_id: uuid.UUID | None = None, db: Session = Depends(get_db)):
    _, rows, _, _, preference, key, digest = snapshot(db, request, scope, project_id)
    db.commit()
    return {"version": digest, "count": len(rows), "initialized": bool((preference.field_revisions or {}).get(key))}


@router.put("")
def change_order(payload: OrderChange, request: Request, db: Session = Depends(get_db)):
    query, rows, rank, pin, preference, key, digest = snapshot(db, request, payload.scope, payload.project_id, lock=True)
    if digest != payload.expected_version:
        raise HTTPException(409, "Ordering changed. Refresh the scope before moving an item.")
    ranks = {row.id: row.rank for row in rows}
    pins = {row.id: row.pin for row in rows}
    original_ranks = dict(ranks)
    if payload.initialize_from is not None:
        # Existing ranks indicate an old saved manual arrangement: preserve it.
        if payload.rebuild or not (preference.field_revisions or {}).get(key):
            order = payload.initialize_from
            field = {
                "recent_read": RecentItem.last_opened_at, "updated": Conversation.updated_at,
                "created": Conversation.created_at, "imported": Conversation.imported_at,
                "content_updated": func.coalesce(Conversation.sort_time, Conversation.imported_at),
                "title": func.lower(Conversation.display_title), "message_count": Conversation.message_count,
                "custom": rank,
            }[order.mode]
            ids = query.outerjoin(RecentItem, RecentItem.conversation_id == Conversation.id).with_entities(Conversation.id).order_by(
                pin.desc(), case((field.is_(None), 1), else_=0), field.asc() if order.direction == "asc" else field.desc(), Conversation.id).all()
            ranks = {row.id: (index + 1) * GAP for index, row in enumerate(ids)}
    elif payload.conversation_id is not None:
        selected = payload.conversation_id
        if selected not in ranks or selected in {payload.before_id, payload.after_id} or payload.before_id == payload.after_id:
            raise HTTPException(409, "Invalid ordering anchors.")
        group = sorted((identifier for identifier in ranks if identifier != selected and pins[identifier] == pins[selected]),
                       key=lambda identifier: (ranks[identifier], str(identifier)))
        for anchor in (payload.before_id, payload.after_id):
            if anchor is not None and anchor not in group:
                raise HTTPException(409, "Anchors must belong to the same scope and pin group.")
        position = group.index(payload.before_id) if payload.before_id else group.index(payload.after_id) + 1 if payload.after_id else len(group)
        if payload.after_id and payload.before_id and group.index(payload.after_id) + 1 != position:
            raise HTTPException(409, "Ordering anchors are no longer adjacent.")
        left = ranks[group[position - 1]] if position > 0 else None
        right = ranks[group[position]] if position < len(group) else None
        if left is None:
            ranks[selected] = (right or 0) - GAP
        elif right is None:
            ranks[selected] = left + GAP
        elif right - left > 1:
            ranks[selected] = (left + right) // 2
        else:
            group.insert(position, selected)
            ranks.update({identifier: (index + 1) * GAP for index, identifier in enumerate(group)})
    else:
        raise HTTPException(422, "Choose initialization or anchored placement.")
    # Metadata-only full-scope normalization never loads a conversation body.
    for identifier, value in ranks.items():
        if original_ranks.get(identifier) == value:
            continue
        if payload.scope == "project":
            db.query(ProjectConversation).filter_by(project_id=payload.project_id, conversation_id=identifier).update({"sort_order": value})
        else:
            field = "unclassified_sort_order" if payload.scope == "unclassified" else "manual_sort_order"
            db.query(Conversation).filter_by(id=identifier).update({field: value})
    preference.field_revisions = {**(preference.field_revisions or {}), key: (preference.field_revisions or {}).get(key, 0) + 1}
    db.commit()
    return read_order(request, payload.scope, payload.project_id, db)
