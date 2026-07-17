import re
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.render_block import RenderBlock
from app.schemas.conversation import ConversationDetail, ConversationListItem, ConversationUpdate
from app.schemas.editing import (
    ConversationEventListResponse,
    ConversationEventRead,
    ConversationMergeRequest,
    ConversationSplitRequest,
    ConversationTransformResponse,
)
from app.schemas.message import (
    DialogueIndexItem,
    DialogueIndexResponse,
    MessageListItem,
    MessageVersionRead,
    RenderBlockRead,
)
from app.schemas.project import ConversationPinUpdate
from app.schemas.search import MessageWindowResponse
from app.schemas.task import BackgroundTaskRead, ConversationProjectMoveRequest
from app.models.import_record import utc_now
from app.services.editing.message_edit_service import (
    MessageEditError,
    split_conversation,
)
from app.services.background_jobs import queue_conversation_merge
from app.services.projects.project_service import (
    ProjectServiceError,
    add_conversation_to_project,
    move_conversation_to_project,
    remove_conversation_from_project,
)
from app.api.routes.tasks import background_job_read

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationListItem])
def list_conversations(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    source_type: str | None = None,
    source_profile: str | None = None,
    include_archived: bool = False,
    scope: str = Query(default="all", pattern="^(all|history)$"),
    db: Session = Depends(get_db),
) -> list[ConversationListItem]:
    query = db.query(Conversation).filter(
        Conversation.deleted_at.is_(None),
        Conversation.status.in_(("active", "archived")),
    )
    if not include_archived:
        query = query.filter(Conversation.status != "archived")
    if scope == "history":
        query = (
            query.outerjoin(ProjectConversation, ProjectConversation.conversation_id == Conversation.id)
            .outerjoin(Project, Project.id == ProjectConversation.project_id)
            .filter(
                (ProjectConversation.id.is_(None))
                | (Project.is_default.is_(True))
                | (Project.is_archived.is_(True))
            )
        )
    if source_type:
        query = query.filter(Conversation.source_type == source_type)
    if source_profile:
        query = query.filter(Conversation.source_profile == source_profile)
    conversations = (
        query.order_by(
            Conversation.is_global_pinned.desc(),
            Conversation.global_pinned_at.desc(),
            Conversation.sort_time.desc(),
            Conversation.imported_at.desc(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_conversation_item(conversation) for conversation in conversations]


@router.post("/merge", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def merge_conversations_endpoint(
    payload: ConversationMergeRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    try:
        job = queue_conversation_merge(
            db=db,
            conversation_ids=payload.conversation_ids,
            title=payload.title,
            project_id=payload.project_id,
            idempotency_key=idempotency_key,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return background_job_read(job)


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> ConversationDetail:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return ConversationDetail(
        **_conversation_item(conversation).model_dump(),
        external_source_id=conversation.external_source_id,
        parser_version=conversation.parser_version,
        render_version=conversation.render_version,
        content_hash=conversation.content_hash,
        sort_time=conversation.sort_time,
    )


@router.patch("/{conversation_id}", response_model=ConversationDetail)
def update_conversation(
    conversation_id: uuid.UUID,
    payload: ConversationUpdate,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    if conversation.deleted_at is not None and payload.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")

    event_payload: dict[str, object] = {}
    if payload.title is not None or payload.display_title is not None:
        title = (payload.title if payload.title is not None else payload.display_title or "").strip()
        display_title = (payload.display_title if payload.display_title is not None else payload.title or "").strip()
        if not title and not display_title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Conversation title cannot be empty.")
        previous_title = conversation.title
        previous_display_title = conversation.display_title
        conversation.title = title or display_title
        conversation.display_title = display_title or title
        conversation.updated_at = utc_now()
        event_payload.update(
            {
                "previous_title": previous_title,
                "previous_display_title": previous_display_title,
                "title": conversation.title,
                "display_title": conversation.display_title,
            }
        )

    if payload.status is not None:
        if payload.status not in {"active", "archived"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid conversation status.")
        previous_status = conversation.status
        conversation.status = payload.status
        if payload.status == "active":
            conversation.deleted_at = None
        conversation.updated_at = utc_now()
        event_type = "conversation_archived" if payload.status == "archived" else "conversation_restored"
        _add_conversation_event(
            db,
            conversation.id,
            event_type,
            {"previous_status": previous_status, "status": payload.status},
        )

    if event_payload:
        _add_conversation_event(db, conversation.id, "conversation_renamed", event_payload)
    db.commit()
    return _conversation_detail(conversation)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    conversation.deleted_at = utc_now()
    conversation.status = "deleted"
    conversation.updated_at = utc_now()
    _add_conversation_event(db, conversation.id, "conversation_deleted", {"conversation_id": str(conversation.id)})
    db.commit()


@router.post("/{conversation_id}/split", response_model=ConversationTransformResponse)
def split_conversation_endpoint(
    conversation_id: uuid.UUID,
    payload: ConversationSplitRequest,
    db: Session = Depends(get_db),
) -> ConversationTransformResponse:
    try:
        result = split_conversation(
            db=db,
            conversation_id=conversation_id,
            start_message_id=payload.start_message_id,
            end_message_id=payload.end_message_id,
            title=payload.title,
            project_id=payload.project_id,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return ConversationTransformResponse(
        conversation_id=result.conversation.id,
        title=result.conversation.title,
        display_title=result.conversation.display_title,
        message_count=result.message_count,
    )


@router.post("/{conversation_id}/projects/{project_id}", response_model=ConversationDetail)
def add_conversation_project_membership(
    conversation_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    try:
        add_conversation_to_project(db, project_id, conversation_id, added_by="user")
        conversation = db.get(Conversation, conversation_id)
        assert conversation is not None
        _add_conversation_event(
            db,
            conversation_id,
            "project_changed",
            {"action": "added", "project_id": str(project_id)},
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _conversation_detail(conversation)


@router.put("/{conversation_id}/project", response_model=ConversationDetail)
def move_conversation_project(
    conversation_id: uuid.UUID,
    payload: ConversationProjectMoveRequest,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    if conversation.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only active conversations can be moved.",
        )
    try:
        relation = move_conversation_to_project(
            db,
            conversation_id=conversation_id,
            project_id=payload.project_id,
            added_by="user",
        )
        _add_conversation_event(
            db,
            conversation_id,
            "project_changed",
            {"action": "moved", "project_id": str(relation.project_id)},
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _conversation_detail(conversation)


@router.delete("/{conversation_id}/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_conversation_project_membership(
    conversation_id: uuid.UUID,
    project_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> None:
    try:
        remove_conversation_from_project(db, project_id, conversation_id)
        _add_conversation_event(
            db,
            conversation_id,
            "project_changed",
            {"action": "removed", "project_id": str(project_id)},
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{conversation_id}/events", response_model=ConversationEventListResponse)
def list_conversation_events(
    conversation_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    event_type: str | None = None,
    db: Session = Depends(get_db),
) -> ConversationEventListResponse:
    if db.get(Conversation, conversation_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    query = db.query(ConversationEvent).filter(ConversationEvent.conversation_id == conversation_id)
    if event_type:
        query = query.filter(ConversationEvent.event_type == event_type)
    total = query.count()
    events = (
        query.order_by(ConversationEvent.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return ConversationEventListResponse(
        items=[
            ConversationEventRead(
                id=event.id,
                event_type=event.event_type,
                target_message_id=event.target_message_id,
                target_version_id=event.target_version_id,
                payload=event.payload,
                created_at=event.created_at,
                created_by=event.created_by,
            )
            for event in events
        ],
        limit=limit,
        offset=offset,
        total=total,
    )


@router.patch("/{conversation_id}/pin", response_model=ConversationDetail)
def set_conversation_pin(
    conversation_id: uuid.UUID,
    payload: ConversationPinUpdate,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    conversation.is_global_pinned = payload.is_pinned
    conversation.global_pinned_at = utc_now() if payload.is_pinned else None
    _add_conversation_event(
        db,
        conversation.id,
        "pin_changed",
        {"scope": "global", "is_pinned": payload.is_pinned},
    )
    db.commit()
    return _conversation_detail(conversation)


@router.get("/{conversation_id}/messages", response_model=list[MessageListItem])
def list_conversation_messages(
    conversation_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_blocks: bool = False,
    db: Session = Depends(get_db),
) -> list[MessageListItem]:
    if db.get(Conversation, conversation_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_message_item(message, include_blocks, db) for message in messages]


@router.get("/{conversation_id}/dialogue-index", response_model=DialogueIndexResponse)
def get_dialogue_index(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> DialogueIndexResponse:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    rows = (
        db.query(
            Message.id,
            Message.role,
            Message.order_key,
            Message.turn_index,
            func.substr(MessageVersion.display_text, 1, 4000).label("display_preview"),
        )
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .all()
    )
    role_counts: dict[str, int] = {}
    items: list[DialogueIndexItem] = []
    for ordinal, row in enumerate(rows, start=1):
        role_counts[row.role] = role_counts.get(row.role, 0) + 1
        items.append(
            DialogueIndexItem(
                message_id=row.id,
                role=row.role,
                role_number=role_counts[row.role],
                ordinal=ordinal,
                order_key=row.order_key,
                turn_index=row.turn_index,
                preview=_dialogue_preview(row.display_preview or ""),
            )
        )
    return DialogueIndexResponse(
        conversation_id=conversation_id,
        items=items,
        message_count=len(items),
        turn_count=conversation.turn_count,
    )


@router.get("/{conversation_id}/message-window", response_model=MessageWindowResponse)
def get_message_window(
    conversation_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_blocks: bool = False,
    after_order_key: str | None = None,
    before_order_key: str | None = None,
    anchor_message_id: uuid.UUID | None = None,
    anchor_order_key: str | None = None,
    content_mode: str = Query(default="full", pattern="^(full|preview)$"),
    db: Session = Depends(get_db),
) -> MessageWindowResponse:
    if db.get(Conversation, conversation_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    query = db.query(Message).filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
    if after_order_key:
        query = query.filter(Message.order_key > after_order_key)
    if before_order_key:
        query = query.filter(Message.order_key < before_order_key)
    total = query.count()
    if anchor_message_id is not None or anchor_order_key is not None:
        anchor_order = _anchor_order_key(
            db=db,
            conversation_id=conversation_id,
            anchor_message_id=anchor_message_id,
            anchor_order_key=anchor_order_key,
            after_order_key=after_order_key,
            before_order_key=before_order_key,
        )
        before_anchor = query.filter(Message.order_key < anchor_order).count()
        offset = max(0, min(max(total - limit, 0), before_anchor - limit // 2))
    messages = query.order_by(Message.order_key.asc()).offset(offset).limit(limit).all()
    return MessageWindowResponse(
        items=[
            _message_item(message, include_blocks, db, ordinal=offset + index + 1, content_mode=content_mode)
            for index, message in enumerate(messages)
        ],
        limit=limit,
        offset=offset,
        total=total,
        has_more=offset + len(messages) < total,
    )


def _anchor_order_key(
    db: Session,
    conversation_id: uuid.UUID,
    anchor_message_id: uuid.UUID | None,
    anchor_order_key: str | None,
    after_order_key: str | None,
    before_order_key: str | None,
) -> str:
    base_query = db.query(Message).filter(
        Message.conversation_id == conversation_id,
        Message.is_deleted.is_(False),
    )
    if after_order_key:
        base_query = base_query.filter(Message.order_key > after_order_key)
    if before_order_key:
        base_query = base_query.filter(Message.order_key < before_order_key)

    if anchor_message_id is not None:
        message = base_query.filter(Message.id == anchor_message_id).one_or_none()
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anchor message not found.")
        return message.order_key

    assert anchor_order_key is not None
    exists = base_query.filter(Message.order_key == anchor_order_key).first()
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anchor message not found.")
    return anchor_order_key


def _conversation_item(conversation: Conversation) -> ConversationListItem:
    return ConversationListItem(
        id=conversation.id,
        title=conversation.title,
        display_title=conversation.display_title,
        source_type=conversation.source_type,
        source_profile=conversation.source_profile,
        message_count=conversation.message_count,
        turn_count=conversation.turn_count,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        imported_at=conversation.imported_at,
        first_user_message=conversation.first_user_message,
        status=conversation.status,
        is_global_pinned=conversation.is_global_pinned,
        global_pinned_at=conversation.global_pinned_at,
    )


def _conversation_detail(conversation: Conversation) -> ConversationDetail:
    return ConversationDetail(
        **_conversation_item(conversation).model_dump(),
        external_source_id=conversation.external_source_id,
        parser_version=conversation.parser_version,
        render_version=conversation.render_version,
        content_hash=conversation.content_hash,
        sort_time=conversation.sort_time,
    )


def _add_conversation_event(
    db: Session,
    conversation_id: uuid.UUID,
    event_type: str,
    payload: dict,
) -> None:
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            event_type=event_type,
            payload=payload,
            created_by="user",
        )
    )


_LEADING_TIMESTAMP_RE = re.compile(
    r"^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\s*$"
)
_THINKING_DURATION_RE = re.compile(
    r"^(?:(?:已\s*)?思考(?:了)?|thinking|reasoning)\s*[:：]?\s*"
    r"(?:\d+\s*(?:h|hr|hour|小时)\s*)?(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒)$",
    re.IGNORECASE,
)
_MARKDOWN_FENCE_RE = re.compile(r"^\s*(?:`{3,}|~{3,})")
_MARKDOWN_BLOCK_PREFIX_RE = re.compile(r"^\s*(?:#{1,6}\s+|>+\s*|[-+*]\s+|\d+[.)]\s+)")
_MARKDOWN_TASK_RE = re.compile(r"^\s*\[[ xX]\]\s+")
_MARKDOWN_LINKED_IMAGE_RE = re.compile(r"\[!\[([^\]]*)\]\([^)]*\)\]\([^)]*\)")
_MARKDOWN_LINK_RE = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MARKDOWN_STRONG_RE = re.compile(r"(\*\*|__|~~)(.+?)\1")
_MARKDOWN_EMPHASIS_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_MARKDOWN_INLINE_CODE_RE = re.compile(r"`+([^`\n]+)`+")


def _dialogue_preview(text: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and _LEADING_TIMESTAMP_RE.match(lines[0].strip().lstrip(">").strip()):
        lines.pop(0)
    for index, line in enumerate(lines[:40]):
        if _THINKING_DURATION_RE.match(line.strip().lstrip(">").strip()):
            lines = lines[index + 1 :]
            break
    plain_lines: list[str] = []
    for line in lines:
        value = line.strip()
        if not value or _MARKDOWN_FENCE_RE.match(value) or re.fullmatch(r"[-*_]{3,}", value):
            continue
        while True:
            cleaned = _MARKDOWN_BLOCK_PREFIX_RE.sub("", value, count=1)
            if cleaned == value:
                break
            value = cleaned.strip()
        value = _MARKDOWN_TASK_RE.sub("", value)
        value = _MARKDOWN_LINKED_IMAGE_RE.sub(lambda match: match.group(1), value)
        value = _MARKDOWN_LINK_RE.sub(lambda match: match.group(1), value)
        value = _MARKDOWN_INLINE_CODE_RE.sub(lambda match: match.group(1), value)
        value = _MARKDOWN_STRONG_RE.sub(lambda match: match.group(2), value)
        value = _MARKDOWN_EMPHASIS_RE.sub(lambda match: match.group(1), value)
        value = value.strip().strip("|").strip()
        if value:
            plain_lines.append(value)
    preview = " ".join("\n".join(plain_lines).split())[:160]
    return preview or "打开消息查看正文"


def _message_item(
    message: Message,
    include_blocks: bool,
    db: Session,
    *,
    ordinal: int | None = None,
    content_mode: str = "full",
) -> MessageListItem:
    version = _current_version(message, db)
    blocks = _render_blocks(version.id, db) if include_blocks and version else []
    truncate_content = bool(version and content_mode == "preview" and message.is_heavy and not include_blocks)
    preview = " ".join((version.display_text if version else "").split())[:500] if truncate_content else None
    return MessageListItem(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        order_key=message.order_key,
        turn_index=message.turn_index,
        created_at=message.created_at,
        current_version=_version_read(version, truncate=truncate_content) if version else None,
        render_blocks=blocks,
        block_count=message.block_count,
        char_count=message.char_count,
        is_heavy=message.is_heavy,
        ordinal=ordinal,
        content_preview=preview,
        content_truncated=truncate_content,
    )


def _current_version(message: Message, db: Session) -> MessageVersion | None:
    if message.current_version_id is None:
        return None
    return db.get(MessageVersion, message.current_version_id)


def _version_read(version: MessageVersion, *, truncate: bool = False) -> MessageVersionRead:
    return MessageVersionRead(
        id=version.id,
        version_number=version.version_number,
        plain_text=version.plain_text[:500] if truncate else version.plain_text,
        display_text=version.display_text[:500] if truncate else version.display_text,
        blocks=[] if truncate else version.blocks,
        edit_type=version.edit_type,
        created_at=version.created_at,
        created_by=version.created_by,
        content_hash=version.content_hash,
    )


def _render_blocks(version_id: uuid.UUID, db: Session) -> list[RenderBlockRead]:
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == version_id)
        .order_by(RenderBlock.block_index.asc())
        .all()
    )
    return [_block_read(block) for block in blocks]


def _block_read(block: RenderBlock) -> RenderBlockRead:
    return RenderBlockRead(
        id=block.id,
        block_index=block.block_index,
        block_type=block.block_type,
        plain_text=block.plain_text,
        data=block.data,
        char_count=block.char_count,
        collapsed_by_default=block.collapsed_by_default,
        render_priority=block.render_priority,
    )
