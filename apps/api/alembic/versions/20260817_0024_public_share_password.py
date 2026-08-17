"""Add independent optional password protection for public Share capabilities.

Revision ID: 20260817_0024
Revises: 20260817_0023
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260817_0024"
down_revision: str | None = "20260817_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("shares", sa.Column("password_hash", sa.Text(), nullable=True))
    op.add_column("shares", sa.Column("password_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("shares", sa.Column("unlock_failed_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("shares", sa.Column("unlock_blocked_until", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("shares", "password_version", server_default=None)
    op.alter_column("shares", "unlock_failed_attempts", server_default=None)
    op.create_table(
        "share_unlock_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("share_id", sa.Uuid(), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("password_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["share_id"], ["shares.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index("idx_share_unlock_sessions_share", "share_unlock_sessions", ["share_id", "revoked_at"])
    op.create_index("idx_share_unlock_sessions_activity", "share_unlock_sessions", ["last_activity_at"])


def downgrade() -> None:
    op.drop_index("idx_share_unlock_sessions_activity", table_name="share_unlock_sessions")
    op.drop_index("idx_share_unlock_sessions_share", table_name="share_unlock_sessions")
    op.drop_table("share_unlock_sessions")
    op.drop_column("shares", "unlock_blocked_until")
    op.drop_column("shares", "unlock_failed_attempts")
    op.drop_column("shares", "password_version")
    op.drop_column("shares", "password_hash")
