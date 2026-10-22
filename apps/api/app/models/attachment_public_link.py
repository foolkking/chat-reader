import secrets
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class AttachmentPublicLink(Base):
    """Explicit per-attachment capability; never serialized in private packages."""

    __tablename__ = "attachment_public_links"
    __table_args__ = (
        UniqueConstraint("attachment_id", "source_asset_object_id", name="uq_attachment_public_link_source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    attachment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    source_asset_object_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("asset_objects.id", ondelete="CASCADE"), nullable=False,
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, default=lambda: secrets.token_urlsafe(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
