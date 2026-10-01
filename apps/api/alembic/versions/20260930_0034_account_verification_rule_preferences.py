"""Separate registration approval/verification and personal noise preferences.

Revision ID: 20260930_0034
Revises: 20260927_0033
"""
import sqlalchemy as sa
from alembic import op

revision = "20260930_0034"
down_revision = "20260927_0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verification_required", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("approval_status", sa.String(16), nullable=False, server_default="APPROVED"))
    op.execute("UPDATE users SET approval_status = 'PENDING' WHERE status = 'PENDING'")
    op.execute("UPDATE users SET approval_status = 'REJECTED' WHERE status = 'DISABLED' AND approval_reviewed_at IS NOT NULL")
    op.create_check_constraint("ck_users_approval_status", "users", "approval_status IN ('APPROVED', 'PENDING', 'REJECTED')")
    op.create_table(
        "email_verification_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(24), nullable=False),
        sa.Column("target_email", sa.String(320), nullable=False),
        sa.Column("credential_version", sa.Integer(), nullable=False),
        sa.Column("token_digest", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("purpose IN ('REGISTER', 'EMAIL_CHANGE')", name="ck_email_verification_purpose"),
    )
    op.create_index("idx_email_verification_user_purpose", "email_verification_grants", ["user_id", "purpose"])
    op.create_table(
        "content_cleanup_rule_preferences",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("content_cleanup_rules.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("content_cleanup_rule_preferences")
    op.drop_table("email_verification_grants")
    op.drop_constraint("ck_users_approval_status", "users", type_="check")
    op.drop_column("users", "approval_status")
    op.drop_column("users", "email_verification_required")
