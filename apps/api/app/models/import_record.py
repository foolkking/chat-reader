import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ImportRecord(Base):
    __tablename__ = "imports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    source_profile: Mapped[str] = mapped_column(String, nullable=False)
    source_fingerprint: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="previewed")
    phase: Mapped[str] = mapped_column(String, nullable=False, default="previewed")
    progress: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    processed_messages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_messages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    alignment_status: Mapped[str] = mapped_column(String, nullable=False, default="not_applicable")
    warnings: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    json_filename: Mapped[str | None] = mapped_column(String, nullable=True)
    md_filename: Mapped[str | None] = mapped_column(String, nullable=True)
    csv_filename: Mapped[str | None] = mapped_column(String, nullable=True)
    detected_title: Mapped[str | None] = mapped_column(String, nullable=True)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("conversations.id", ondelete="SET NULL"),
        nullable=True,
    )
    committed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft_storage_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft_sha256: Mapped[str | None] = mapped_column(String, nullable=True)
    draft_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    session_state: Mapped[str] = mapped_column(String, nullable=False, default="COMPLETED")
    analysis_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    draft_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )

    artifacts = relationship(
        "SourceArtifact",
        back_populates="import_record",
        cascade="all, delete-orphan",
    )
    input_groups = relationship(
        "ImportInputGroup",
        back_populates="import_record",
        cascade="all, delete-orphan",
    )
    structure_families = relationship(
        "ImportStructureFamily",
        back_populates="import_record",
        cascade="all, delete-orphan",
    )


Index("idx_imports_status_queued_at", ImportRecord.status, ImportRecord.queued_at)
Index("idx_imports_owner_status_queued", ImportRecord.owner_user_id, ImportRecord.status, ImportRecord.queued_at)
