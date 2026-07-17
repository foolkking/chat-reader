import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class ReadingPosition(Base):
    __tablename__ = "reading_positions"
    __table_args__ = (
        UniqueConstraint("subject_key", "conversation_id", name="uq_reading_positions_subject_conversation"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_key: Mapped[str] = mapped_column(Text, nullable=False, default="local:default")
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    block_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scroll_offset: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    anchor_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    conversation = relationship("Conversation", back_populates="reading_position")
    message = relationship("Message")


Index("idx_reading_positions_conversation_id", ReadingPosition.conversation_id)
Index("idx_reading_positions_subject_key", ReadingPosition.subject_key)
Index("idx_reading_positions_message_id", ReadingPosition.message_id)
Index("idx_reading_positions_updated_at", ReadingPosition.updated_at)
