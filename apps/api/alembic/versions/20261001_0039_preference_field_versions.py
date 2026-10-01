"""Account preferences: field revisions and idempotent sync receipts.

Revision ID: 20261001_0039
Revises: 20261001_0038
"""
from alembic import op
import sqlalchemy as sa

revision = "20261001_0039"
down_revision = "20261001_0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_preferences", sa.Column("reader_default_focus", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("user_preferences", sa.Column("annotation_default_position", sa.Text(), nullable=False, server_default="floating"))
    # Missing entries mean revision one, including pre-migration values.
    op.add_column("user_preferences", sa.Column("field_revisions", sa.JSON(), nullable=False, server_default="{}"))
    op.create_table("preference_sync_receipts",
        sa.Column("subject_key", sa.Text(), sa.ForeignKey("user_preferences.subject_key", ondelete="CASCADE"), primary_key=True),
        sa.Column("operation_id", sa.Uuid(), primary_key=True),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    op.drop_table("preference_sync_receipts")
    op.drop_column("user_preferences", "field_revisions")
    op.drop_column("user_preferences", "annotation_default_position")
    op.drop_column("user_preferences", "reader_default_focus")
