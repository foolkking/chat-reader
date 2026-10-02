"""Durable account-scoped additive archive restore receipts.

Revision ID: 20261001_0041
Revises: 20261001_0040
"""
from alembic import op
import sqlalchemy as sa

revision = "20261001_0041"
down_revision = "20261001_0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("archive_restore_receipts",
        sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("content_digest", sa.String(64), primary_key=True),
        sa.Column("restore_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    op.drop_table("archive_restore_receipts")
