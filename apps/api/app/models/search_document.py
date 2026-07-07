import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class SearchDocument(Base):
    __tablename__ = "search_documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    message_version_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("message_versions.id", ondelete="CASCADE"),
        nullable=True,
    )
    document_type: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    plain_text: Mapped[str] = mapped_column(Text, nullable=False)
    search_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_profile: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    turn_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    indexed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    search_tsv: Mapped[str | None] = mapped_column(Text, nullable=True)

    conversation = relationship("Conversation")
    message = relationship("Message")
    message_version = relationship("MessageVersion")


Index("idx_search_documents_conversation_id", SearchDocument.conversation_id)
Index("idx_search_documents_message_id", SearchDocument.message_id)
Index("idx_search_documents_message_version_id", SearchDocument.message_version_id)
Index("idx_search_documents_document_type", SearchDocument.document_type)
Index("idx_search_documents_role", SearchDocument.role)
Index("idx_search_documents_source_profile", SearchDocument.source_profile)
Index("idx_search_documents_indexed_at", SearchDocument.indexed_at)
