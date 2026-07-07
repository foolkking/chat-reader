import uuid

from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.import_record import utc_now
from app.models.message import Message
from app.models.reading_position import ReadingPosition
from app.models.recent_item import RecentItem


class ReadingServiceError(ValueError):
    pass


def get_reading_position(db: Session, conversation_id: uuid.UUID) -> ReadingPosition | None:
    _ensure_conversation(db, conversation_id)
    return db.query(ReadingPosition).filter(ReadingPosition.conversation_id == conversation_id).one_or_none()


def upsert_reading_position(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    message_id: uuid.UUID | None,
    block_index: int | None,
    scroll_offset: int,
    anchor_data: dict,
) -> ReadingPosition:
    _ensure_conversation(db, conversation_id)
    if block_index is not None and block_index < 0:
        raise ReadingServiceError("block_index cannot be negative.")
    if scroll_offset < 0:
        raise ReadingServiceError("scroll_offset cannot be negative.")
    if message_id is not None:
        _ensure_message_belongs_to_conversation(db, conversation_id, message_id)

    position = db.query(ReadingPosition).filter(ReadingPosition.conversation_id == conversation_id).one_or_none()
    if position is None:
        position = ReadingPosition(
            id=uuid.uuid4(),
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
    return position


def record_recent_item(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    project_id: uuid.UUID | None = None,
    last_message_id: uuid.UUID | None = None,
    context: dict | None = None,
) -> RecentItem:
    _ensure_conversation(db, conversation_id)
    if last_message_id is not None:
        _ensure_message_belongs_to_conversation(db, conversation_id, last_message_id)

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
        recent.project_id = project_id
        recent.last_message_id = last_message_id
        recent.context = context or {}
        recent.open_count += 1
        recent.last_opened_at = utc_now()
    db.flush()
    return recent


def list_recent_items(db: Session, limit: int) -> list[RecentItem]:
    return db.query(RecentItem).order_by(RecentItem.last_opened_at.desc()).limit(limit).all()


def _ensure_conversation(db: Session, conversation_id: uuid.UUID) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
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
