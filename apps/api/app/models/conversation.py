import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.import_record import utc_now


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    display_title: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    source_profile: Mapped[str] = mapped_column(String, nullable=False)
    external_source_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_user_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    parser_version: Mapped[str] = mapped_column(String, nullable=False)
    render_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    content_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_global_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    global_pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    events = relationship("ConversationEvent", back_populates="conversation", cascade="all, delete-orphan")
    project_links = relationship("ProjectConversation", back_populates="conversation", cascade="all, delete-orphan")
    reading_position = relationship(
        "ReadingPosition",
        back_populates="conversation",
        cascade="all, delete-orphan",
        uselist=False,
    )
    recent_item = relationship("RecentItem", back_populates="conversation", cascade="all, delete-orphan", uselist=False)


Index("idx_conversations_source_type", Conversation.source_type)
Index("idx_conversations_source_profile", Conversation.source_profile)
Index("idx_conversations_external_source_id", Conversation.external_source_id)
Index("idx_conversations_sort_time", Conversation.sort_time)
Index("idx_conversations_imported_at", Conversation.imported_at)
Index("idx_conversations_status", Conversation.status)
