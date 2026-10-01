"""Exact, revision-bound personal noise exceptions.

Revision ID: 20260930_0037
Revises: 20260930_0036
"""
import sqlalchemy as sa
from alembic import op

revision = "20260930_0037"
down_revision = "20260930_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("content_cleanup_exceptions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_revision_id", sa.Uuid(), sa.ForeignKey("content_cleanup_rule_revisions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_digest", sa.String(64), nullable=False),
        sa.Column("role", sa.String(24), nullable=False),
        sa.Column("match_value", sa.Text(), nullable=False),
        sa.Column("context_before", sa.Text(), nullable=False),
        sa.Column("context_after", sa.Text(), nullable=False),
        sa.Column("at_start", sa.Boolean(), nullable=False),
        sa.Column("at_end", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "scope_digest", name="uq_cleanup_exception_owner_scope"))
    op.create_index("ix_content_cleanup_exceptions_rule_revision_id", "content_cleanup_exceptions", ["rule_revision_id"])


def downgrade() -> None:
    op.drop_table("content_cleanup_exceptions")
