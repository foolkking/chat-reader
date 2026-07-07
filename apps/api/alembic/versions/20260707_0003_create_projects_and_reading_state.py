"""create projects and reading state

Revision ID: 20260707_0003
Revises: 20260707_0002
Create Date: 2026-07-07 00:03:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260707_0003"
down_revision: str | None = "20260707_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("color", sa.Text(), nullable=True),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("name", name="uq_projects_name"),
    )
    op.create_index("idx_projects_is_default", "projects", ["is_default"])
    op.create_index("idx_projects_is_archived", "projects", ["is_archived"])
    op.create_index("idx_projects_sort_order", "projects", ["sort_order"])
    op.create_index("idx_projects_created_at", "projects", ["created_at"])

    op.create_table(
        "project_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("added_by", sa.Text(), nullable=False, server_default="system"),
        sa.UniqueConstraint("project_id", "conversation_id", name="uq_project_conversations_project_conversation"),
    )
    op.create_index("idx_project_conversations_project_id", "project_conversations", ["project_id"])
    op.create_index("idx_project_conversations_conversation_id", "project_conversations", ["conversation_id"])
    op.create_index("idx_project_conversations_is_pinned", "project_conversations", ["is_pinned"])
    op.create_index("idx_project_conversations_pinned_at", "project_conversations", ["pinned_at"])
    op.create_index("idx_project_conversations_added_at", "project_conversations", ["added_at"])
    op.create_index("idx_project_conversations_sort_order", "project_conversations", ["sort_order"])

    op.create_table(
        "reading_positions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("block_index", sa.Integer(), nullable=True),
        sa.Column("scroll_offset", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("anchor_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("conversation_id", name="uq_reading_positions_conversation"),
    )
    op.create_index("idx_reading_positions_conversation_id", "reading_positions", ["conversation_id"])
    op.create_index("idx_reading_positions_message_id", "reading_positions", ["message_id"])
    op.create_index("idx_reading_positions_updated_at", "reading_positions", ["updated_at"])

    op.create_table(
        "recent_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("open_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("context", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.UniqueConstraint("conversation_id", name="uq_recent_items_conversation"),
    )
    op.create_index("idx_recent_items_conversation_id", "recent_items", ["conversation_id"])
    op.create_index("idx_recent_items_project_id", "recent_items", ["project_id"])
    op.create_index("idx_recent_items_last_opened_at", "recent_items", ["last_opened_at"])
    op.create_index("idx_recent_items_open_count", "recent_items", ["open_count"])


def downgrade() -> None:
    op.drop_index("idx_recent_items_open_count", table_name="recent_items")
    op.drop_index("idx_recent_items_last_opened_at", table_name="recent_items")
    op.drop_index("idx_recent_items_project_id", table_name="recent_items")
    op.drop_index("idx_recent_items_conversation_id", table_name="recent_items")
    op.drop_table("recent_items")

    op.drop_index("idx_reading_positions_updated_at", table_name="reading_positions")
    op.drop_index("idx_reading_positions_message_id", table_name="reading_positions")
    op.drop_index("idx_reading_positions_conversation_id", table_name="reading_positions")
    op.drop_table("reading_positions")

    op.drop_index("idx_project_conversations_sort_order", table_name="project_conversations")
    op.drop_index("idx_project_conversations_added_at", table_name="project_conversations")
    op.drop_index("idx_project_conversations_pinned_at", table_name="project_conversations")
    op.drop_index("idx_project_conversations_is_pinned", table_name="project_conversations")
    op.drop_index("idx_project_conversations_conversation_id", table_name="project_conversations")
    op.drop_index("idx_project_conversations_project_id", table_name="project_conversations")
    op.drop_table("project_conversations")

    op.drop_index("idx_projects_created_at", table_name="projects")
    op.drop_index("idx_projects_sort_order", table_name="projects")
    op.drop_index("idx_projects_is_archived", table_name="projects")
    op.drop_index("idx_projects_is_default", table_name="projects")
    op.drop_table("projects")
