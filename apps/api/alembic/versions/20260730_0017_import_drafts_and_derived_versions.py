"""add durable import drafts and derived-data versions

Revision ID: 20260730_0017
Revises: 20260728_0016
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260730_0017"
down_revision: str | None = "20260728_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("imports", sa.Column("draft_storage_uri", sa.Text(), nullable=True))
    op.add_column("imports", sa.Column("draft_sha256", sa.String(), nullable=True))
    op.add_column("imports", sa.Column("draft_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.add_column("imports", sa.Column("draft_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_imports_draft_expires_at", "imports", ["draft_expires_at"])

    for column in (
        "normalizer_version",
        "markdown_parser_version",
        "block_builder_version",
        "search_document_version",
    ):
        op.add_column(
            "message_versions",
            sa.Column(column, sa.String(), nullable=False, server_default="legacy-v1"),
        )
    op.execute(
        """
        UPDATE conversation_annotations
        SET anchor_status = CASE anchor_status
            WHEN 'active' THEN 'valid'
            WHEN 'relocated' THEN 'remapped'
            WHEN 'stale' THEN 'needs_review'
            ELSE anchor_status
        END
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE conversation_annotations
        SET anchor_status = CASE anchor_status
            WHEN 'valid' THEN 'active'
            WHEN 'remapped' THEN 'relocated'
            WHEN 'orphaned' THEN 'stale'
            WHEN 'needs_review' THEN 'stale'
            ELSE anchor_status
        END
        """
    )
    for column in (
        "search_document_version",
        "block_builder_version",
        "markdown_parser_version",
        "normalizer_version",
    ):
        op.drop_column("message_versions", column)
    op.drop_index("idx_imports_draft_expires_at", table_name="imports")
    op.drop_column("imports", "draft_expires_at")
    op.drop_column("imports", "draft_summary")
    op.drop_column("imports", "draft_sha256")
    op.drop_column("imports", "draft_storage_uri")
