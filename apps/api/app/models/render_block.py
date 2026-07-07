import uuid

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base


class RenderBlock(Base):
    __tablename__ = "render_blocks"
    __table_args__ = (UniqueConstraint("message_version_id", "block_index", name="uq_render_blocks_version_index"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("message_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    block_index: Mapped[int] = mapped_column(Integer, nullable=False)
    block_type: Mapped[str] = mapped_column(String, nullable=False)
    plain_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    sanitized_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    measured_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    collapsed_by_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    render_priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    message_version = relationship("MessageVersion", back_populates="render_blocks")


Index("idx_render_blocks_message_version_id", RenderBlock.message_version_id)
Index("idx_render_blocks_block_type", RenderBlock.block_type)
