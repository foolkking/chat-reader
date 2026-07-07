"""create imports and source artifacts

Revision ID: 20260707_0001
Revises:
Create Date: 2026-07-07 00:01:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260707_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "imports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("source_profile", sa.Text(), nullable=False),
        sa.Column("source_fingerprint", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="previewed"),
        sa.Column("alignment_status", sa.Text(), nullable=False, server_default="not_applicable"),
        sa.Column("warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("json_filename", sa.Text(), nullable=True),
        sa.Column("md_filename", sa.Text(), nullable=True),
        sa.Column("csv_filename", sa.Text(), nullable=True),
        sa.Column("detected_title", sa.Text(), nullable=True),
        sa.Column("file_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "source_artifacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("import_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("imports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.Text(), nullable=False),
        sa.Column("source_profile", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("safe_filename", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("mime_guess", sa.Text(), nullable=True),
        sa.Column("file_extension", sa.Text(), nullable=True),
        sa.Column("raw_storage_uri", sa.Text(), nullable=False),
        sa.Column("parsed_summary", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("idx_source_artifacts_sha256", "source_artifacts", ["sha256"])
    op.create_index("idx_source_artifacts_import_id", "source_artifacts", ["import_id"])
    op.create_index("idx_source_artifacts_source_profile", "source_artifacts", ["source_profile"])


def downgrade() -> None:
    op.drop_index("idx_source_artifacts_source_profile", table_name="source_artifacts")
    op.drop_index("idx_source_artifacts_import_id", table_name="source_artifacts")
    op.drop_index("idx_source_artifacts_sha256", table_name="source_artifacts")
    op.drop_table("source_artifacts")
    op.drop_table("imports")
