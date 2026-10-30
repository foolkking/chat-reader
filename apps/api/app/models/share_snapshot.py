import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class ShareSnapshot(Base):
    """Immutable content projection for a frozen share.

    The snapshot deliberately stores the already-authorized rendered message
    projection rather than message IDs. A later edit therefore cannot change
    what a frozen visitor reads. Attachment-bearing messages are rejected at
    creation time until an immutable asset-retention contract exists.
    """

    __tablename__ = "share_snapshots"

    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("shares.id", ondelete="CASCADE"),
        primary_key=True,
    )
    conversation: Mapped[dict] = mapped_column(JSON, nullable=False)
    messages: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    toc: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    description_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False)
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    share = relationship("Share", back_populates="snapshot")
