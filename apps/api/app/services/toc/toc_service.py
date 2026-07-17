import uuid

from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.heading import Heading


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
) -> tuple[list[Heading], int]:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise TocServiceError("Conversation not found.")
    query = db.query(Heading).filter(Heading.conversation_id == conversation_id)
    if message_id is not None:
        query = query.filter(Heading.message_id == message_id)
    if max_level is not None:
        query = query.filter(Heading.level <= max_level)
    total = query.count()
    rows = query.order_by(Heading.heading_index.asc()).offset(offset).limit(limit).all()
    return rows, total
