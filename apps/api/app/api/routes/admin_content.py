from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import exists, func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.routes.admin_access import _admin
from app.api.routes.attachments import _content_response
from app.core.database import get_db
from app.models.administration import AdminAuditLog
from app.models.attachment import Attachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.search_document import SearchDocument
from app.models.user import User
from app.schemas.attachment import AttachmentRead
from app.schemas.message import ReaderTurnResponse
from app.services.assets.attachment_service import AttachmentAccessError, attachment_content, attachment_read
from app.services.reader_turns import ReaderTurnHydrationError, load_reader_turn_from_query


router = APIRouter(prefix="/api/admin/content", tags=["admin-content"])


def _target_user(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


def _conversation(db: Session, user_id: uuid.UUID, conversation_id: uuid.UUID) -> Conversation:
    row = db.query(Conversation).filter(
        Conversation.id == conversation_id,
        Conversation.owner_user_id == user_id,
        Conversation.deleted_at.is_(None),
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return row


def _attachment(db: Session, user_id: uuid.UUID, attachment_id: uuid.UUID) -> Attachment:
    row = (
        db.query(Attachment)
        .options(joinedload(Attachment.asset_object))
        .join(Conversation, Conversation.id == Attachment.conversation_id)
        .filter(
            Attachment.id == attachment_id,
            Attachment.deleted_at.is_(None),
            Conversation.owner_user_id == user_id,
            Conversation.deleted_at.is_(None),
        )
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    return row


def _audit(
    db: Session,
    request: Request,
    *,
    actor_user_id: uuid.UUID,
    action: str,
    target_user_id: uuid.UUID,
    resource_type: str,
    resource_id: uuid.UUID,
) -> None:
    db.add(AdminAuditLog(
        actor_user_id=actor_user_id,
        action=action,
        target_user_id=target_user_id,
        resource_type=resource_type,
        resource_id=str(resource_id),
        result="SUCCESS",
        event_metadata={},
        request_id=request.headers.get("x-request-id"),
    ))


@router.get("/search")
def search_admin_content(
    request: Request,
    q: str | None = Query(default=None, max_length=256),
    user_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    conversation_id: uuid.UUID | None = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    actor = _admin(request, db)
    query = db.query(Conversation, User).join(User, User.id == Conversation.owner_user_id).filter(
        Conversation.deleted_at.is_(None)
    )
    if user_id is not None:
        query = query.filter(Conversation.owner_user_id == user_id)
    if conversation_id is not None:
        query = query.filter(Conversation.id == conversation_id)
    if project_id is not None:
        query = query.filter(exists().where(
            (ProjectConversation.conversation_id == Conversation.id)
            & (ProjectConversation.project_id == project_id)
        ))
    if created_after is not None:
        query = query.filter(Conversation.imported_at >= created_after)
    if created_before is not None:
        query = query.filter(Conversation.imported_at <= created_before)
    clean_q = (q or "").strip()
    if clean_q:
        like = _literal_like(clean_q)
        query = query.filter(or_(
            Conversation.display_title.ilike(like, escape="\\"),
            Conversation.title.ilike(like, escape="\\"),
            exists().where(
                (SearchDocument.conversation_id == Conversation.id)
                & (SearchDocument.plain_text.ilike(like, escape="\\"))
            ),
        ))
    total = query.count()
    rows = query.order_by(Conversation.sort_time.desc().nullslast(), Conversation.imported_at.desc(), Conversation.id.desc()).offset(offset).limit(limit).all()
    items = []
    for conversation, user in rows:
        snippet = conversation.summary or conversation.first_user_message
        if clean_q:
            hit = db.query(SearchDocument.plain_text).filter(
                SearchDocument.conversation_id == conversation.id,
                SearchDocument.plain_text.ilike(_literal_like(clean_q), escape="\\"),
            ).order_by(SearchDocument.indexed_at.desc()).first()
            if hit:
                snippet = _bounded_snippet(hit[0], clean_q)
        items.append({
            "conversation_id": str(conversation.id),
            "user_id": str(user.id),
            "user_email": user.normalized_email,
            "user_display_name": user.display_name,
            "title": conversation.display_title,
            "status": conversation.status,
            "message_count": conversation.message_count,
            "created_at": conversation.created_at,
            "updated_at": conversation.updated_at,
            "snippet": (snippet or "")[:360],
        })
        _audit(db, request, actor_user_id=actor.id, action="VIEW_USER_CONVERSATION",
               target_user_id=user.id, resource_type="CONVERSATION", resource_id=conversation.id)
    if items:
        db.commit()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/users/{user_id}/projects")
def list_user_projects(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> list[dict]:
    _admin(request, db)
    _target_user(db, user_id)
    rows = db.query(Project).filter(Project.owner_user_id == user_id).order_by(Project.sort_order, Project.id).all()
    counts = dict(db.query(ProjectConversation.project_id, func.count(ProjectConversation.conversation_id)).join(
        Conversation, Conversation.id == ProjectConversation.conversation_id
    ).filter(Conversation.owner_user_id == user_id).group_by(ProjectConversation.project_id).all())
    return [{
        "id": str(row.id), "name": row.name, "description": row.description,
        "is_default": row.is_default, "is_archived": row.is_archived,
        "conversation_count": counts.get(row.id, 0), "created_at": row.created_at, "updated_at": row.updated_at,
    } for row in rows]


@router.get("/users/{user_id}/conversations")
def list_user_conversations(
    user_id: uuid.UUID,
    request: Request,
    q: str | None = Query(default=None, max_length=256),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    actor = _admin(request, db)
    _target_user(db, user_id)
    query = db.query(Conversation).filter(
        Conversation.owner_user_id == user_id, Conversation.deleted_at.is_(None)
    )
    if (q or "").strip():
        like = _literal_like(q.strip())
        query = query.filter(or_(Conversation.display_title.ilike(like, escape="\\"), Conversation.title.ilike(like, escape="\\")))
    total = query.count()
    rows = query.order_by(Conversation.sort_time.desc().nullslast(), Conversation.imported_at.desc(), Conversation.id.desc()).offset(offset).limit(limit).all()
    _audit(db, request, actor_user_id=actor.id, action="LIST_USER_CONVERSATIONS", target_user_id=user_id,
           resource_type="USER", resource_id=user_id)
    db.commit()
    return {"items": [{
        "id": str(row.id), "title": row.display_title, "status": row.status,
        "message_count": row.message_count, "turn_count": row.turn_count,
        "created_at": row.created_at, "updated_at": row.updated_at,
        "summary": (row.summary or row.first_user_message or "")[:360],
    } for row in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/users/{user_id}/conversations/{conversation_id}/reader-turn", response_model=ReaderTurnResponse)
def read_user_conversation(
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    request: Request,
    anchor_message_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
) -> ReaderTurnResponse:
    actor = _admin(request, db)
    _target_user(db, user_id)
    _conversation(db, user_id, conversation_id)
    try:
        result = load_reader_turn_from_query(db, conversation_id,
            db.query(Message).filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False)),
            anchor_message_id, attachment_content_prefix=f"/api/admin/content/users/{user_id}/attachments")
    except (ValueError, ReaderTurnHydrationError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    _audit(db, request, actor_user_id=actor.id, action="VIEW_USER_CONVERSATION", target_user_id=user_id,
           resource_type="CONVERSATION", resource_id=conversation_id)
    db.commit()
    return result


@router.get("/users/{user_id}/attachments")
def list_user_attachments(
    user_id: uuid.UUID,
    request: Request,
    q: str | None = Query(default=None, max_length=256),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> dict:
    actor = _admin(request, db)
    _target_user(db, user_id)
    query = db.query(Attachment).options(joinedload(Attachment.asset_object)).join(
        Conversation, Conversation.id == Attachment.conversation_id
    ).filter(
        Conversation.owner_user_id == user_id,
        Conversation.deleted_at.is_(None),
        Attachment.deleted_at.is_(None),
    )
    if (q or "").strip():
        like = _literal_like(q.strip())
        query = query.filter(or_(Attachment.display_name.ilike(like, escape="\\"), Attachment.original_filename.ilike(like, escape="\\")))
    total = query.count()
    rows = query.order_by(Attachment.created_at.desc(), Attachment.id).offset(offset).limit(limit).all()
    items = []
    for row in rows:
        payload = attachment_read(row, content_prefix=f"/api/admin/content/users/{user_id}/attachments").model_dump()
        items.append(payload)
    _audit(db, request, actor_user_id=actor.id, action="LIST_USER_ATTACHMENTS", target_user_id=user_id,
           resource_type="USER", resource_id=user_id)
    db.commit()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/users/{user_id}/attachments/{attachment_id}", response_model=AttachmentRead)
def read_user_attachment_metadata(
    user_id: uuid.UUID,
    attachment_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> AttachmentRead:
    actor = _admin(request, db)
    row = _attachment(db, user_id, attachment_id)
    _audit(db, request, actor_user_id=actor.id, action="VIEW_USER_ATTACHMENT", target_user_id=user_id,
           resource_type="ATTACHMENT", resource_id=attachment_id)
    db.commit()
    return attachment_read(row, content_prefix=f"/api/admin/content/users/{user_id}/attachments")


@router.get("/users/{user_id}/attachments/{attachment_id}/content")
@router.head("/users/{user_id}/attachments/{attachment_id}/content")
def read_user_attachment_content(
    user_id: uuid.UUID,
    attachment_id: uuid.UUID,
    request: Request,
    disposition: str = Query(default="inline", pattern="^(inline|attachment)$"),
    db: Session = Depends(get_db),
) -> Response:
    actor = _admin(request, db)
    row = _attachment(db, user_id, attachment_id)
    try:
        content = attachment_content(row)
    except AttachmentAccessError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    action = "DOWNLOAD_USER_ATTACHMENT" if disposition == "attachment" else "VIEW_USER_ATTACHMENT"
    _audit(db, request, actor_user_id=actor.id, action=action, target_user_id=user_id,
           resource_type="ATTACHMENT", resource_id=attachment_id)
    db.commit()
    return _content_response(
        Path(content.path), content.asset_object.detected_mime_type, content.attachment.display_name,
        request.method, disposition, request.headers.get("range"), cache_control="private, no-store",
    )


def _bounded_snippet(value: str, query: str) -> str:
    if not value:
        return ""
    index = value.casefold().find(query.casefold())
    if index < 0:
        return value[:360]
    start = max(0, index - 120)
    end = min(len(value), index + len(query) + 220)
    return ("…" if start else "") + value[start:end] + ("…" if end < len(value) else "")


def _literal_like(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/users/{user_id}/conversations/{conversation_id}")
def user_conversation_detail(user_id: uuid.UUID, conversation_id: uuid.UUID, request: Request,
                             db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    row = _conversation(db, user_id, conversation_id)
    _audit(db, request, actor_user_id=actor.id, action="VIEW_USER_CONVERSATION", target_user_id=user_id,
           resource_type="CONVERSATION", resource_id=conversation_id)
    db.commit()
    return {"id": str(row.id), "title": row.display_title or row.title, "message_count": row.message_count,
            "turn_count": row.turn_count, "status": row.status}


@router.get("/users/{user_id}/conversations/{conversation_id}/search")
def search_user_messages(user_id: uuid.UUID, conversation_id: uuid.UUID, request: Request,
                         q: str = Query(min_length=1, max_length=256),
                         offset: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=100),
                         db: Session = Depends(get_db)) -> dict:
    actor = _admin(request, db)
    _conversation(db, user_id, conversation_id)
    if not q.strip():
        raise HTTPException(status_code=422, detail="Enter a search term.")
    query = db.query(SearchDocument, Message).join(Message, Message.id == SearchDocument.message_id).filter(
        Message.conversation_id == conversation_id, Message.is_deleted.is_(False),
        SearchDocument.document_type == "message", SearchDocument.message_version_id == Message.current_version_id,
        SearchDocument.plain_text.ilike(_literal_like(q.strip()), escape="\\"),
    )
    total = query.count()
    items = [{"message_id": str(message.id), "role": message.role,
              "snippet": _bounded_snippet(doc.plain_text, q.strip())}
             for doc, message in query.order_by(Message.order_key, SearchDocument.id).offset(offset).limit(limit).all()]
    _audit(db, request, actor_user_id=actor.id, action="SEARCH_USER_CONVERSATION", target_user_id=user_id,
           resource_type="CONVERSATION", resource_id=conversation_id)
    db.commit()
    return {"items": items, "total": total, "limit": limit, "offset": offset}
