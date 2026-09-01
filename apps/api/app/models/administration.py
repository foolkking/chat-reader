"""Instance administration records owned exclusively by the root admin path.

These tables store policy and operational metadata.  They deliberately do not
store passwords, session/invitation tokens, conversation bodies, attachment
bytes, or a second administrator role assignment.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.core.database import Base
from app.models.import_record import utc_now


class AdminAuditLog(Base):
    """Append-only security event metadata for privileged actions.

    ``target_user_id`` intentionally has no foreign key: it is an immutable ID
    snapshot that must remain auditable after an approved user deletion.
    """

    __tablename__ = "admin_audit_logs"
    __table_args__ = (
        CheckConstraint("result IN ('SUCCESS', 'FAILURE', 'DENIED')", name="ck_admin_audit_logs_result"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    result: Mapped[str] = mapped_column(String(16), nullable=False, default="SUCCESS")
    event_metadata: Mapped[dict] = mapped_column("metadata", JSON, nullable=False, default=dict)
    request_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


Index("idx_admin_audit_actor_created", AdminAuditLog.actor_user_id, AdminAuditLog.created_at)
Index("idx_admin_audit_target_created", AdminAuditLog.target_user_id, AdminAuditLog.created_at)
Index("idx_admin_audit_action_created", AdminAuditLog.action, AdminAuditLog.created_at)
Index(
    "idx_admin_audit_resource_created",
    AdminAuditLog.resource_type,
    AdminAuditLog.resource_id,
    AdminAuditLog.created_at,
)


class SystemSkill(Base):
    """Admin policy and optional content layered over a bundled Skill.

    A BUNDLED row points to an immutable application-registry key.  ``content``
    is nullable and, when present, is an administrator override; restoring the
    bundled version clears the content triplet.  ADMIN_CREATED rows always own
    their content and may be deleted through the future admin service.
    """

    __tablename__ = "system_skills"
    __table_args__ = (
        UniqueConstraint("skill_key", name="uq_system_skills_key"),
        UniqueConstraint("bundled_key", name="uq_system_skills_bundled_key"),
        CheckConstraint("source_kind IN ('BUNDLED', 'ADMIN_CREATED')", name="ck_system_skills_source_kind"),
        CheckConstraint("status IN ('ACTIVE', 'DISABLED')", name="ck_system_skills_status"),
        CheckConstraint(
            "(source_kind = 'BUNDLED' AND bundled_key IS NOT NULL) OR "
            "(source_kind = 'ADMIN_CREATED' AND bundled_key IS NULL AND content IS NOT NULL)",
            name="ck_system_skills_source_shape",
        ),
        CheckConstraint(
            "(content IS NULL AND content_digest IS NULL AND byte_size IS NULL) OR "
            "(content IS NOT NULL AND content_digest IS NOT NULL AND byte_size > 0)",
            name="ck_system_skills_content_shape",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    skill_key: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    locale: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    bundled_key: Mapped[str | None] = mapped_column(String(160), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ACTIVE")
    default_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


Index("idx_system_skills_category_locale_status", SystemSkill.category, SystemSkill.locale, SystemSkill.status)


class InstanceFeaturePolicy(Base):
    """Singleton instance-level feature gates; owner choices remain separate."""

    __tablename__ = "instance_feature_policies"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_instance_feature_policies_singleton"),
        CheckConstraint("maximum_import_size_mb > 0", name="ck_instance_feature_policies_import_size"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    allow_share_links: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_public_share: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_share_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_user_skills: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_skill_import: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    allow_user_import: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    maximum_import_size_mb: Mapped[int] = mapped_column(Integer, nullable=False, default=512)
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class SystemBackupRecord(Base):
    """Durable record of an instance backup or restore operation."""

    __tablename__ = "system_backup_records"
    __table_args__ = (
        UniqueConstraint("background_job_id", name="uq_system_backup_records_job"),
        CheckConstraint("operation IN ('BACKUP', 'RESTORE')", name="ck_system_backup_records_operation"),
        CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_system_backup_records_status",
        ),
        CheckConstraint("byte_size IS NULL OR byte_size >= 0", name="ck_system_backup_records_byte_size"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="QUEUED")
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    background_job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("background_jobs.id", ondelete="SET NULL"), nullable=True
    )
    source_backup_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("system_backup_records.id", ondelete="SET NULL"), nullable=True
    )
    artifact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    content_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


Index("idx_system_backup_records_created", SystemBackupRecord.created_at)
Index("idx_system_backup_records_status_created", SystemBackupRecord.status, SystemBackupRecord.created_at)


class UserDeletionRequest(Base):
    """Metadata coordinating destructive account deletion through a job.

    The target UUID is a historical snapshot rather than a foreign key so the
    completion record survives deletion.  Impact/result JSON is restricted by
    service contract to counts and resource IDs, never private content.
    """

    __tablename__ = "user_deletion_requests"
    __table_args__ = (
        UniqueConstraint("background_job_id", name="uq_user_deletion_requests_job"),
        CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_user_deletion_requests_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    requested_by_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    background_job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("background_jobs.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="QUEUED")
    impact_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    result_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )


Index("idx_user_deletion_requests_target_created", UserDeletionRequest.target_user_id, UserDeletionRequest.created_at)
Index("idx_user_deletion_requests_status_created", UserDeletionRequest.status, UserDeletionRequest.created_at)
