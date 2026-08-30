"""Add owner-managed export and rescue skills.

Revision ID: 20260829_0029
Revises: 20260823_0028
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260829_0029"
down_revision: str | None = "20260823_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_skills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("subject_key", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("content_digest", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("subject_key", "category", "locale", "content_digest", name="uq_user_skill_content"),
    )
    op.create_index("idx_user_skills_subject_category_locale", "user_skills", ["subject_key", "category", "locale"])
    op.create_index("idx_user_skills_status", "user_skills", ["status"])
    op.create_table(
        "user_skill_selections",
        sa.Column("subject_key", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("locale", sa.String(length=16), nullable=False),
        sa.Column("skill_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["skill_id"], ["user_skills.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("subject_key", "category", "locale"),
        sa.UniqueConstraint("subject_key", "category", "locale", name="uq_user_skill_selection"),
    )


def downgrade() -> None:
    op.drop_table("user_skill_selections")
    op.drop_index("idx_user_skills_status", table_name="user_skills")
    op.drop_index("idx_user_skills_subject_category_locale", table_name="user_skills")
    op.drop_table("user_skills")
