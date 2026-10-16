"""Preserve reviewed deletion subranges without changing detector provenance."""
from alembic import op
import sqlalchemy as sa

revision = "20261015_0051"
down_revision = "20261008_0050"
branch_labels = None
depends_on = None


def upgrade():
    # NULL is the legacy full-candidate behavior; no source rewrite or backfill.
    op.add_column("content_cleanup_occurrences", sa.Column("reviewed_ranges", sa.JSON(none_as_null=True), nullable=True))


def downgrade():
    # Dropping a refinement while leaving DELETE would silently expand consent.
    # Revoke affected choices before removing the new field.
    op.execute("UPDATE content_cleanup_occurrences SET decision = 'KEEP', decision_updated_at = NULL "
               "WHERE reviewed_ranges IS NOT NULL AND decision = 'DELETE'")
    op.drop_column("content_cleanup_occurrences", "reviewed_ranges")
