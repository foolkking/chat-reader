"""Private account requests and explicit administrator limit increases."""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.import_record import utc_now


class SupportRequest(Base):
    __tablename__ = "support_requests"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "creation_key", name="uq_support_request_creation"),
        CheckConstraint("kind IN ('LIMIT', 'QUESTION', 'ISSUE')", name="ck_support_request_kind"),
        CheckConstraint("status IN ('OPEN', 'WAITING', 'APPROVED', 'REJECTED', 'RESOLVED', 'WITHDRAWN', 'IMPORTED')", name="ck_support_request_status"),
        CheckConstraint("revision >= 1", name="ck_support_request_revision"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    requested_limits: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    approved_limits: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    notify_replies: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    creation_key: Mapped[str] = mapped_column(String(100), nullable=False)
    creation_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class SupportMessage(Base):
    __tablename__ = "support_messages"
    __table_args__ = (
        UniqueConstraint("request_id", "operation_key", name="uq_support_message_operation"),
        CheckConstraint("author_role IN ('USER', 'ADMIN', 'IMPORTED')", name="ck_support_message_author"),
        CheckConstraint("mail_state IN ('NOT_REQUESTED', 'UNAVAILABLE', 'QUEUED', 'SENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN')", name="ck_support_message_mail_state"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    request_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("support_requests.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    author_role: Mapped[str] = mapped_column(String(16), nullable=False)
    operation: Mapped[str] = mapped_column(String(16), nullable=False, default="REPLY")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    operation_key: Mapped[str] = mapped_column(String(100), nullable=False)
    operation_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    mail_state: Mapped[str] = mapped_column(String(20), nullable=False, default="NOT_REQUESTED")
    notification_job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("background_jobs.id", ondelete="SET NULL"))
    notification_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class UserLimitOverride(Base):
    __tablename__ = "user_limit_overrides"
    __table_args__ = (
        CheckConstraint("import_size_mb IS NULL OR (import_size_mb >= 1 AND import_size_mb <= 10240)", name="ck_user_limit_import"),
        CheckConstraint("merge_message_count IS NULL OR (merge_message_count >= 2 AND merge_message_count <= 100000)", name="ck_user_limit_merge"),
        CheckConstraint("revision >= 1", name="ck_user_limit_revision"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    import_size_mb: Mapped[int | None] = mapped_column(Integer)
    merge_message_count: Mapped[int | None] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"))
    last_operation_key: Mapped[str | None] = mapped_column(String(100))
    last_operation_digest: Mapped[str | None] = mapped_column(String(64))
    change_reason: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


Index("idx_support_owner_updated", SupportRequest.owner_user_id, SupportRequest.updated_at, SupportRequest.id)
Index("idx_support_status_updated", SupportRequest.status, SupportRequest.updated_at, SupportRequest.id)
Index("idx_support_messages_request", SupportMessage.request_id, SupportMessage.created_at, SupportMessage.id)
Index("idx_support_messages_author", SupportMessage.author_user_id, SupportMessage.created_at)
