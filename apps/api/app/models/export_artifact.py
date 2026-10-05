import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class ExportArtifact(Base):
    __tablename__ = "export_artifacts"
    __table_args__ = (
        CheckConstraint("lifecycle_state IN ('active', 'reclaiming', 'retry', 'reclaimed')", name="ck_export_artifact_lifecycle"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("background_jobs.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=True,
    )
    scope_type: Mapped[str] = mapped_column(String, nullable=False, default="conversation")
    format: Mapped[str] = mapped_column(String, nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    storage_uri: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    download_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    lifecycle_state: Mapped[str] = mapped_column(String(16), nullable=False, default="active", server_default="active")
    retention_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    release_on_close: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    policy_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    release_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reclaimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    failure_code: Mapped[str | None] = mapped_column(String(32), nullable=True)


Index("idx_export_artifacts_conversation_id", ExportArtifact.conversation_id)
Index("idx_export_artifacts_expires_at", ExportArtifact.expires_at)
Index("idx_export_artifact_reclamation", ExportArtifact.lifecycle_state, ExportArtifact.retry_at, ExportArtifact.expires_at)


class ExportArtifactLease(Base):
    """Short, renewable usage fences, never included in personal/system archives."""
    __tablename__ = "export_artifact_leases"
    __table_args__ = (
        CheckConstraint("kind IN ('viewer', 'claim', 'download')", name="ck_export_artifact_lease_kind"),
    )
    artifact_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("export_artifacts.id", ondelete="CASCADE"), primary_key=True,
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


Index("idx_export_artifact_leases_expiry", ExportArtifactLease.expires_at)
