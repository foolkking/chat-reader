import uuid

from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.heading import Heading
from app.models.message import Message


class TocServiceError(ValueError):
    pass


def list_headings(db: Session, conversation_id: uuid.UUID) -> list[Heading]:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise TocServiceError("Conversation not found.")
    return (
        db.query(Heading)
        .filter(Heading.conversation_id == conversation_id)
        .order_by(Heading.heading_index.asc())
        .all()
    )


def list_headings_page(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    message_id: uuid.UUID | None,
    offset: int,
    limit: int,
    max_level: int | None,
    role: str | None = None,
    query_text: str | None = None,
    start_order_key: str | None = None,
    end_order_key: str | None = None,
) -> tuple[list[Heading], int]:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise TocServiceError("Conversation not found.")
    query = db.query(Heading).filter(Heading.conversation_id == conversation_id)
    if message_id is not None:
        query = query.filter(Heading.message_id == message_id)
    if max_level is not None:
        query = query.filter(Heading.level <= max_level)
    if role is not None:
        query = query.join(Message, Message.id == Heading.message_id).filter(Message.role == role)
    if query_text:
        query = query.filter(Heading.text.ilike(f"%{query_text.strip()}%"))
    if start_order_key:
        query = query.filter(Heading.order_key >= start_order_key)
    if end_order_key:
        query = query.filter(Heading.order_key <= end_order_key)
    total = query.count()
    rows = query.order_by(Heading.heading_index.asc()).offset(offset).limit(limit).all()
    return rows, total
