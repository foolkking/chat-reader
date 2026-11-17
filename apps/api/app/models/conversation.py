import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, Text, Uuid, event, func, select
from sqlalchemy.orm import Mapped, mapped_column, relationship, object_session

from app.core.database import Base
from app.models.import_record import utc_now


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
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
    description_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    parser_version: Mapped[str] = mapped_column(String, nullable=False)
    render_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    content_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    sort_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    manual_sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unclassified_sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    offline_revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
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
    attachments = relationship("Attachment", cascade="all, delete-orphan")
    attachment_upload_sessions = relationship("AttachmentUploadSession", cascade="all, delete-orphan")


Index("idx_conversations_source_type", Conversation.source_type)
Index("idx_conversations_source_profile", Conversation.source_profile)
Index("idx_conversations_external_source_id", Conversation.external_source_id)
Index("idx_conversations_sort_time", Conversation.sort_time)
Index("idx_conversations_manual_sort_order", Conversation.manual_sort_order)
Index("idx_conversations_owner_unclassified_order", Conversation.owner_user_id, Conversation.unclassified_sort_order)
Index("idx_conversations_message_count", Conversation.message_count)
Index("idx_conversations_imported_at", Conversation.imported_at)
Index("idx_conversations_status", Conversation.status)
Index("idx_conversations_owner_status_sort", Conversation.owner_user_id, Conversation.status, Conversation.sort_time)
Index("idx_conversations_owner_manual_order", Conversation.owner_user_id, Conversation.manual_sort_order)


@event.listens_for(Conversation, "before_insert")
def append_new_manual_position(mapper, connection, target):
    # Mapper callbacks for an entire batch run before its INSERT statements.
    # Reserve positions within the transaction as well as against persisted rows.
    # A rollback/new transaction cannot reuse the previous reservation cache.
    from app.services.navigation_order_lock import lock_navigation_order
    lock_navigation_order(connection, target.owner_user_id)
    session = object_session(target)
    transaction = session.get_transaction() if session else None
    cache = session.info.setdefault("navigation_append", {}) if session else {}
    if cache.get("transaction") is not transaction:
        cache.clear()
        cache["transaction"] = transaction
    owner = target.owner_user_id
    if owner not in cache:
        values = connection.execute(select(
            func.max(Conversation.manual_sort_order), func.max(Conversation.unclassified_sort_order),
        ).where(Conversation.owner_user_id == owner)).one()
        cache[owner] = dict(zip(("manual_sort_order", "unclassified_sort_order"), (value or 0 for value in values)))
    for name in ("manual_sort_order", "unclassified_sort_order"):
        if getattr(target, name) is None:
            setattr(target, name, cache[owner][name] + 1024)
        cache[owner][name] = max(cache[owner][name], getattr(target, name))
