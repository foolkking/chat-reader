"""create shares

Revision ID: 20260707_0005
Revises: 20260707_0004
Create Date: 2026-07-07 00:05:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260707_0005"
down_revision: str | None = "20260707_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column("token_prefix", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("scope", sa.Text(), nullable=False, server_default="conversation"),
        sa.Column("selected_message_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("include_toc", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("include_metadata", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("allow_export", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("access_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.Text(), nullable=False, server_default="local"),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_index("idx_shares_conversation_id", "shares", ["conversation_id"])
    op.create_index("idx_shares_token_hash", "shares", ["token_hash"])
    op.create_index("idx_shares_token_prefix", "shares", ["token_prefix"])
    op.create_index("idx_shares_expires_at", "shares", ["expires_at"])
    op.create_index("idx_shares_revoked_at", "shares", ["revoked_at"])
    op.create_index("idx_shares_created_at", "shares", ["created_at"])
    op.create_index("idx_shares_last_accessed_at", "shares", ["last_accessed_at"])


def downgrade() -> None:
    op.drop_index("idx_shares_last_accessed_at", table_name="shares")
    op.drop_index("idx_shares_created_at", table_name="shares")
    op.drop_index("idx_shares_revoked_at", table_name="shares")
    op.drop_index("idx_shares_expires_at", table_name="shares")
    op.drop_index("idx_shares_token_prefix", table_name="shares")
    op.drop_index("idx_shares_token_hash", table_name="shares")
    op.drop_index("idx_shares_conversation_id", table_name="shares")
    op.drop_table("shares")
