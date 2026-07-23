"""add offline library, annotations, notebook, and private share controls

Revision ID: 20260723_0014
Revises: 20260721_0013
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260723_0014"
down_revision: str | None = "20260721_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("description_markdown", sa.Text(), nullable=True))
    op.add_column("conversations", sa.Column("offline_revision", sa.BigInteger(), server_default="1", nullable=False))
    op.add_column("user_preferences", sa.Column("section_toc_mode", sa.Text(), server_default="visible", nullable=False))
    op.create_check_constraint(
        "ck_user_preferences_section_toc_mode", "user_preferences", "section_toc_mode IN ('visible','rail')"
    )
    for name in ("include_description", "include_annotations", "include_notebook"):
        op.add_column("shares", sa.Column(name, sa.Boolean(), server_default=sa.false(), nullable=False))

    op.create_table(
        "conversation_annotations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("subject_key", sa.Text(), server_default="local:default", nullable=False),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
        sa.Column("message_version_id", sa.Uuid(), sa.ForeignKey("message_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("annotation_type", sa.Text(), server_default="highlight", nullable=False),
        sa.Column("color", sa.Text(), nullable=True),
        sa.Column("start_block_index", sa.Integer(), nullable=True),
        sa.Column("start_offset", sa.Integer(), nullable=True),
        sa.Column("end_block_index", sa.Integer(), nullable=True),
        sa.Column("end_offset", sa.Integer(), nullable=True),
        sa.Column("quote", sa.Text(), nullable=True),
        sa.Column("prefix", sa.Text(), nullable=True),
        sa.Column("suffix", sa.Text(), nullable=True),
        sa.Column("comment_markdown", sa.Text(), server_default="", nullable=False),
        sa.Column("anchor_status", sa.Text(), server_default="active", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("conflict_of_id", sa.Uuid(), sa.ForeignKey("conversation_annotations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("metadata", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("annotation_type IN ('highlight','bookmark')", name="ck_annotation_type"),
        sa.CheckConstraint("color IS NULL OR color IN ('yellow','green','blue','pink')", name="ck_annotation_color"),
    )
    op.create_index("idx_conversation_annotations_conversation_id", "conversation_annotations", ["conversation_id"])
    op.create_index("idx_conversation_annotations_message_id", "conversation_annotations", ["message_id"])
    op.create_index("idx_conversation_annotations_updated_at", "conversation_annotations", ["updated_at"])
    op.create_index("idx_conversation_annotations_conflict_of_id", "conversation_annotations", ["conflict_of_id"])

    op.create_table(
        "conversation_notebooks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("subject_key", sa.Text(), server_default="local:default", nullable=False),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("blocks", sa.JSON(), server_default=sa.text("'[]'"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("is_conflict", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("conflict_of_id", sa.Uuid(), sa.ForeignKey("conversation_notebooks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("idx_conversation_notebooks_conversation_id", "conversation_notebooks", ["conversation_id"])
    op.create_index("idx_conversation_notebooks_conflict_of_id", "conversation_notebooks", ["conflict_of_id"])

    op.create_table(
        "annotation_sync_receipts",
        sa.Column("operation_id", sa.Uuid(), primary_key=True),
        sa.Column("subject_key", sa.Text(), server_default="local:default", nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("response", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("idx_annotation_sync_receipts_created_at", "annotation_sync_receipts", ["created_at"])

    op.create_table(
        "offline_package_artifacts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job_id", sa.Uuid(), sa.ForeignKey("background_jobs.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("subject_key", sa.Text(), server_default="local:default", nullable=False),
        sa.Column("scope_type", sa.Text(), nullable=False),
        sa.Column("scope_id", sa.Uuid(), nullable=True),
        sa.Column("catalog_revision", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("storage_uri", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("conversation_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("download_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("idx_offline_package_artifacts_scope", "offline_package_artifacts", ["scope_type", "scope_id"])
    op.create_index("idx_offline_package_artifacts_created_at", "offline_package_artifacts", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_offline_package_artifacts_created_at", table_name="offline_package_artifacts")
    op.drop_index("idx_offline_package_artifacts_scope", table_name="offline_package_artifacts")
    op.drop_table("offline_package_artifacts")
    op.drop_index("idx_annotation_sync_receipts_created_at", table_name="annotation_sync_receipts")
    op.drop_table("annotation_sync_receipts")
    op.drop_index("idx_conversation_notebooks_conflict_of_id", table_name="conversation_notebooks")
    op.drop_index("idx_conversation_notebooks_conversation_id", table_name="conversation_notebooks")
    op.drop_table("conversation_notebooks")
    op.drop_index("idx_conversation_annotations_conflict_of_id", table_name="conversation_annotations")
    op.drop_index("idx_conversation_annotations_updated_at", table_name="conversation_annotations")
    op.drop_index("idx_conversation_annotations_message_id", table_name="conversation_annotations")
    op.drop_index("idx_conversation_annotations_conversation_id", table_name="conversation_annotations")
    op.drop_table("conversation_annotations")
    for name in ("include_notebook", "include_annotations", "include_description"):
        op.drop_column("shares", name)
    op.drop_constraint("ck_user_preferences_section_toc_mode", "user_preferences", type_="check")
    op.drop_column("user_preferences", "section_toc_mode")
    op.drop_column("conversations", "offline_revision")
    op.drop_column("conversations", "description_markdown")
