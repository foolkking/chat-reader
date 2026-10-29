"""Durable idempotency receipts for conversation split workspace."""
from alembic import op
import sqlalchemy as sa


revision = "20261029_0054"
down_revision = "20261022_0053"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "conversation_split_receipts",
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_digest", sa.String(64), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("conversation_id", "idempotency_key", name="pk_conversation_split_receipts"),
    )


def downgrade():
    op.drop_table("conversation_split_receipts")
