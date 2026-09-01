import uuid

from sqlalchemy.orm import Session, selectinload

from app.models.conversation import Conversation
from app.models.import_record import utc_now
from app.models.message import Message
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.reading_position import ReadingPosition
from app.models.recent_item import RecentItem
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, OwnershipScope, get_owned


class ReadingServiceError(ValueError):
    pass


DEFAULT_READING_SUBJECT_KEY = "local:default"


def resolve_reading_subject_key() -> str:
    """Single-user identity boundary; replace with the authenticated subject later."""
    return DEFAULT_READING_SUBJECT_KEY


def get_reading_position(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    subject_key: str,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ReadingPosition | None:
    _ensure_conversation(db, conversation_id, ownership_scope)
    return (
        db.query(ReadingPosition)
        .filter(
            ReadingPosition.conversation_id == conversation_id,
            ReadingPosition.subject_key == subject_key,
        )
        .one_or_none()
    )


def upsert_reading_position(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    subject_key: str,
    message_id: uuid.UUID | None,
    block_index: int | None,
    scroll_offset: int,
    anchor_data: dict,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ReadingPosition:
    _ensure_conversation(db, conversation_id, ownership_scope)
    if block_index is not None and block_index < 0:
        raise ReadingServiceError("block_index cannot be negative.")
    if scroll_offset < 0:
        raise ReadingServiceError("scroll_offset cannot be negative.")
    if message_id is not None:
        message = _ensure_message_belongs_to_conversation(db, conversation_id, message_id)
        if block_index is not None and message.block_count > 0 and block_index >= message.block_count:
            raise ReadingServiceError("block_index is outside the current message.")
    elif block_index is not None:
        raise ReadingServiceError("block_index requires message_id.")

    position = (
        db.query(ReadingPosition)
        .filter(
            ReadingPosition.conversation_id == conversation_id,
            ReadingPosition.subject_key == subject_key,
        )
        .one_or_none()
    )
    if position is None:
        position = ReadingPosition(
            id=uuid.uuid4(),
            subject_key=subject_key,
            conversation_id=conversation_id,
            message_id=message_id,
            block_index=block_index,
            scroll_offset=scroll_offset,
            anchor_data=anchor_data,
        )
        db.add(position)
    else:
        position.message_id = message_id
        position.block_index = block_index
        position.scroll_offset = scroll_offset
        position.anchor_data = anchor_data
        position.updated_at = utc_now()
    db.flush()
    _touch_recent_item(
        db,
        conversation_id,
        last_message_id=message_id,
        context={
            "block_index": block_index,
            **({"progress": anchor_data["progress"]} if isinstance(anchor_data.get("progress"), (int, float)) else {}),
        },
        increment_open_count=False,
    )
    return position


def record_recent_item(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    project_id: uuid.UUID | None = None,
    last_message_id: uuid.UUID | None = None,
    context: dict | None = None,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> RecentItem:
    _ensure_conversation(db, conversation_id, ownership_scope)
    if last_message_id is not None:
        _ensure_message_belongs_to_conversation(db, conversation_id, last_message_id)

    recent = _touch_recent_item(
        db,
        conversation_id,
        project_id=project_id,
        last_message_id=last_message_id,
        context=context,
        increment_open_count=True,
    )
    if project_id is not None:
        project = get_owned(db, Project, project_id, ownership_scope)
        if project is not None:
            project.last_read_at = utc_now()
    return recent


def _touch_recent_item(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    project_id: uuid.UUID | None = None,
    last_message_id: uuid.UUID | None = None,
    context: dict | None = None,
    increment_open_count: bool,
) -> RecentItem:
    recent = db.query(RecentItem).filter(RecentItem.conversation_id == conversation_id).one_or_none()
    if recent is None:
        recent = RecentItem(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            project_id=project_id,
            last_message_id=last_message_id,
            context=context or {},
        )
        db.add(recent)
    else:
        if project_id is not None:
            recent.project_id = project_id
        if last_message_id is not None:
            recent.last_message_id = last_message_id
        if context is not None:
            recent.context = {**(recent.context or {}), **context}
        if increment_open_count:
            recent.open_count += 1
        recent.last_opened_at = utc_now()
    db.flush()
    return recent


def list_recent_items(
    db: Session,
    limit: int,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> list[RecentItem]:
    return (
        db.query(RecentItem)
        .options(
            selectinload(RecentItem.conversation).selectinload(Conversation.recent_item),
            selectinload(RecentItem.conversation)
            .selectinload(Conversation.project_links)
            .selectinload(ProjectConversation.project),
        )
        .join(Conversation, Conversation.id == RecentItem.conversation_id)
        .filter(
            ownership_scope.predicate(Conversation),
            Conversation.status == "active",
            Conversation.deleted_at.is_(None),
        )
        .order_by(RecentItem.last_opened_at.desc())
        .limit(limit)
        .all()
    )


def _ensure_conversation(
    db: Session,
    conversation_id: uuid.UUID,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> Conversation:
    conversation = get_owned(db, Conversation, conversation_id, ownership_scope)
    if conversation is None or conversation.deleted_at is not None:
        raise ReadingServiceError("Conversation not found.")
    return conversation


def _ensure_message_belongs_to_conversation(
    db: Session,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
) -> Message:
    message = db.get(Message, message_id)
    if message is None or message.conversation_id != conversation_id:
        raise ReadingServiceError("Message does not belong to conversation.")
    return message
