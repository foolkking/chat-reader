import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, JSON, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class ArchiveRestoreReceipt(Base):
    """A successful restore, retained independently of task retention."""
    __tablename__ = "archive_restore_receipts"

    owner_user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    content_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    restore_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, unique=True)
    result: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class ArchiveRestoreAccount(Base):
    """Validated source identities and durable admin choices for one preview."""
    __tablename__ = "archive_restore_accounts"
    __table_args__ = (CheckConstraint("decision IN ('ROOT', 'NEW', 'EXISTING', 'UNSET')", name="ck_archive_restore_account_decision"),)

    preview_job_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("background_jobs.id", ondelete="CASCADE"), primary_key=True)
    source_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    source_role: Mapped[str] = mapped_column(String(20), nullable=False)
    normalized_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    decision: Mapped[str] = mapped_column(String(16), nullable=False, default="UNSET")
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
