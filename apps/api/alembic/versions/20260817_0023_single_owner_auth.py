"""Add the single-owner credential and per-device sessions.

Revision ID: 20260817_0023
Revises: 20260816_0022
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260817_0023"
down_revision: str | None = "20260816_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auth_principals",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("credential_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("principal_id", sa.String(), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("credential_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["principal_id"], ["auth_principals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index(
        "idx_auth_sessions_principal_activity",
        "auth_sessions",
        ["principal_id", "last_activity_at"],
        unique=False,
    )
    op.create_table(
        "auth_login_throttles",
        sa.Column("principal_id", sa.String(), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["principal_id"], ["auth_principals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("principal_id"),
    )


def downgrade() -> None:
    op.drop_table("auth_login_throttles")
    op.drop_index("idx_auth_sessions_principal_activity", table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("auth_principals")
