import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class ConversationAnnotation(Base):
    __tablename__ = "conversation_annotations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_key: Mapped[str] = mapped_column(Text, nullable=False, default="local:default")
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    message_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("message_versions.id", ondelete="SET NULL"), nullable=True
    )
    annotation_type: Mapped[str] = mapped_column(Text, nullable=False, default="highlight")
    color: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_block_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_block_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    prefix: Mapped[str | None] = mapped_column(Text, nullable=True)
    suffix: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment_markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
    anchor_status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    conflict_of_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversation_annotations.id", ondelete="SET NULL"), nullable=True
    )
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    conversation = relationship("Conversation")
    message = relationship("Message")
    message_version = relationship("MessageVersion")


Index("idx_conversation_annotations_conversation_id", ConversationAnnotation.conversation_id)
Index("idx_conversation_annotations_message_id", ConversationAnnotation.message_id)
Index("idx_conversation_annotations_updated_at", ConversationAnnotation.updated_at)
Index("idx_conversation_annotations_conflict_of_id", ConversationAnnotation.conflict_of_id)


class ConversationNotebook(Base):
    __tablename__ = "conversation_notebooks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_key: Mapped[str] = mapped_column(Text, nullable=False, default="local:default")
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocks: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_conflict: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    conflict_of_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("conversation_notebooks.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


Index("idx_conversation_notebooks_conversation_id", ConversationNotebook.conversation_id)
Index("idx_conversation_notebooks_conflict_of_id", ConversationNotebook.conflict_of_id)


class AnnotationSyncReceipt(Base):
    __tablename__ = "annotation_sync_receipts"

    operation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    subject_key: Mapped[str] = mapped_column(Text, nullable=False, default="local:default")
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    response: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


Index("idx_annotation_sync_receipts_created_at", AnnotationSyncReceipt.created_at)
