"""create canonical conversation tables

Revision ID: 20260707_0002
Revises: 20260707_0001
Create Date: 2026-07-07 00:02:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260707_0002"
down_revision: str | None = "20260707_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("display_title", sa.Text(), nullable=False),
        sa.Column("source_type", sa.Text(), nullable=False),
        sa.Column("source_profile", sa.Text(), nullable=False),
        sa.Column("external_source_id", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("message_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("turn_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_user_message", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("parser_version", sa.Text(), nullable=False),
        sa.Column("render_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("content_hash", sa.Text(), nullable=True),
        sa.Column("sort_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_global_pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("global_pinned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("idx_conversations_source_type", "conversations", ["source_type"])
    op.create_index("idx_conversations_source_profile", "conversations", ["source_profile"])
    op.create_index("idx_conversations_external_source_id", "conversations", ["external_source_id"])
    op.create_index("idx_conversations_sort_time", "conversations", ["sort_time"])
    op.create_index("idx_conversations_imported_at", "conversations", ["imported_at"])
    op.create_index("idx_conversations_status", "conversations", ["status"])

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("author_label", sa.Text(), nullable=True),
        sa.Column("order_key", sa.Text(), nullable=False),
        sa.Column("turn_index", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_in_system_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("current_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Text(), nullable=True),
        sa.Column("delete_reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=False, server_default="import"),
        sa.Column("source_type", sa.Text(), nullable=False, server_default="import"),
        sa.Column("content_hash", sa.Text(), nullable=True),
        sa.Column("estimated_height", sa.Integer(), nullable=True),
        sa.Column("measured_height", sa.Integer(), nullable=True),
        sa.Column("block_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("char_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_heavy", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.UniqueConstraint("conversation_id", "order_key", name="uq_messages_conversation_order_key"),
    )
    op.create_index("idx_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("idx_messages_role", "messages", ["role"])
    op.create_index("idx_messages_created_at", "messages", ["created_at"])
    op.create_index("idx_messages_content_hash", "messages", ["content_hash"])
    op.create_index("idx_messages_is_deleted", "messages", ["is_deleted"])

    op.create_table(
        "message_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column("display_text", sa.Text(), nullable=False),
        sa.Column("blocks", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("edit_type", sa.Text(), nullable=False),
        sa.Column("edit_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.Text(), nullable=False, server_default="import"),
        sa.Column("based_on_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.UniqueConstraint("message_id", "version_number", name="uq_message_versions_message_version"),
    )
    op.create_index("idx_message_versions_message_id", "message_versions", ["message_id"])
    op.create_index("idx_message_versions_content_hash", "message_versions", ["content_hash"])
    op.create_index("idx_message_versions_edit_type", "message_versions", ["edit_type"])

    op.create_table(
        "render_blocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("message_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("block_index", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.Text(), nullable=False),
        sa.Column("plain_text", sa.Text(), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("sanitized_html", sa.Text(), nullable=True),
        sa.Column("char_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("estimated_height", sa.Integer(), nullable=True),
        sa.Column("measured_height", sa.Integer(), nullable=True),
        sa.Column("collapsed_by_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("render_priority", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("message_version_id", "block_index", name="uq_render_blocks_version_index"),
    )
    op.create_index("idx_render_blocks_message_version_id", "render_blocks", ["message_version_id"])
    op.create_index("idx_render_blocks_block_type", "render_blocks", ["block_type"])

    op.create_table(
        "source_message_refs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.Text(), nullable=False),
        sa.Column("source_profile", sa.Text(), nullable=False),
        sa.Column("source_conversation_id", sa.Text(), nullable=True),
        sa.Column("source_node_id", sa.Text(), nullable=True),
        sa.Column("source_message_id", sa.Text(), nullable=True),
        sa.Column("source_json_index", sa.Integer(), nullable=True),
        sa.Column("source_markdown_index", sa.Integer(), nullable=True),
        sa.Column("parent_node_id", sa.Text(), nullable=True),
        sa.Column("child_node_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_primary_path", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("branch_index", sa.Integer(), nullable=True),
        sa.Column("raw_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_source_message_refs_message_id", "source_message_refs", ["message_id"])
    op.create_index("idx_source_message_refs_source_profile", "source_message_refs", ["source_profile"])
    op.create_index("idx_source_message_refs_source_node_id", "source_message_refs", ["source_node_id"])
    op.create_index("idx_source_message_refs_source_message_id", "source_message_refs", ["source_message_id"])
    op.create_index("idx_source_message_refs_is_primary_path", "source_message_refs", ["is_primary_path"])

    op.create_table(
        "conversation_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("target_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("target_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_by", sa.Text(), nullable=False, server_default="system"),
    )
    op.create_index("idx_conversation_events_conversation_id", "conversation_events", ["conversation_id"])
    op.create_index("idx_conversation_events_event_type", "conversation_events", ["event_type"])

    op.add_column("imports", sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("imports", sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key("fk_imports_conversation_id", "imports", "conversations", ["conversation_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_imports_conversation_id", "imports", type_="foreignkey")
    op.drop_column("imports", "committed_at")
    op.drop_column("imports", "conversation_id")
    op.drop_index("idx_conversation_events_event_type", table_name="conversation_events")
    op.drop_index("idx_conversation_events_conversation_id", table_name="conversation_events")
    op.drop_table("conversation_events")
    op.drop_index("idx_source_message_refs_is_primary_path", table_name="source_message_refs")
    op.drop_index("idx_source_message_refs_source_message_id", table_name="source_message_refs")
    op.drop_index("idx_source_message_refs_source_node_id", table_name="source_message_refs")
    op.drop_index("idx_source_message_refs_source_profile", table_name="source_message_refs")
    op.drop_index("idx_source_message_refs_message_id", table_name="source_message_refs")
    op.drop_table("source_message_refs")
    op.drop_index("idx_render_blocks_block_type", table_name="render_blocks")
    op.drop_index("idx_render_blocks_message_version_id", table_name="render_blocks")
    op.drop_table("render_blocks")
    op.drop_index("idx_message_versions_edit_type", table_name="message_versions")
    op.drop_index("idx_message_versions_content_hash", table_name="message_versions")
    op.drop_index("idx_message_versions_message_id", table_name="message_versions")
    op.drop_table("message_versions")
    op.drop_index("idx_messages_is_deleted", table_name="messages")
    op.drop_index("idx_messages_content_hash", table_name="messages")
    op.drop_index("idx_messages_created_at", table_name="messages")
    op.drop_index("idx_messages_role", table_name="messages")
    op.drop_index("idx_messages_conversation_id", table_name="messages")
    op.drop_table("messages")
    op.drop_index("idx_conversations_status", table_name="conversations")
    op.drop_index("idx_conversations_imported_at", table_name="conversations")
    op.drop_index("idx_conversations_sort_time", table_name="conversations")
    op.drop_index("idx_conversations_external_source_id", table_name="conversations")
    op.drop_index("idx_conversations_source_profile", table_name="conversations")
    op.drop_index("idx_conversations_source_type", table_name="conversations")
    op.drop_table("conversations")
