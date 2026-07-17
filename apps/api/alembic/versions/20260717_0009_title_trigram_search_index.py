"""title trigram search index

Revision ID: 20260717_0009
Revises: 20260716_0008
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260717_0009"
down_revision: str | None = "20260716_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_search_documents_title_trgm "
        "ON search_documents USING gin (title gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_search_documents_title_trgm")
