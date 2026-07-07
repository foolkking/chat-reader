import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.import_record import utc_now


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("conversation_id", "order_key", name="uq_messages_conversation_order_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    author_label: Mapped[str | None] = mapped_column(String, nullable=True)
    order_key: Mapped[str] = mapped_column(String, nullable=False)
    turn_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_in_system_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(String, nullable=True)
    delete_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String, nullable=False, default="import")
    source_type: Mapped[str] = mapped_column(String, nullable=False, default="import")
    content_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    estimated_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    measured_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    block_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_heavy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    conversation = relationship("Conversation", back_populates="messages")
    versions = relationship("MessageVersion", back_populates="message", cascade="all, delete-orphan")
    source_refs = relationship("SourceMessageRef", back_populates="message", cascade="all, delete-orphan")


Index("idx_messages_conversation_id", Message.conversation_id)
Index("idx_messages_role", Message.role)
Index("idx_messages_created_at", Message.created_at)
Index("idx_messages_content_hash", Message.content_hash)
Index("idx_messages_is_deleted", Message.is_deleted)
