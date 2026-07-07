"""create search documents and headings

Revision ID: 20260707_0004
Revises: 20260707_0003
Create Date: 2026-07-07 00:04:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260707_0004"
down_revision: str | None = "20260707_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "search_documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=True),
        sa.Column("message_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("message_versions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("document_type", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=True),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column("search_text", sa.Text(), nullable=False),
        sa.Column("source_type", sa.Text(), nullable=True),
        sa.Column("source_profile", sa.Text(), nullable=True),
        sa.Column("order_key", sa.Text(), nullable=True),
        sa.Column("turn_index", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("search_tsv", postgresql.TSVECTOR(), nullable=True),
    )
    op.create_index("idx_search_documents_conversation_id", "search_documents", ["conversation_id"])
    op.create_index("idx_search_documents_message_id", "search_documents", ["message_id"])
    op.create_index("idx_search_documents_message_version_id", "search_documents", ["message_version_id"])
    op.create_index("idx_search_documents_document_type", "search_documents", ["document_type"])
    op.create_index("idx_search_documents_role", "search_documents", ["role"])
    op.create_index("idx_search_documents_source_profile", "search_documents", ["source_profile"])
    op.create_index("idx_search_documents_indexed_at", "search_documents", ["indexed_at"])
    op.create_index("idx_search_documents_search_tsv", "search_documents", ["search_tsv"], postgresql_using="gin")

    op.create_table(
        "headings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("message_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("render_block_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("render_blocks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("block_index", sa.Integer(), nullable=False),
        sa.Column("heading_index", sa.Integer(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("order_key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.UniqueConstraint("conversation_id", "heading_index", name="uq_headings_conversation_heading_index"),
    )
    op.create_index("idx_headings_conversation_id", "headings", ["conversation_id"])
    op.create_index("idx_headings_message_id", "headings", ["message_id"])
    op.create_index("idx_headings_message_version_id", "headings", ["message_version_id"])
    op.create_index("idx_headings_render_block_id", "headings", ["render_block_id"])
    op.create_index("idx_headings_level", "headings", ["level"])
    op.create_index("idx_headings_heading_index", "headings", ["heading_index"])
    op.create_index("idx_headings_order_key", "headings", ["order_key"])


def downgrade() -> None:
    op.drop_index("idx_headings_order_key", table_name="headings")
    op.drop_index("idx_headings_heading_index", table_name="headings")
    op.drop_index("idx_headings_level", table_name="headings")
    op.drop_index("idx_headings_render_block_id", table_name="headings")
    op.drop_index("idx_headings_message_version_id", table_name="headings")
    op.drop_index("idx_headings_message_id", table_name="headings")
    op.drop_index("idx_headings_conversation_id", table_name="headings")
    op.drop_table("headings")

    op.drop_index("idx_search_documents_search_tsv", table_name="search_documents")
    op.drop_index("idx_search_documents_indexed_at", table_name="search_documents")
    op.drop_index("idx_search_documents_source_profile", table_name="search_documents")
    op.drop_index("idx_search_documents_role", table_name="search_documents")
    op.drop_index("idx_search_documents_document_type", table_name="search_documents")
    op.drop_index("idx_search_documents_message_version_id", table_name="search_documents")
    op.drop_index("idx_search_documents_message_id", table_name="search_documents")
    op.drop_index("idx_search_documents_conversation_id", table_name="search_documents")
    op.drop_table("search_documents")
