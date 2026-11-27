"""Pair one registered browser with a Reader account by short code."""
from alembic import op
import sqlalchemy as sa

revision = "20261125_0065"
down_revision = "20261123_0064"
branch_labels = depends_on = None


def upgrade():
    op.add_column("extension_devices", sa.Column("device_name", sa.String(80), nullable=True))
    op.create_table("extension_pairings",
        sa.Column("secret_hash", sa.String(64), primary_key=True),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("client", sa.String(32), nullable=False),
        sa.Column("device_name", sa.String(80), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_poll", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_id", sa.Uuid(), sa.ForeignKey("extension_devices.id", ondelete="CASCADE")))
    op.create_index("ix_extension_pairings_expires_at", "extension_pairings", ["expires_at"])


def downgrade():
    op.drop_table("extension_pairings")
    op.drop_column("extension_devices", "device_name")
