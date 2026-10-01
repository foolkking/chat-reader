"""Reading position versions and durable sync receipts.

Revision ID: 20261001_0040
Revises: 20261001_0039
"""
from alembic import op
import sqlalchemy as sa

revision = "20261001_0040"
down_revision = "20261001_0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reading_positions", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.create_table("reading_position_sync_receipts",
        sa.Column("subject_key", sa.Text(), primary_key=True),
        sa.Column("operation_id", sa.Uuid(), primary_key=True),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_reading_position_sync_receipts_conversation_id", "reading_position_sync_receipts", ["conversation_id"])


def downgrade() -> None:
    op.drop_table("reading_position_sync_receipts")
    op.drop_column("reading_positions", "revision")
