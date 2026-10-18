"""Explicit, candidate-bound review of protected cleanup matches."""
from alembic import op
import sqlalchemy as sa

revision = "20261017_0052"
down_revision = "20261015_0051"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("content_cleanup_occurrences",
                  sa.Column("protection_review", sa.JSON(none_as_null=True), nullable=True))


def downgrade():
    # An old server must never treat new protected consent as ordinary DELETE.
    op.execute("UPDATE content_cleanup_occurrences SET decision = 'PROTECTED', decision_updated_at = NULL "
               "WHERE protection_review IS NOT NULL AND decision = 'DELETE'")
    op.drop_column("content_cleanup_occurrences", "protection_review")
