import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.import_record import utc_now


class ReadingContentBaseline(Base):
    __tablename__ = "reading_content_baselines"
    __table_args__ = (
        UniqueConstraint("subject_key", "conversation_id", name="uq_reading_content_baseline_subject_conversation"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_key: Mapped[str] = mapped_column(
        Text,
        ForeignKey("user_preferences.subject_key", ondelete="CASCADE"),
        nullable=False,
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    message_members: Mapped[list["ReadingContentBaselineMessage"]] = relationship(
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ReadingContentBaselineMessage(Base):
    __tablename__ = "reading_content_baseline_messages"
    __table_args__ = (
        UniqueConstraint("baseline_id", "message_id", name="uq_reading_content_baseline_message"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("reading_content_baselines.id", ondelete="CASCADE"),
        nullable=False,
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )


Index("idx_reading_content_baseline_messages_baseline", ReadingContentBaselineMessage.baseline_id)
