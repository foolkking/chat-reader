"""Add root administration policy and audit foundations.

Revision ID: 20260902_0032
Revises: 20260901_0031
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_0032"
down_revision: str | None = "20260901_0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Account lifecycle and approval metadata.  Existing accounts retain their
    # status; approval is opt-in at the instance setting level.
    op.drop_constraint("ck_users_status", "users", type_="check")
    op.create_check_constraint(
        "ck_users_status", "users", "status IN ('ACTIVE', 'DISABLED', 'PENDING')"
    )
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("approval_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("approval_reviewed_by_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_users_approval_reviewer",
        "users",
        "users",
        ["approval_reviewed_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_users_last_login", "users", ["last_login_at"])

    op.add_column(
        "instance_access_settings",
        sa.Column("require_admin_approval", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "instance_access_settings",
        sa.Column("email_verification_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "instance_access_settings",
        sa.Column("password_reset_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), nullable=True),
        sa.Column("resource_type", sa.String(length=64), nullable=True),
        sa.Column("resource_id", sa.String(length=160), nullable=True),
        sa.Column("result", sa.String(length=16), nullable=False, server_default="SUCCESS"),
        sa.Column("metadata", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("request_id", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("result IN ('SUCCESS', 'FAILURE', 'DENIED')", name="ck_admin_audit_logs_result"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_admin_audit_actor_created", "admin_audit_logs", ["actor_user_id", "created_at"])
    op.create_index("idx_admin_audit_target_created", "admin_audit_logs", ["target_user_id", "created_at"])
    op.create_index("idx_admin_audit_action_created", "admin_audit_logs", ["action", "created_at"])
    op.create_index(
        "idx_admin_audit_resource_created",
        "admin_audit_logs",
        ["resource_type", "resource_id", "created_at"],
    )

    op.create_table(
        "system_skills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("skill_key", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("source_kind", sa.String(length=24), nullable=False),
        sa.Column("bundled_key", sa.String(length=160), nullable=True),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("content_digest", sa.String(length=64), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
        sa.Column("default_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("source_kind IN ('BUNDLED', 'ADMIN_CREATED')", name="ck_system_skills_source_kind"),
        sa.CheckConstraint("status IN ('ACTIVE', 'DISABLED')", name="ck_system_skills_status"),
        sa.CheckConstraint(
            "(source_kind = 'BUNDLED' AND bundled_key IS NOT NULL) OR "
            "(source_kind = 'ADMIN_CREATED' AND bundled_key IS NULL AND content IS NOT NULL)",
            name="ck_system_skills_source_shape",
        ),
        sa.CheckConstraint(
            "(content IS NULL AND content_digest IS NULL AND byte_size IS NULL) OR "
            "(content IS NOT NULL AND content_digest IS NOT NULL AND byte_size > 0)",
            name="ck_system_skills_content_shape",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("bundled_key", name="uq_system_skills_bundled_key"),
        sa.UniqueConstraint("skill_key", name="uq_system_skills_key"),
    )
    op.create_index(
        "idx_system_skills_category_locale_status", "system_skills", ["category", "locale", "status"]
    )

    op.create_table(
        "instance_feature_policies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("allow_share_links", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_public_share", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_share_password", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_user_skills", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_skill_import", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_user_import", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("maximum_import_size_mb", sa.Integer(), nullable=False, server_default="512"),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_instance_feature_policies_singleton"),
        sa.CheckConstraint("maximum_import_size_mb > 0", name="ck_instance_feature_policies_import_size"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "system_backup_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("operation", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="QUEUED"),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("background_job_id", sa.Uuid(), nullable=True),
        sa.Column("source_backup_id", sa.Uuid(), nullable=True),
        sa.Column("artifact_name", sa.String(length=255), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("content_digest", sa.String(length=64), nullable=True),
        sa.Column("summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("operation IN ('BACKUP', 'RESTORE')", name="ck_system_backup_records_operation"),
        sa.CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_system_backup_records_status",
        ),
        sa.CheckConstraint("byte_size IS NULL OR byte_size >= 0", name="ck_system_backup_records_byte_size"),
        sa.ForeignKeyConstraint(["background_job_id"], ["background_jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_backup_id"], ["system_backup_records.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("background_job_id", name="uq_system_backup_records_job"),
    )
    op.create_index("idx_system_backup_records_created", "system_backup_records", ["created_at"])
    op.create_index(
        "idx_system_backup_records_status_created", "system_backup_records", ["status", "created_at"]
    )

    op.create_table(
        "user_deletion_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), nullable=False),
        sa.Column("requested_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("background_job_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="QUEUED"),
        sa.Column("impact_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("result_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')",
            name="ck_user_deletion_requests_status",
        ),
        sa.ForeignKeyConstraint(["background_job_id"], ["background_jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("background_job_id", name="uq_user_deletion_requests_job"),
    )
    op.create_index(
        "idx_user_deletion_requests_target_created", "user_deletion_requests", ["target_user_id", "created_at"]
    )
    op.create_index(
        "idx_user_deletion_requests_status_created", "user_deletion_requests", ["status", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("idx_user_deletion_requests_status_created", table_name="user_deletion_requests")
    op.drop_index("idx_user_deletion_requests_target_created", table_name="user_deletion_requests")
    op.drop_table("user_deletion_requests")
    op.drop_index("idx_system_backup_records_status_created", table_name="system_backup_records")
    op.drop_index("idx_system_backup_records_created", table_name="system_backup_records")
    op.drop_table("system_backup_records")
    op.drop_table("instance_feature_policies")
    op.drop_index("idx_system_skills_category_locale_status", table_name="system_skills")
    op.drop_table("system_skills")
    op.drop_index("idx_admin_audit_resource_created", table_name="admin_audit_logs")
    op.drop_index("idx_admin_audit_action_created", table_name="admin_audit_logs")
    op.drop_index("idx_admin_audit_target_created", table_name="admin_audit_logs")
    op.drop_index("idx_admin_audit_actor_created", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")

    op.drop_column("instance_access_settings", "password_reset_enabled")
    op.drop_column("instance_access_settings", "email_verification_enabled")
    op.drop_column("instance_access_settings", "require_admin_approval")
    op.drop_index("idx_users_last_login", table_name="users")
    op.drop_constraint("fk_users_approval_reviewer", "users", type_="foreignkey")
    op.drop_column("users", "approval_reviewed_by_user_id")
    op.drop_column("users", "approval_reviewed_at")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "last_login_at")
    op.drop_constraint("ck_users_status", "users", type_="check")
    op.create_check_constraint("ck_users_status", "users", "status IN ('ACTIVE', 'DISABLED')")
