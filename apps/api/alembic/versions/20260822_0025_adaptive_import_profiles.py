"""Add adaptive import sessions, structure families, and versioned profiles.

Revision ID: 20260822_0025
Revises: 20260817_0024
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260822_0025"
down_revision: str | None = "20260817_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("imports", sa.Column("session_state", sa.String(), nullable=False, server_default="COMPLETED"))
    op.add_column("imports", sa.Column("analysis_summary", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    op.alter_column("imports", "session_state", server_default=None)
    op.alter_column("imports", "analysis_summary", server_default=None)

    op.create_table(
        "import_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("source_mode", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("current_revision_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_import_profiles_status_mode", "import_profiles", ["status", "source_mode"])
    op.create_table(
        "import_profile_revisions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("profile_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("matcher_version", sa.String(length=40), nullable=False),
        sa.Column("normalizer_version", sa.String(length=40), nullable=False),
        sa.Column("match_spec", sa.JSON(), nullable=False),
        sa.Column("mapping_spec", sa.JSON(), nullable=False),
        sa.Column("validation_spec", sa.JSON(), nullable=False),
        sa.Column("source_signature", sa.JSON(), nullable=False),
        sa.Column("signature_digest", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("supersedes_revision_id", sa.Uuid(), nullable=True),
        sa.Column("verification_summary", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["profile_id"], ["import_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["supersedes_revision_id"], ["import_profile_revisions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("profile_id", "revision", name="uq_import_profile_revision"),
    )
    op.create_index("idx_import_profile_revisions_digest", "import_profile_revisions", ["signature_digest"])
    op.create_foreign_key(
        "fk_import_profiles_current_revision",
        "import_profiles",
        "import_profile_revisions",
        ["current_revision_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "import_structure_families",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("import_id", sa.Uuid(), nullable=False),
        sa.Column("source_mode", sa.String(length=24), nullable=False),
        sa.Column("signature", sa.JSON(), nullable=False),
        sa.Column("signature_digest", sa.String(length=64), nullable=False),
        sa.Column("resolution_status", sa.String(length=24), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("matched_profile_key", sa.String(length=200), nullable=True),
        sa.Column("matched_profile_id", sa.Uuid(), nullable=True),
        sa.Column("matched_revision_id", sa.Uuid(), nullable=True),
        sa.Column("mapping_draft", sa.JSON(), nullable=False),
        sa.Column("validation_result", sa.JSON(), nullable=False),
        sa.Column("match_evidence", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["import_id"], ["imports.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["matched_profile_id"], ["import_profiles.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["matched_revision_id"], ["import_profile_revisions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_import_structure_families_import", "import_structure_families", ["import_id"])
    op.create_index("idx_import_structure_families_digest", "import_structure_families", ["signature_digest"])
    op.create_table(
        "import_input_groups",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("import_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=24), nullable=False),
        sa.Column("artifact_ids", sa.JSON(), nullable=False),
        sa.Column("display_name", sa.String(length=300), nullable=False),
        sa.Column("grouping_status", sa.String(length=24), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=True),
        sa.Column("profile_resolution", sa.JSON(), nullable=False),
        sa.Column("diagnostics", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["family_id"], ["import_structure_families.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["import_id"], ["imports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_import_input_groups_import", "import_input_groups", ["import_id"])


def downgrade() -> None:
    op.drop_index("idx_import_input_groups_import", table_name="import_input_groups")
    op.drop_table("import_input_groups")
    op.drop_index("idx_import_structure_families_digest", table_name="import_structure_families")
    op.drop_index("idx_import_structure_families_import", table_name="import_structure_families")
    op.drop_table("import_structure_families")
    op.drop_index("idx_import_profile_revisions_digest", table_name="import_profile_revisions")
    op.drop_constraint("fk_import_profiles_current_revision", "import_profiles", type_="foreignkey")
    op.drop_table("import_profile_revisions")
    op.drop_index("idx_import_profiles_status_mode", table_name="import_profiles")
    op.drop_table("import_profiles")
    op.drop_column("imports", "analysis_summary")
    op.drop_column("imports", "session_state")
