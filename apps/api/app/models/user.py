import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.import_record import utc_now


class User(Base):
    """Account identity and ownership subject for private resources."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('ADMIN', 'USER')", name="ck_users_role"),
        CheckConstraint("status IN ('ACTIVE', 'DISABLED', 'PENDING')", name="ck_users_status"),
        CheckConstraint("approval_status IN ('APPROVED', 'PENDING', 'REJECTED')", name="ck_users_approval_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    normalized_email: Mapped[str | None] = mapped_column(String(320), nullable=True, unique=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="USER")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    credential_version: Mapped[int] = mapped_column(nullable=False, default=1)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    email_verification_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    approval_status: Mapped[str] = mapped_column(String(16), nullable=False, default="APPROVED", server_default="APPROVED")
    approval_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)

    principal = relationship("AuthPrincipal", back_populates="user", uselist=False)

    @property
    def registration_requirements_met(self) -> bool:
        return self.approval_status == "APPROVED" and (
            not self.email_verification_required or self.email_verified_at is not None
        )

    @property
    def can_login(self) -> bool:
        return self.status == "ACTIVE" and self.registration_requirements_met


Index("idx_users_status_created", User.status, User.created_at)
Index("idx_users_last_login", User.last_login_at)
