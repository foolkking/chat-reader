"""Account-scoped saved search and export preset entries."""
from alembic import op
import sqlalchemy as sa


revision = "20261030_0055"
down_revision = "20261029_0054"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "user_feature_entries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "subject_key",
            sa.Text(),
            sa.ForeignKey("user_preferences.subject_key", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("collection", sa.String(length=32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_user_feature_entries"),
    )
    op.create_index(
        "ix_user_feature_entries_owner_collection_updated",
        "user_feature_entries",
        ["subject_key", "collection", "updated_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_user_feature_entries_owner_collection_updated", table_name="user_feature_entries")
    op.drop_table("user_feature_entries")
