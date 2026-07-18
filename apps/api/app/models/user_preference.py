from datetime import datetime

from sqlalchemy import DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class UserPreference(Base):
    __tablename__ = "user_preferences"

    subject_key: Mapped[str] = mapped_column(Text, primary_key=True)
    theme_mode: Mapped[str] = mapped_column(Text, nullable=False, default="light")
    locale_mode: Mapped[str] = mapped_column(Text, nullable=False, default="auto")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
