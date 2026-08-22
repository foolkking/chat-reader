"""Add layered cleanup detection metadata.

Revision ID: 20260823_0027
Revises: 20260822_0026
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260823_0027"
down_revision: str | None = "20260822_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("content_cleanup_rule_revisions", sa.Column("matcher_mode", sa.String(length=24), nullable=False, server_default="EXACT"))
    op.add_column("content_cleanup_rule_revisions", sa.Column("normalization_profile", sa.String(length=48), nullable=False, server_default="NONE"))
    op.add_column("content_cleanup_rule_revisions", sa.Column("max_edit_distance", sa.Integer(), nullable=True))
    op.add_column("content_cleanup_rule_revisions", sa.Column("boundary_mode", sa.String(length=24), nullable=False, server_default="ANYWHERE"))
    op.add_column("content_cleanup_occurrences", sa.Column("match_mode", sa.String(length=24), nullable=False, server_default="RAW_EXACT"))
    op.add_column("content_cleanup_occurrences", sa.Column("similarity_score", sa.Float(), nullable=True))
    op.add_column("content_cleanup_occurrences", sa.Column("detector_version", sa.String(length=40), nullable=False, server_default="noise-v2"))
    op.add_column("content_cleanup_occurrences", sa.Column("evidence_codes", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("content_cleanup_occurrences", "evidence_codes")
    op.drop_column("content_cleanup_occurrences", "detector_version")
    op.drop_column("content_cleanup_occurrences", "similarity_score")
    op.drop_column("content_cleanup_occurrences", "match_mode")
    op.drop_column("content_cleanup_rule_revisions", "boundary_mode")
    op.drop_column("content_cleanup_rule_revisions", "max_edit_distance")
    op.drop_column("content_cleanup_rule_revisions", "normalization_profile")
    op.drop_column("content_cleanup_rule_revisions", "matcher_mode")
