import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.import_record import utc_now


class AuthPrincipal(Base):
    __tablename__ = "auth_principals"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    deployment_config_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    credential_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )

    user = relationship("User", back_populates="principal")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    principal_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_principals.id", ondelete="CASCADE"), nullable=False
    )
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    credential_version: Mapped[int] = mapped_column(Integer, nullable=False)
    device_label: Mapped[str] = mapped_column(String(120), nullable=False, default="Unknown device")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    principal = relationship("AuthPrincipal")


Index("idx_auth_sessions_principal_activity", AuthSession.principal_id, AuthSession.last_activity_at)


class AuthLoginThrottle(Base):
    __tablename__ = "auth_login_throttles"

    principal_id: Mapped[str] = mapped_column(
        String, ForeignKey("auth_principals.id", ondelete="CASCADE"), primary_key=True
    )
    failed_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


class AuthRateLimit(Base):
    __tablename__ = "auth_rate_limits"

    scope_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
