"""add reader width preference

Revision ID: 20260718_0012
Revises: 20260718_0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260718_0012"
down_revision: str | None = "20260718_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_preferences",
        sa.Column("reader_width_mode", sa.Text(), server_default="standard", nullable=False),
    )
    op.create_check_constraint(
        "ck_user_preferences_reader_width_mode",
        "user_preferences",
        "reader_width_mode IN ('compact', 'standard', 'wide')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_preferences_reader_width_mode", "user_preferences", type_="check")
    op.drop_column("user_preferences", "reader_width_mode")
