import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class Heading(Base):
    __tablename__ = "headings"
    __table_args__ = (UniqueConstraint("conversation_id", "heading_index", name="uq_headings_conversation_heading_index"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    message_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("message_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    render_block_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("render_blocks.id", ondelete="SET NULL"),
        nullable=True,
    )
    block_index: Mapped[int] = mapped_column(Integer, nullable=False)
    heading_index: Mapped[int] = mapped_column(Integer, nullable=False)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    order_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)

    conversation = relationship("Conversation")
    message = relationship("Message")
    message_version = relationship("MessageVersion")
    render_block = relationship("RenderBlock")


Index("idx_headings_conversation_id", Heading.conversation_id)
Index("idx_headings_message_id", Heading.message_id)
Index("idx_headings_message_version_id", Heading.message_version_id)
Index("idx_headings_render_block_id", Heading.render_block_id)
Index("idx_headings_level", Heading.level)
Index("idx_headings_heading_index", Heading.heading_index)
Index("idx_headings_order_key", Heading.order_key)
