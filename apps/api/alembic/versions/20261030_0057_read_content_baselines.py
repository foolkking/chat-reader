"""store explicit per-account snapshots of seen message identities"""
from alembic import op
import sqlalchemy as sa


revision = "20261030_0057"
down_revision = "20261030_0056"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "reading_content_baselines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "subject_key",
            sa.Text(),
            sa.ForeignKey("user_preferences.subject_key", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "conversation_id",
            sa.Uuid(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_reading_content_baselines"),
        sa.UniqueConstraint(
            "subject_key",
            "conversation_id",
            name="uq_reading_content_baseline_subject_conversation",
        ),
    )
    op.create_table(
        "reading_content_baseline_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "baseline_id",
            sa.Uuid(),
            sa.ForeignKey("reading_content_baselines.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            sa.Uuid(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_reading_content_baseline_messages"),
        sa.UniqueConstraint("baseline_id", "message_id", name="uq_reading_content_baseline_message"),
    )
    op.create_index(
        "idx_reading_content_baseline_messages_baseline",
        "reading_content_baseline_messages",
        ["baseline_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "idx_reading_content_baseline_messages_baseline",
        table_name="reading_content_baseline_messages",
    )
    op.drop_table("reading_content_baseline_messages")
    op.drop_table("reading_content_baselines")
