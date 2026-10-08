"""Bind cleanup candidates to the scanned source, including in-place edits."""
from alembic import op
import sqlalchemy as sa
import hashlib

revision = "20261008_0050"
down_revision = "20261007_0049"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("content_cleanup_occurrences", sa.Column("source_content_hash", sa.String(), nullable=True))
    # Only unchanged scan targets establish the historical source. Unknown old
    # candidates stay readable but need a rescan before new deletion consent.
    unchanged = """EXISTS (
            SELECT 1 FROM content_cleanup_scan_targets AS target
            JOIN conversations AS conversation ON conversation.id = target.conversation_id
            JOIN messages AS message ON message.conversation_id = conversation.id
            WHERE target.scan_id = occurrence.scan_id
              AND target.conversation_id = occurrence.conversation_id
              AND message.id = occurrence.message_id
              AND message.current_version_id = occurrence.message_version_id
              AND conversation.offline_revision = target.base_conversation_revision
        )"""
    bind = op.get_bind()
    # One source body at a time; never use the whitespace-normalized canonical hash.
    versions = bind.execute(sa.text(f"""
        SELECT version.id, version.display_text FROM message_versions AS version
        WHERE EXISTS (SELECT 1 FROM content_cleanup_occurrences AS occurrence
            WHERE occurrence.message_version_id = version.id AND {unchanged})
    """).execution_options(stream_results=True))
    try:
        for row in versions.yield_per(1):
            bind.execute(sa.text(f"""
                UPDATE content_cleanup_occurrences AS occurrence
                SET source_content_hash = :digest
                WHERE occurrence.message_version_id = :version AND {unchanged}
            """), {"version": row.id, "digest": hashlib.sha256(row.display_text.encode("utf-8")).hexdigest()})
    finally:
        versions.close()


def downgrade():
    op.drop_column("content_cleanup_occurrences", "source_content_hash")
