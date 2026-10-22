"""Explicit, source-bound public image capabilities."""
from alembic import op
import sqlalchemy as sa

revision = "20261022_0053"
down_revision = "20261017_0052"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "attachment_public_links",
        sa.Column("id", sa.Uuid(), nullable=False, primary_key=True),
        sa.Column("attachment_id", sa.Uuid(), sa.ForeignKey("attachments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_asset_object_id", sa.Uuid(), sa.ForeignKey("asset_objects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("attachment_id", "source_asset_object_id", name="uq_attachment_public_link_source"),
    )
    op.create_index("ix_attachment_public_links_attachment_id", "attachment_public_links", ["attachment_id"])


def downgrade():
    # Dropping capabilities revokes all external links; source files are untouched.
    op.drop_index("ix_attachment_public_links_attachment_id", table_name="attachment_public_links")
    op.drop_table("attachment_public_links")
