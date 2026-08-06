"""add conversation attachment ownership and upload staging

Revision ID: 20260805_0020
Revises: 20260804_0019
"""

from collections.abc import Sequence
from copy import deepcopy
from datetime import datetime, timezone
import uuid

import sqlalchemy as sa
from alembic import op

revision: str = "20260805_0020"
down_revision: str | None = "20260804_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("attachments", sa.Column("conversation_id", sa.Uuid(), nullable=True))
    op.add_column("attachments", sa.Column("detected_mime_type", sa.String(), nullable=True))
    op.add_column("attachments", sa.Column("status", sa.String(), nullable=False, server_default="available"))
    op.add_column("attachments", sa.Column("scan_status", sa.String(), nullable=False, server_default="unscanned"))
    op.create_foreign_key(
        "fk_attachments_conversation_id",
        "attachments",
        "conversations",
        ["conversation_id"],
        ["id"],
        ondelete="CASCADE",
    )

    connection = op.get_bind()
    _backfill_attachment_ownership(connection)
    op.alter_column("attachments", "conversation_id", nullable=False)
    op.execute(
        """
        UPDATE attachments AS a
        SET detected_mime_type = ao.detected_mime_type,
            scan_status = ao.scan_status,
            status = CASE WHEN a.resolution_status = 'resolved' THEN 'available' ELSE a.resolution_status END
        FROM asset_objects AS ao
        WHERE a.asset_object_id = ao.id
        """
    )
    op.execute(
        """
        UPDATE attachments
        SET status = CASE WHEN resolution_status = 'resolved' THEN 'available' ELSE resolution_status END,
            scan_status = CASE WHEN asset_object_id IS NULL THEN 'not_available' ELSE scan_status END
        """
    )
    op.drop_constraint("uq_attachments_source_identity", "attachments", type_="unique")
    op.create_unique_constraint(
        "uq_attachments_conversation_source_identity",
        "attachments",
        ["conversation_id", "source_type", "source_attachment_id", "import_id"],
    )
    op.create_index(
        "idx_attachments_conversation_status",
        "attachments",
        ["conversation_id", "status", "created_at"],
    )

    op.add_column("message_version_attachments", sa.Column("occurrence_key", sa.String(), nullable=True))
    op.add_column(
        "message_version_attachments",
        sa.Column("placement", sa.String(), nullable=False, server_default="inline"),
    )
    op.execute("UPDATE message_version_attachments SET occurrence_key = 'legacy-' || CAST(id AS VARCHAR)")
    op.alter_column("message_version_attachments", "occurrence_key", nullable=False)
    op.drop_constraint("uq_message_version_attachments_relation", "message_version_attachments", type_="unique")
    op.create_unique_constraint(
        "uq_message_version_attachment_occurrence",
        "message_version_attachments",
        ["message_version_id", "occurrence_key"],
    )

    op.create_table(
        "attachment_upload_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("target_message_id", sa.Uuid(), nullable=True),
        sa.Column("base_message_version_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["base_message_version_id"], ["message_versions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_attachment_upload_sessions_conversation",
        "attachment_upload_sessions",
        ["conversation_id", "created_at"],
    )
    op.create_index(
        "idx_attachment_upload_sessions_expiry",
        "attachment_upload_sessions",
        ["status", "expires_at"],
    )
    op.create_table(
        "attachment_upload_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("client_filename", sa.Text(), nullable=False),
        sa.Column("declared_mime_type", sa.String(), nullable=True),
        sa.Column("detected_mime_type", sa.String(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("temporary_storage_key", sa.Text(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("validation_status", sa.String(), nullable=False),
        sa.Column("scan_status", sa.String(), nullable=False),
        sa.Column("error_code", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["attachment_upload_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_attachment_upload_items_session",
        "attachment_upload_items",
        ["session_id", "created_at"],
    )

    op.alter_column("export_artifacts", "conversation_id", nullable=True)
    op.add_column(
        "export_artifacts",
        sa.Column("scope_type", sa.String(), nullable=False, server_default="conversation"),
    )


def _backfill_attachment_ownership(connection: sa.Connection) -> None:
    attachment_rows = connection.execute(sa.text("SELECT * FROM attachments ORDER BY id")).mappings().all()
    for row in attachment_rows:
        owners = connection.execute(
            sa.text(
                """
                SELECT DISTINCT m.conversation_id
                FROM message_version_attachments AS mva
                JOIN message_versions AS mv ON mv.id = mva.message_version_id
                JOIN messages AS m ON m.id = mv.message_id
                WHERE mva.attachment_id = :attachment_id
                ORDER BY m.conversation_id
                """
            ),
            {"attachment_id": row["id"]},
        ).scalars().all()
        if not owners and row["import_id"] is not None:
            import_owner = connection.execute(
                sa.text("SELECT conversation_id FROM imports WHERE id = :import_id"),
                {"import_id": row["import_id"]},
            ).scalar_one_or_none()
            if import_owner is not None:
                owners = [import_owner]
        if not owners:
            raise RuntimeError(
                "Cannot upgrade attachment ownership: at least one attachment has no message or import conversation. "
                "Run the attachment ownership diagnostic before retrying the migration."
            )

        connection.execute(
            sa.text("UPDATE attachments SET conversation_id = :conversation_id WHERE id = :attachment_id"),
            {"conversation_id": owners[0], "attachment_id": row["id"]},
        )
        for owner in owners[1:]:
            clone_id = uuid.uuid4()
            values = deepcopy(dict(row))
            values.update({"id": clone_id, "conversation_id": owner})
            connection.execute(
                sa.text(
                    """
                    INSERT INTO attachments (
                        id, asset_object_id, import_id, original_filename, display_name,
                        declared_mime_type, source_type, source_attachment_id, metadata,
                        resolution_status, created_at, deleted_at, conversation_id,
                        detected_mime_type, status, scan_status
                    ) VALUES (
                        :id, :asset_object_id, :import_id, :original_filename, :display_name,
                        :declared_mime_type, :source_type, :source_attachment_id, :metadata,
                        :resolution_status, :created_at, :deleted_at, :conversation_id,
                        NULL, 'available', 'unscanned'
                    )
                    """
                ),
                values,
            )
            connection.execute(
                sa.text(
                    """
                    UPDATE message_version_attachments AS mva
                    SET attachment_id = :clone_id
                    FROM message_versions AS mv, messages AS m
                    WHERE mva.attachment_id = :source_id
                      AND mv.id = mva.message_version_id
                      AND m.id = mv.message_id
                      AND m.conversation_id = :conversation_id
                    """
                ),
                {"clone_id": clone_id, "source_id": row["id"], "conversation_id": owner},
            )


def downgrade() -> None:
    op.drop_column("export_artifacts", "scope_type")
    op.alter_column("export_artifacts", "conversation_id", nullable=False)
    op.drop_table("attachment_upload_items")
    op.drop_table("attachment_upload_sessions")
    op.drop_constraint("uq_message_version_attachment_occurrence", "message_version_attachments", type_="unique")
    op.create_unique_constraint(
        "uq_message_version_attachments_relation",
        "message_version_attachments",
        ["message_version_id", "attachment_id", "relation_type", "display_order"],
    )
    op.drop_column("message_version_attachments", "placement")
    op.drop_column("message_version_attachments", "occurrence_key")
    op.drop_index("idx_attachments_conversation_status", table_name="attachments")
    op.drop_constraint("uq_attachments_conversation_source_identity", "attachments", type_="unique")
    op.create_unique_constraint(
        "uq_attachments_source_identity",
        "attachments",
        ["source_type", "source_attachment_id", "import_id"],
    )
    op.drop_constraint("fk_attachments_conversation_id", "attachments", type_="foreignkey")
    op.drop_column("attachments", "scan_status")
    op.drop_column("attachments", "status")
    op.drop_column("attachments", "detected_mime_type")
    op.drop_column("attachments", "conversation_id")
