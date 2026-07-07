import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class MessageVersion(Base):
    __tablename__ = "message_versions"
    __table_args__ = (UniqueConstraint("message_id", "version_number", name="uq_message_versions_message_version"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    plain_text: Mapped[str] = mapped_column(Text, nullable=False)
    display_text: Mapped[str] = mapped_column(Text, nullable=False)
    blocks: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    edit_type: Mapped[str] = mapped_column(String, nullable=False)
    edit_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    created_by: Mapped[str] = mapped_column(String, nullable=False, default="import")
    based_on_version_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    content_hash: Mapped[str] = mapped_column(String, nullable=False)

    message = relationship("Message", back_populates="versions")
    render_blocks = relationship("RenderBlock", back_populates="message_version", cascade="all, delete-orphan")


Index("idx_message_versions_message_id", MessageVersion.message_id)
Index("idx_message_versions_content_hash", MessageVersion.content_hash)
Index("idx_message_versions_edit_type", MessageVersion.edit_type)
