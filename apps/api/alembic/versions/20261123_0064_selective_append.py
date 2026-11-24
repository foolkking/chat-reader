"""Remember sparse append identities without changing existing messages or source bindings."""
import sqlalchemy as sa
from alembic import op

revision = "20261123_0064"
down_revision = "20261123_0063"
branch_labels = depends_on = None


def upgrade():
    op.create_table("conversation_append_items",
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True),
        *(sa.Column(name, sa.String(64), primary_key=True) for name in ("source_key", "item_key", "signature")),
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="SET NULL")))


def downgrade():
    op.drop_table("conversation_append_items")
