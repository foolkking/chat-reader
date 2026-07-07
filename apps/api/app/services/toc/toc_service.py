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
