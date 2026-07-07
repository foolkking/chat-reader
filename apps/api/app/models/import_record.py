import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ImportRecord(Base):
    __tablename__ = "imports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_profile: Mapped[str] = mapped_column(String, nullable=False)
    source_fingerprint: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="previewed")
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
