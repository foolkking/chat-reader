import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class SourceArtifact(Base):
    __tablename__ = "source_artifacts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    import_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("imports.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    source_profile: Mapped[str] = mapped_column(String, nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    safe_filename: Mapped[str] = mapped_column(String, nullable=False)
    sha256: Mapped[str] = mapped_column(String, nullable=False)
    byte_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_guess: Mapped[str | None] = mapped_column(String, nullable=True)
    file_extension: Mapped[str | None] = mapped_column(String, nullable=True)
    raw_storage_uri: Mapped[str] = mapped_column(String, nullable=False)
    parsed_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    import_record = relationship("ImportRecord", back_populates="artifacts")


Index("idx_source_artifacts_sha256", SourceArtifact.sha256)
Index("idx_source_artifacts_import_id", SourceArtifact.import_id)
Index("idx_source_artifacts_source_profile", SourceArtifact.source_profile)
