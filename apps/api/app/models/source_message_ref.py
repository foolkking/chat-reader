import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class SourceMessageRef(Base):
    __tablename__ = "source_message_refs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    source_profile: Mapped[str] = mapped_column(String, nullable=False)
    source_conversation_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_node_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_message_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_json_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_markdown_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parent_node_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    child_node_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    is_primary_path: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    branch_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw_metadata: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    message = relationship("Message", back_populates="source_refs")


Index("idx_source_message_refs_message_id", SourceMessageRef.message_id)
Index("idx_source_message_refs_source_profile", SourceMessageRef.source_profile)
Index("idx_source_message_refs_source_node_id", SourceMessageRef.source_node_id)
Index("idx_source_message_refs_source_message_id", SourceMessageRef.source_message_id)
Index("idx_source_message_refs_is_primary_path", SourceMessageRef.is_primary_path)
