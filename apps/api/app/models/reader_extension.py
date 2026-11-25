"""Account-bound private extension credentials and source receipts; no raw credentials."""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Uuid, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExtensionDevice(Base):
    __tablename__ = "extension_devices"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client: Mapped[str] = mapped_column(String(32))
    credential_version: Mapped[int] = mapped_column(Integer)
    challenge: Mapped[str | None] = mapped_column(String(43))
    code_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    access_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    refresh_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    access_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    device_name: Mapped[str | None] = mapped_column(String(80))


class ExtensionPairing(Base):
    __tablename__ = "extension_pairings"
    secret_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    client: Mapped[str] = mapped_column(String(32))
    device_name: Mapped[str] = mapped_column(String(80))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    next_poll: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("extension_devices.id", ondelete="CASCADE"))


class ExtensionSource(Base):
    __tablename__ = "extension_sources"
    __table_args__ = (UniqueConstraint("owner_user_id", "source_key", name="uq_extension_owned_source"),)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    source_key: Mapped[str] = mapped_column(String(160))
    # A deleted target is a tombstone, never an invitation to silently reimport.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"))
    source_digest: Mapped[str] = mapped_column(String(64))
    canonical_digest: Mapped[str] = mapped_column(String(64))
    message_count: Mapped[int] = mapped_column(Integer)
