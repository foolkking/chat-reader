"""add reading position subject

Revision ID: 20260717_0010
Revises: 20260717_0009
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260717_0010"
down_revision: str | None = "20260717_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "reading_positions",
        sa.Column("subject_key", sa.Text(), nullable=False, server_default="local:default"),
    )
    op.drop_constraint("uq_reading_positions_conversation", "reading_positions", type_="unique")
    op.create_unique_constraint(
        "uq_reading_positions_subject_conversation",
        "reading_positions",
        ["subject_key", "conversation_id"],
    )
    op.create_index("idx_reading_positions_subject_key", "reading_positions", ["subject_key"])


def downgrade() -> None:
    op.drop_index("idx_reading_positions_subject_key", table_name="reading_positions")
    op.drop_constraint("uq_reading_positions_subject_conversation", "reading_positions", type_="unique")
    op.create_unique_constraint(
        "uq_reading_positions_conversation",
        "reading_positions",
        ["conversation_id"],
    )
    op.drop_column("reading_positions", "subject_key")
