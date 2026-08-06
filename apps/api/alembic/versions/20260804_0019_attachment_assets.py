"""add canonical attachment assets

Revision ID: 20260804_0019
Revises: 20260804_0018
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260804_0019"
down_revision: str | None = "20260804_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "asset_objects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("detected_mime_type", sa.String(), nullable=False),
        sa.Column("detected_extension", sa.String(), nullable=True),
        sa.Column("storage_backend", sa.String(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("scan_status", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sha256", "byte_size", name="uq_asset_objects_hash_size"),
        sa.UniqueConstraint("storage_backend", "storage_key", name="uq_asset_objects_storage_key"),
    )
    op.create_index("idx_asset_objects_status_scan", "asset_objects", ["status", "scan_status"])
    op.create_index("idx_asset_objects_created_at", "asset_objects", ["created_at"])

    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("asset_object_id", sa.Uuid(), nullable=True),
        sa.Column("import_id", sa.Uuid(), nullable=True),
        sa.Column("original_filename", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("declared_mime_type", sa.String(), nullable=True),
        sa.Column("source_type", sa.String(), nullable=False),
        sa.Column("source_attachment_id", sa.Text(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("resolution_status", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["asset_object_id"], ["asset_objects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["import_id"], ["imports.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_attachment_id", "import_id", name="uq_attachments_source_identity"),
    )
    op.create_index("idx_attachments_asset_object_id", "attachments", ["asset_object_id"])
    op.create_index("idx_attachments_import_id", "attachments", ["import_id"])
    op.create_index("idx_attachments_source_attachment_id", "attachments", ["source_attachment_id"])

    op.create_table(
        "message_version_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message_version_id", sa.Uuid(), nullable=False),
        sa.Column("attachment_id", sa.Uuid(), nullable=False),
        sa.Column("relation_type", sa.String(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("block_index", sa.Integer(), nullable=True),
        sa.Column("display_mode", sa.String(), nullable=False),
        sa.Column("alt_text", sa.Text(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["attachment_id"], ["attachments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_version_id"], ["message_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_version_id", "attachment_id", "relation_type", "display_order", name="uq_message_version_attachments_relation"),
    )
    op.create_index("idx_message_version_attachments_version", "message_version_attachments", ["message_version_id", "display_order"])
    op.create_index("idx_message_version_attachments_attachment", "message_version_attachments", ["attachment_id"])

    op.create_table(
        "asset_derivatives",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_asset_object_id", sa.Uuid(), nullable=False),
        sa.Column("derivative_asset_object_id", sa.Uuid(), nullable=False),
        sa.Column("derivative_type", sa.String(), nullable=False),
        sa.Column("generator", sa.String(), nullable=False),
        sa.Column("generator_version", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["derivative_asset_object_id"], ["asset_objects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_asset_object_id"], ["asset_objects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_asset_object_id", "derivative_type", "generator_version", name="uq_asset_derivatives_generator"),
    )
    op.create_index("idx_asset_derivatives_source_type", "asset_derivatives", ["source_asset_object_id", "derivative_type"])

    op.create_table(
        "asset_object_leases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("asset_object_id", sa.Uuid(), nullable=False),
        sa.Column("holder_type", sa.String(), nullable=False),
        sa.Column("holder_id", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["asset_object_id"], ["asset_objects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_object_id", "holder_type", "holder_id", name="uq_asset_object_leases_holder"),
    )
    op.create_index("idx_asset_object_leases_expiry", "asset_object_leases", ["expires_at"])


def downgrade() -> None:
    op.drop_table("asset_object_leases")
    op.drop_table("asset_derivatives")
    op.drop_table("message_version_attachments")
    op.drop_table("attachments")
    op.drop_table("asset_objects")
