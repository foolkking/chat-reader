"""Snapshot cleanup rules per scan and remove confidence metadata.

Revision ID: 20260823_0028
Revises: 20260823_0027
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0028"
down_revision: str | None = "20260823_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_cleanup_scan_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scan_id", sa.Uuid(), nullable=False),
        sa.Column("rule_revision_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["scan_id"], ["content_cleanup_scans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rule_revision_id"], ["content_cleanup_rule_revisions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scan_id", "rule_revision_id", name="uq_content_cleanup_scan_rule"),
    )
    op.create_index("idx_content_cleanup_scan_rules_scan", "content_cleanup_scan_rules", ["scan_id"])
    op.create_index("idx_content_cleanup_scan_rules_revision", "content_cleanup_scan_rules", ["rule_revision_id"])
    op.add_column("content_cleanup_scans", sa.Column("excluded_archived_count", sa.Integer(), nullable=False, server_default="0"))
    op.drop_column("content_cleanup_occurrences", "similarity_score")
    op.drop_column("content_cleanup_occurrences", "confidence")


def downgrade() -> None:
    op.drop_column("content_cleanup_scans", "excluded_archived_count")
    op.add_column("content_cleanup_occurrences", sa.Column("confidence", sa.String(length=16), nullable=False, server_default="KEEP"))
    op.add_column("content_cleanup_occurrences", sa.Column("similarity_score", sa.Float(), nullable=True))
    op.drop_index("idx_content_cleanup_scan_rules_revision", table_name="content_cleanup_scan_rules")
    op.drop_index("idx_content_cleanup_scan_rules_scan", table_name="content_cleanup_scan_rules")
    op.drop_table("content_cleanup_scan_rules")
