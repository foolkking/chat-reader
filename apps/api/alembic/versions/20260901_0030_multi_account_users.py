"""Add account identities while preserving the legacy owner principal.

Revision ID: 20260901_0030
Revises: 20260829_0029
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0030"
down_revision: str | None = "20260829_0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A stable migration value makes the owner backfill idempotent. It is not a
# credential and is replaced by a generated UUID for newly registered users.
LEGACY_OWNER_USER_ID = "2dfb6c9e-4b25-4f67-9f5e-4b87f1d8ad01"


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("normalized_email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=200), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False, server_default="USER"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
        sa.Column("credential_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("role IN ('ADMIN', 'USER')", name="ck_users_role"),
        sa.CheckConstraint("status IN ('ACTIVE', 'DISABLED')", name="ck_users_status"),
        sa.UniqueConstraint("normalized_email", name="uq_users_normalized_email"),
    )
    op.create_index("idx_users_status_created", "users", ["status", "created_at"])
    op.add_column("auth_principals", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.add_column(
        "auth_sessions",
        sa.Column("device_label", sa.String(length=120), nullable=False, server_default="Unknown device"),
    )
    op.create_unique_constraint("uq_auth_principals_user_id", "auth_principals", ["user_id"])
    op.create_foreign_key(
        "fk_auth_principals_user_id",
        "auth_principals",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Existing single-owner deployments retain the same password hash and
    # principal id. The owner becomes an ADMIN identity exactly once before
    # any private-resource ownership is backfilled.
    op.execute(
        sa.text(
            """
            INSERT INTO users (id, normalized_email, display_name, role, status,
                               credential_version, created_at, updated_at)
            SELECT :user_id, NULL, 'Administrator', 'ADMIN', 'ACTIVE',
                   credential_version, created_at, updated_at
            FROM auth_principals
            WHERE id = 'owner'
              AND NOT EXISTS (SELECT 1 FROM users)
            """
        ).bindparams(user_id=LEGACY_OWNER_USER_ID)
    )
    op.execute(
        sa.text(
            """
            UPDATE auth_principals
            SET user_id = :user_id
            WHERE id = 'owner' AND user_id IS NULL
            """
        ).bindparams(user_id=LEGACY_OWNER_USER_ID)
    )
    for table_name in ("projects", "conversations", "imports", "background_jobs", "import_profiles"):
        op.add_column(table_name, sa.Column("owner_user_id", sa.Uuid(), nullable=True))
        op.create_foreign_key(
            f"fk_{table_name}_owner_user_id",
            table_name,
            "users",
            ["owner_user_id"],
            ["id"],
            ondelete="CASCADE",
        )

    for table_name in ("projects", "conversations", "imports", "background_jobs"):
        op.execute(
            sa.text(f"UPDATE {table_name} SET owner_user_id = :user_id WHERE owner_user_id IS NULL")
            .bindparams(user_id=LEGACY_OWNER_USER_ID)
        )
        op.alter_column(table_name, "owner_user_id", nullable=False)
    op.execute(
        sa.text(
            "UPDATE import_profiles SET owner_user_id = :user_id "
            "WHERE owner_user_id IS NULL AND kind <> 'BUILTIN'"
        ).bindparams(user_id=LEGACY_OWNER_USER_ID)
    )
    # Account-scoped preference/annotation/reading records historically used
    # the process-wide local subject. Bind that legacy subject to the one
    # migrated administrator before new accounts receive UUID subjects.
    for table_name in (
        "user_preferences",
        "user_skills",
        "user_skill_selections",
        "reading_positions",
        "conversation_annotations",
        "conversation_notebooks",
        "annotation_sync_receipts",
        "offline_package_artifacts",
    ):
        op.execute(
            sa.text(f"UPDATE {table_name} SET subject_key = :subject WHERE subject_key = 'local:default'").bindparams(
                subject=LEGACY_OWNER_USER_ID
            )
        )
    # User-created cleanup rules and scans are private account configuration;
    # built-in rules remain global with a NULL owner.
    op.add_column("content_cleanup_rules", sa.Column("owner_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_content_cleanup_rules_owner_user_id",
        "content_cleanup_rules",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(
        sa.text(
            "UPDATE content_cleanup_rules SET owner_user_id = :user_id "
            "WHERE owner_user_id IS NULL AND kind <> 'BUILTIN'"
        ).bindparams(user_id=LEGACY_OWNER_USER_ID)
    )
    op.create_index(
        "idx_content_cleanup_rules_owner_status",
        "content_cleanup_rules",
        ["owner_user_id", "status"],
    )
    op.add_column("content_cleanup_scans", sa.Column("owner_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_content_cleanup_scans_owner_user_id",
        "content_cleanup_scans",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(
        sa.text(
            "UPDATE content_cleanup_scans s SET owner_user_id = c.owner_user_id "
            "FROM content_cleanup_scan_targets t JOIN conversations c ON c.id = t.conversation_id "
            "WHERE s.id = t.scan_id AND s.owner_user_id IS NULL"
        )
    )
    op.create_index(
        "idx_content_cleanup_scans_owner_status",
        "content_cleanup_scans",
        ["owner_user_id", "status"],
    )
    op.create_check_constraint(
        "ck_import_profiles_builtin_or_owned",
        "import_profiles",
        "kind = 'BUILTIN' OR owner_user_id IS NOT NULL",
    )
    op.drop_constraint("uq_projects_name", "projects", type_="unique")
    op.create_unique_constraint("uq_projects_owner_name", "projects", ["owner_user_id", "name"])
    op.create_index("idx_projects_owner_archive_order", "projects", ["owner_user_id", "is_archived", "sort_order"])
    op.create_index("idx_projects_owner_last_read", "projects", ["owner_user_id", "last_read_at"])
    op.create_index(
        "uq_projects_owner_default",
        "projects",
        ["owner_user_id"],
        unique=True,
        postgresql_where=sa.text("is_default = true"),
    )
    op.create_index("idx_conversations_owner_status_sort", "conversations", ["owner_user_id", "status", "sort_time"])
    op.create_index("idx_conversations_owner_manual_order", "conversations", ["owner_user_id", "manual_sort_order"])
    op.create_index("idx_imports_owner_status_queued", "imports", ["owner_user_id", "status", "queued_at"])
    op.create_index("idx_background_jobs_owner_status_queued", "background_jobs", ["owner_user_id", "status", "queued_at"])
    op.create_index("idx_background_jobs_owner_idempotency", "background_jobs", ["owner_user_id", "idempotency_key"])
    op.create_index("idx_import_profiles_owner_status_mode", "import_profiles", ["owner_user_id", "status", "source_mode"])

    op.create_table(
        "instance_access_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("registration_mode", sa.String(length=16), nullable=False, server_default="CLOSED"),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "account_invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["used_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index("idx_account_invitations_expiry", "account_invitations", ["expires_at", "revoked_at"])
    op.create_index("idx_account_invitations_creator", "account_invitations", ["created_by_user_id", "created_at"])
    op.create_table(
        "password_reset_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index("idx_password_reset_grants_user", "password_reset_grants", ["user_id", "created_at"])
    op.create_index("idx_password_reset_grants_expiry", "password_reset_grants", ["expires_at", "revoked_at"])
    op.create_table(
        "auth_rate_limits",
        sa.Column("scope_key", sa.String(length=64), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("scope_key"),
    )


def downgrade() -> None:
    op.drop_index("idx_content_cleanup_scans_owner_status", table_name="content_cleanup_scans")
    op.drop_constraint("fk_content_cleanup_scans_owner_user_id", "content_cleanup_scans", type_="foreignkey")
    op.drop_column("content_cleanup_scans", "owner_user_id")
    op.drop_index("idx_content_cleanup_rules_owner_status", table_name="content_cleanup_rules")
    op.drop_constraint("fk_content_cleanup_rules_owner_user_id", "content_cleanup_rules", type_="foreignkey")
    op.drop_column("content_cleanup_rules", "owner_user_id")
    op.drop_table("auth_rate_limits")
    op.drop_index("idx_password_reset_grants_expiry", table_name="password_reset_grants")
    op.drop_index("idx_password_reset_grants_user", table_name="password_reset_grants")
    op.drop_table("password_reset_grants")
    op.drop_index("idx_account_invitations_creator", table_name="account_invitations")
    op.drop_index("idx_account_invitations_expiry", table_name="account_invitations")
    op.drop_table("account_invitations")
    op.drop_table("instance_access_settings")
    op.drop_index("idx_import_profiles_owner_status_mode", table_name="import_profiles")
    op.drop_index("idx_background_jobs_owner_idempotency", table_name="background_jobs")
    op.drop_index("idx_background_jobs_owner_status_queued", table_name="background_jobs")
    op.drop_index("idx_imports_owner_status_queued", table_name="imports")
    op.drop_index("idx_conversations_owner_manual_order", table_name="conversations")
    op.drop_index("idx_conversations_owner_status_sort", table_name="conversations")
    op.drop_index("idx_projects_owner_last_read", table_name="projects")
    op.drop_index("uq_projects_owner_default", table_name="projects")
    op.drop_index("idx_projects_owner_archive_order", table_name="projects")
    op.drop_constraint("uq_projects_owner_name", "projects", type_="unique")
    op.create_unique_constraint("uq_projects_name", "projects", ["name"])
    op.drop_constraint("ck_import_profiles_builtin_or_owned", "import_profiles", type_="check")
    for table_name in ("import_profiles", "background_jobs", "imports", "conversations", "projects"):
        op.drop_constraint(f"fk_{table_name}_owner_user_id", table_name, type_="foreignkey")
        op.drop_column(table_name, "owner_user_id")
    for table_name in (
        "user_preferences",
        "user_skills",
        "user_skill_selections",
        "reading_positions",
        "conversation_annotations",
        "conversation_notebooks",
        "annotation_sync_receipts",
        "offline_package_artifacts",
    ):
        op.execute(
            sa.text(f"UPDATE {table_name} SET subject_key = 'local:default' WHERE subject_key = :subject")
            .bindparams(subject=LEGACY_OWNER_USER_ID)
        )
    op.drop_constraint("fk_auth_principals_user_id", "auth_principals", type_="foreignkey")
    op.drop_constraint("uq_auth_principals_user_id", "auth_principals", type_="unique")
    op.drop_column("auth_principals", "user_id")
    op.drop_column("auth_sessions", "device_label")
    op.drop_index("idx_users_status_created", table_name="users")
    op.drop_table("users")
