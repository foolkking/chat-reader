from datetime import datetime
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, JSON, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class UserPreference(Base):
    __tablename__ = "user_preferences"

    subject_key: Mapped[str] = mapped_column(Text, primary_key=True)
    theme_mode: Mapped[str] = mapped_column(Text, nullable=False, default="light")
    locale_mode: Mapped[str] = mapped_column(Text, nullable=False, default="auto")
    reader_width_mode: Mapped[str] = mapped_column(Text, nullable=False, default="standard")
    reader_density_mode: Mapped[str] = mapped_column(Text, nullable=False, default="comfortable")
    reader_font_size_px: Mapped[int] = mapped_column(nullable=False, default=17)
    section_toc_mode: Mapped[str] = mapped_column(Text, nullable=False, default="visible")
    conversation_sort_mode: Mapped[str] = mapped_column(Text, nullable=False, default="recent_read")
    conversation_sort_direction: Mapped[str] = mapped_column(Text, nullable=False, default="desc")
    project_sort_mode: Mapped[str] = mapped_column(Text, nullable=False, default="recent_read")
    project_sort_direction: Mapped[str] = mapped_column(Text, nullable=False, default="desc")
    reader_default_focus: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    annotation_default_position: Mapped[str] = mapped_column(Text, nullable=False, default="floating")
    field_revisions: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )


class PreferenceSyncReceipt(Base):
    __tablename__ = "preference_sync_receipts"

    subject_key: Mapped[str] = mapped_column(Text, ForeignKey("user_preferences.subject_key", ondelete="CASCADE"), primary_key=True)
    operation_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    response: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
