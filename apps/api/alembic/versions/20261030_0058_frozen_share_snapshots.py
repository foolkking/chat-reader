"""store immutable projections for explicitly frozen shares"""
from alembic import op
import sqlalchemy as sa


revision = "20261030_0058"
down_revision = "20261030_0057"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "shares",
        sa.Column("content_mode", sa.Text(), nullable=False, server_default=sa.text("'live'")),
    )
    op.create_table(
        "share_snapshots",
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("conversation", sa.JSON(), nullable=False),
        sa.Column("messages", sa.JSON(), nullable=False),
        sa.Column("toc", sa.JSON(), nullable=False),
        sa.Column("description_markdown", sa.Text(), nullable=True),
        sa.Column("message_count", sa.Integer(), nullable=False),
        sa.Column("turn_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("share_id", name="pk_share_snapshots"),
    )


def downgrade():
    op.drop_table("share_snapshots")
    op.drop_column("shares", "content_mode")
