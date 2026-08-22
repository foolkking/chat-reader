"""Add deterministic content cleanup rules and review scans.

Revision ID: 20260822_0026
Revises: 20260822_0025
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822_0026"
down_revision: str | None = "20260822_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "content_cleanup_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("scope", sa.String(length=24), nullable=False),
        sa.Column("detector_id", sa.String(length=80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_content_cleanup_rules_status", "content_cleanup_rules", ["status"])
    op.create_table(
        "content_cleanup_rule_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rule_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("matcher_version", sa.String(length=40), nullable=False),
        sa.Column("match_value", sa.Text(), nullable=True),
        sa.Column("case_sensitive", sa.Boolean(), nullable=False),
        sa.Column("role_filter", sa.String(length=24), nullable=True),
        sa.Column("default_decision", sa.String(length=12), nullable=False),
        sa.Column("supersedes_revision_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["rule_id"], ["content_cleanup_rules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supersedes_revision_id"], ["content_cleanup_rule_revisions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("rule_id", "revision", name="uq_content_cleanup_rule_revision"),
    )
    op.create_index("idx_content_cleanup_rule_revisions_rule", "content_cleanup_rule_revisions", ["rule_id"])
    op.create_index("idx_content_cleanup_rule_revisions_match", "content_cleanup_rule_revisions", ["rule_id", "match_value"])
    op.create_table(
        "content_cleanup_scans",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("scope_type", sa.String(length=32), nullable=False),
        sa.Column("background_job_id", sa.Uuid(), nullable=True),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("processed_messages", sa.Integer(), nullable=False),
        sa.Column("total_messages", sa.Integer(), nullable=False),
        sa.Column("cursor_message_id", sa.Uuid(), nullable=True),
        sa.Column("selection_message_id", sa.Uuid(), nullable=True),
        sa.Column("selection_start_offset", sa.Integer(), nullable=True),
        sa.Column("selection_end_offset", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["background_job_id"], ["background_jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["selection_message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_content_cleanup_scans_status", "content_cleanup_scans", ["status"])
    op.create_index("idx_content_cleanup_scans_job", "content_cleanup_scans", ["background_job_id"])
    op.create_table(
        "content_cleanup_scan_targets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scan_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("base_conversation_revision", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["scan_id"], ["content_cleanup_scans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scan_id", "conversation_id", name="uq_content_cleanup_scan_target"),
    )
    op.create_index("idx_content_cleanup_scan_targets_scan_conversation", "content_cleanup_scan_targets", ["scan_id", "conversation_id"])
    op.create_index("idx_content_cleanup_scan_targets_conversation_scan", "content_cleanup_scan_targets", ["conversation_id", "scan_id"])
    op.create_table(
        "content_cleanup_occurrences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scan_id", sa.Uuid(), nullable=False),
        sa.Column("rule_revision_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("message_version_id", sa.Uuid(), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("line_start", sa.Integer(), nullable=False),
        sa.Column("column_start", sa.Integer(), nullable=False),
        sa.Column("line_end", sa.Integer(), nullable=False),
        sa.Column("column_end", sa.Integer(), nullable=False),
        sa.Column("block_index", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("confidence", sa.String(length=16), nullable=False),
        sa.Column("reason_code", sa.String(length=80), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["scan_id"], ["content_cleanup_scans.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rule_revision_id"], ["content_cleanup_rule_revisions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_version_id"], ["message_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scan_id", "rule_revision_id", "message_version_id", "start_offset", "end_offset", name="uq_content_cleanup_occurrence"),
    )
    op.create_index("idx_content_cleanup_occurrences_scan_decision", "content_cleanup_occurrences", ["scan_id", "decision"])
    op.create_index("idx_content_cleanup_occurrences_version_offset", "content_cleanup_occurrences", ["message_version_id", "start_offset"])
    op.create_index("idx_content_cleanup_occurrences_rule_version", "content_cleanup_occurrences", ["rule_revision_id", "message_version_id"])
    op.create_index("idx_content_cleanup_occurrences_conversation_message", "content_cleanup_occurrences", ["conversation_id", "message_id"])


def downgrade() -> None:
    op.drop_index("idx_content_cleanup_occurrences_conversation_message", table_name="content_cleanup_occurrences")
    op.drop_index("idx_content_cleanup_occurrences_rule_version", table_name="content_cleanup_occurrences")
    op.drop_index("idx_content_cleanup_occurrences_version_offset", table_name="content_cleanup_occurrences")
    op.drop_index("idx_content_cleanup_occurrences_scan_decision", table_name="content_cleanup_occurrences")
    op.drop_table("content_cleanup_occurrences")
    op.drop_index("idx_content_cleanup_scan_targets_conversation_scan", table_name="content_cleanup_scan_targets")
    op.drop_index("idx_content_cleanup_scan_targets_scan_conversation", table_name="content_cleanup_scan_targets")
    op.drop_table("content_cleanup_scan_targets")
    op.drop_index("idx_content_cleanup_scans_job", table_name="content_cleanup_scans")
    op.drop_index("idx_content_cleanup_scans_status", table_name="content_cleanup_scans")
    op.drop_table("content_cleanup_scans")
    op.drop_index("idx_content_cleanup_rule_revisions_match", table_name="content_cleanup_rule_revisions")
    op.drop_index("idx_content_cleanup_rule_revisions_rule", table_name="content_cleanup_rule_revisions")
    op.drop_table("content_cleanup_rule_revisions")
    op.drop_index("idx_content_cleanup_rules_status", table_name="content_cleanup_rules")
    op.drop_table("content_cleanup_rules")
