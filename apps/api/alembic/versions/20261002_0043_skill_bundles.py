"""Immutable Skill Bundle revisions; existing Markdown remains readable."""
from alembic import op
import sqlalchemy as sa

revision = "20261002_0043"
down_revision = "20261002_0042"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("user_skills", "system_skills"):
        op.add_column(table, sa.Column("bundle_revision", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("user_skills", sa.Column("bundle_digest", sa.String(64)))
    with op.batch_alter_table("user_skills") as batch:
        batch.drop_constraint("uq_user_skill_content", type_="unique")
    op.create_index("uq_user_skill_legacy_content", "user_skills", ["subject_key", "category", "locale", "content_digest"],
                    unique=True, postgresql_where=sa.text("bundle_digest IS NULL"), sqlite_where=sa.text("bundle_digest IS NULL"))
    op.create_index("uq_user_skill_bundle", "user_skills", ["subject_key", "category", "locale", "bundle_digest"],
                    unique=True, postgresql_where=sa.text("bundle_digest IS NOT NULL"), sqlite_where=sa.text("bundle_digest IS NOT NULL"))
    op.create_table("skill_file_objects",
        sa.Column("sha256", sa.String(64), primary_key=True),
        sa.Column("storage_key", sa.String(240), nullable=False, unique=True),
        sa.Column("byte_size", sa.Integer(), nullable=False))
    op.create_table("skill_bundle_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_skill_id", sa.Uuid(), sa.ForeignKey("user_skills.id", ondelete="CASCADE")),
        sa.Column("system_skill_id", sa.Uuid(), sa.ForeignKey("system_skills.id", ondelete="CASCADE")),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("root_name", sa.String(100), nullable=False),
        sa.Column("source_kind", sa.String(24), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("(user_skill_id IS NULL) <> (system_skill_id IS NULL)", name="ck_skill_revision_one_owner"),
        sa.UniqueConstraint("user_skill_id", "revision", name="uq_user_skill_revision"),
        sa.UniqueConstraint("system_skill_id", "revision", name="uq_system_skill_revision"))
    op.create_table("skill_bundle_members",
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("skill_bundle_revisions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("path", sa.String(240), primary_key=True),
        sa.Column("object_sha256", sa.String(64), sa.ForeignKey("skill_file_objects.sha256", ondelete="RESTRICT"), nullable=False))

    op.create_index("ix_skill_bundle_members_object_sha256", "skill_bundle_members", ["object_sha256"])


def downgrade():
    # Downgrade requires operators to resolve distinct bundles sharing SKILL.md;
    # the legacy uniqueness constraint deliberately refuses destructive collapse.
    op.drop_table("skill_bundle_members")
    op.drop_table("skill_bundle_revisions")
    op.drop_table("skill_file_objects")
    op.drop_index("uq_user_skill_bundle", table_name="user_skills")
    op.drop_index("uq_user_skill_legacy_content", table_name="user_skills")
    with op.batch_alter_table("user_skills") as batch:
        batch.create_unique_constraint("uq_user_skill_content", ["subject_key", "category", "locale", "content_digest"])
    op.drop_column("user_skills", "bundle_digest")
    for table in ("user_skills", "system_skills"):
        op.drop_column(table, "bundle_revision")
