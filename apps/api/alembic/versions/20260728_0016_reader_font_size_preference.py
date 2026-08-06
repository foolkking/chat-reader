"""add reader font size preference

Revision ID: 20260728_0016
Revises: 20260728_0015
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260728_0016"
down_revision: str | None = "20260728_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("reader_font_size_px", sa.Integer(), nullable=False, server_default="17"),
    )
    op.create_check_constraint(
        "ck_user_preferences_reader_font_size_px",
        "user_preferences",
        "reader_font_size_px BETWEEN 15 AND 22",
    )
    op.execute(
        """
        UPDATE user_preferences
        SET reader_font_size_px = CASE reader_density_mode
            WHEN 'compact' THEN 16
            WHEN 'large' THEN 19
            ELSE 17
        END
        """
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_user_preferences_reader_font_size_px",
        "user_preferences",
        type_="check",
    )
    op.drop_column("user_preferences", "reader_font_size_px")
