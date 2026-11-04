"""Preserve the difference between expiry and a security revocation."""
from alembic import op
import sqlalchemy as sa

revision = "20261105_0059"
down_revision = "20261030_0058"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("auth_sessions", sa.Column("revocation_reason", sa.String(40), nullable=True))
    op.create_index("uq_shares_creation_intent", "shares", ["conversation_id", sa.text("(metadata ->> 'creation_key')")], unique=True)
    # Metadata-only repair: never reparse source or change canonical dates.
    op.execute(sa.text("""
        UPDATE search_documents AS document
        SET created_at = COALESCE(conversation.created_at, conversation.imported_at)
        FROM conversations AS conversation
        WHERE document.conversation_id = conversation.id
          AND document.document_type = 'conversation'
          AND document.created_at IS NULL
    """))
    # Derived private-text indexing runs in bounded worker pages, not while
    # holding the deployment migration transaction open.
    op.execute(sa.text("""
        INSERT INTO background_jobs
        (id, owner_user_id, job_type, status, phase, progress, processed_items, total_items,
         payload, result, idempotency_key, attempt_count, queued_at, created_at, updated_at)
        SELECT '9de182f8-b5b7-4a87-b90e-294637d9b7ce'::uuid,
                (SELECT id FROM users WHERE role = 'ADMIN' ORDER BY created_at, id LIMIT 1),
                'personal_search_backfill',
                'queued', 'queued', 0, 0, 0, '{}', '{}',
                'migration:20261105_0059:personal-search', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        WHERE EXISTS (SELECT 1 FROM conversations WHERE deleted_at IS NULL AND description_markdown IS NOT NULL)
           OR EXISTS (SELECT 1 FROM conversation_notebooks)
    """))


def downgrade():
    op.execute(sa.text("DELETE FROM background_jobs WHERE idempotency_key = 'migration:20261105_0059:personal-search'"))
    op.drop_index("uq_shares_creation_intent", table_name="shares")
    op.drop_column("auth_sessions", "revocation_reason")
