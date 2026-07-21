"""add activity sorting fields

Revision ID: 20260721_0013
Revises: 20260718_0012
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260721_0013"
down_revision: str | None = "20260718_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "conversations",
        sa.Column("manual_sort_order", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "user_preferences",
        sa.Column("conversation_sort_mode", sa.Text(), server_default="recent_read", nullable=False),
    )
    op.add_column(
        "user_preferences",
        sa.Column("conversation_sort_direction", sa.Text(), server_default="desc", nullable=False),
    )
    op.add_column(
        "user_preferences",
        sa.Column("project_sort_mode", sa.Text(), server_default="recent_read", nullable=False),
    )
    op.add_column(
        "user_preferences",
        sa.Column("project_sort_direction", sa.Text(), server_default="desc", nullable=False),
    )
    op.create_index("idx_projects_last_read_at", "projects", ["last_read_at"])
    op.create_index("idx_conversations_manual_sort_order", "conversations", ["manual_sort_order"])
    op.create_index("idx_conversations_message_count", "conversations", ["message_count"])
    op.create_check_constraint(
        "ck_user_preferences_conversation_sort_mode",
        "user_preferences",
        "conversation_sort_mode IN ('recent_read','updated','created','imported','title','message_count','custom')",
    )
    op.create_check_constraint(
        "ck_user_preferences_project_sort_mode",
        "user_preferences",
        "project_sort_mode IN ('recent_read','updated','created','title','conversation_count','custom')",
    )
    op.create_check_constraint(
        "ck_user_preferences_conversation_sort_direction",
        "user_preferences",
        "conversation_sort_direction IN ('asc','desc')",
    )
    op.create_check_constraint(
        "ck_user_preferences_project_sort_direction",
        "user_preferences",
        "project_sort_direction IN ('asc','desc')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_preferences_project_sort_direction", "user_preferences", type_="check")
    op.drop_constraint("ck_user_preferences_conversation_sort_direction", "user_preferences", type_="check")
    op.drop_constraint("ck_user_preferences_project_sort_mode", "user_preferences", type_="check")
    op.drop_constraint("ck_user_preferences_conversation_sort_mode", "user_preferences", type_="check")
    op.drop_index("idx_conversations_message_count", table_name="conversations")
    op.drop_index("idx_conversations_manual_sort_order", table_name="conversations")
    op.drop_index("idx_projects_last_read_at", table_name="projects")
    op.drop_column("user_preferences", "project_sort_direction")
    op.drop_column("user_preferences", "project_sort_mode")
    op.drop_column("user_preferences", "conversation_sort_direction")
    op.drop_column("user_preferences", "conversation_sort_mode")
    op.drop_column("conversations", "manual_sort_order")
    op.drop_column("projects", "last_read_at")
