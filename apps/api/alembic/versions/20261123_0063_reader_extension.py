"""Register revocable endpoint-scoped extension grants and source bindings."""
import sqlalchemy as sa
from alembic import op

revision = "20261123_0063"
down_revision = "20261117_0062"
branch_labels = depends_on = None


def upgrade():
    op.create_table("extension_devices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client", sa.String(32), nullable=False), sa.Column("credential_version", sa.Integer(), nullable=False),
        sa.Column("challenge", sa.String(43)), *(sa.Column(n, sa.String(64), unique=True) for n in ("code_hash","access_hash","refresh_hash")),
        *(sa.Column(n, sa.DateTime(timezone=True), nullable=False) for n in ("access_until","expires_at","created_at")))
    op.create_index("ix_extension_devices_user_id", "extension_devices", ["user_id"])
    op.create_table("extension_sources",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_key", sa.String(160), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("conversations.id", ondelete="SET NULL")),
        sa.Column("source_digest", sa.String(64), nullable=False), sa.Column("canonical_digest", sa.String(64), nullable=False),
        sa.Column("message_count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("owner_user_id","source_key", name="uq_extension_owned_source"))
    op.add_column("user_preferences", sa.Column("context_quick_preset", sa.Uuid(), nullable=True))


def downgrade():
    op.drop_column("user_preferences", "context_quick_preset")
    op.drop_table("extension_sources")
    op.drop_table("extension_devices")
