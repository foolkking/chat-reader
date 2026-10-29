from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class UserFeatureEntry(Base):
    __tablename__ = "user_feature_entries"
    __table_args__ = (
        Index("ix_user_feature_entries_owner_collection_updated", "subject_key", "collection", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    subject_key: Mapped[str] = mapped_column(
        Text,
        ForeignKey("user_preferences.subject_key", ondelete="CASCADE"),
        nullable=False,
    )
    collection: Mapped[str] = mapped_column(String(32), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
