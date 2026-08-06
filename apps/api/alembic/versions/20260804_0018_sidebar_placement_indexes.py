"""add stable sidebar placement indexes

Revision ID: 20260804_0018
Revises: 20260730_0017
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260804_0018"
down_revision: str | None = "20260730_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "idx_project_conversations_placement",
        "project_conversations",
        ["project_id", "is_pinned", "sort_order", "conversation_id"],
    )
    op.create_index(
        "idx_projects_archive_placement",
        "projects",
        ["is_archived", "sort_order", "id"],
    )


def downgrade() -> None:
    op.drop_index("idx_projects_archive_placement", table_name="projects")
    op.drop_index("idx_project_conversations_placement", table_name="project_conversations")
