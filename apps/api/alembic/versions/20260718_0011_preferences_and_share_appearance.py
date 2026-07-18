"""add preferences and fixed share appearance

Revision ID: 20260718_0011
Revises: 20260717_0010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260718_0011"
down_revision: str | None = "20260717_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("subject_key", sa.Text(), nullable=False),
        sa.Column("theme_mode", sa.Text(), server_default="light", nullable=False),
        sa.Column("locale_mode", sa.Text(), server_default="auto", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("subject_key"),
        sa.CheckConstraint("theme_mode IN ('light', 'dark', 'system')", name="ck_user_preferences_theme_mode"),
        sa.CheckConstraint("locale_mode IN ('auto', 'zh-CN', 'en-US')", name="ck_user_preferences_locale_mode"),
    )
    op.add_column("shares", sa.Column("theme", sa.Text(), server_default="light", nullable=False))
    op.add_column("shares", sa.Column("locale", sa.Text(), server_default="zh-CN", nullable=False))
    op.create_check_constraint("ck_shares_theme", "shares", "theme IN ('light', 'dark')")
    op.create_check_constraint("ck_shares_locale", "shares", "locale IN ('zh-CN', 'en-US')")
    op.execute(
        "INSERT INTO user_preferences (subject_key, theme_mode, locale_mode) "
        "VALUES ('local:default', 'light', 'auto') ON CONFLICT (subject_key) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_constraint("ck_shares_locale", "shares", type_="check")
    op.drop_constraint("ck_shares_theme", "shares", type_="check")
    op.drop_column("shares", "locale")
    op.drop_column("shares", "theme")
    op.drop_table("user_preferences")
