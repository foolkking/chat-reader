import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class OfflinePackageLease(Base):
    """Short-lived transfer fence for superseded offline package files."""

    __tablename__ = "offline_package_leases"

    storage_uri: Mapped[str] = mapped_column(Text, primary_key=True)
    lease_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


Index("idx_offline_package_leases_expiry", OfflinePackageLease.expires_at)
