"""cr archives and search indexes

Revision ID: 20260716_0008
Revises: 20260715_0007
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260716_0008"
down_revision: str | None = "20260715_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "export_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("format", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("download_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["job_id"], ["background_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id"),
    )
    op.create_index("idx_export_artifacts_conversation_id", "export_artifacts", ["conversation_id"])
    op.create_index("idx_export_artifacts_expires_at", "export_artifacts", ["expires_at"])
    op.create_index(
        "idx_headings_conversation_message_index",
        "headings",
        ["conversation_id", "message_id", "heading_index"],
    )
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_search_documents_search_text_trgm "
        "ON search_documents USING gin (search_text gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_search_documents_search_text_trgm")
    op.drop_index("idx_headings_conversation_message_index", table_name="headings")
    op.drop_index("idx_export_artifacts_expires_at", table_name="export_artifacts")
    op.drop_index("idx_export_artifacts_conversation_id", table_name="export_artifacts")
    op.drop_table("export_artifacts")
