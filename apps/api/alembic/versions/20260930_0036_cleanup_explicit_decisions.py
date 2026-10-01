"""Require fresh explicit decisions for legacy automatically selected matches.

Revision ID: 20260930_0036
Revises: 20260930_0035
"""
import sqlalchemy as sa
from alembic import op

revision = "20260930_0036"
down_revision = "20260930_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("content_cleanup_occurrences", sa.Column("decision_updated_at", sa.DateTime(timezone=True)))
    op.add_column("content_cleanup_scans", sa.Column("apply_lease_until", sa.DateTime(timezone=True)))
    # Older scans cannot distinguish automatic selection from an explicit user
    # decision. Re-review preserves content and all saved candidate locations.
    op.execute("UPDATE content_cleanup_occurrences SET decision = 'KEEP' WHERE decision = 'DELETE'")


def downgrade() -> None:
    op.drop_column("content_cleanup_scans", "apply_lease_until")
    op.drop_column("content_cleanup_occurrences", "decision_updated_at")
