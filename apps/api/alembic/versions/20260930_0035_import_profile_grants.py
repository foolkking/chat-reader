"""Retain learned revisions independently from their source account.

Revision ID: 20260930_0035
Revises: 20260930_0034
"""
from collections import defaultdict

import sqlalchemy as sa
from alembic import op

from app.services.adaptive_import.profile_identity import configuration_digest_v1

revision = "20260930_0035"
down_revision = "20260930_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("import_profile_grants",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("import_profile_revisions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("import_profile_preferences",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("profile_id", sa.Uuid(), sa.ForeignKey("import_profiles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("display_name", sa.String(200)),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("hidden", sa.Boolean(), nullable=False))
    op.create_table("import_profile_publications",
        sa.Column("profile_id", sa.Uuid(), sa.ForeignKey("import_profiles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("import_profile_revisions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("published_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True)))
    op.create_table("import_profile_aliases",
        sa.Column("old_profile_id", sa.Uuid(), sa.ForeignKey("import_profiles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("canonical_profile_id", sa.Uuid(), sa.ForeignKey("import_profiles.id", ondelete="RESTRICT"), nullable=False))
    op.create_index("ix_import_profile_aliases_canonical_profile_id", "import_profile_aliases", ["canonical_profile_id"])
    op.add_column("import_profile_revisions", sa.Column("configuration_digest", sa.String(64)))
    op.create_index("ix_import_profile_revisions_configuration_digest", "import_profile_revisions", ["configuration_digest"])
    op.add_column("import_profile_revisions", sa.Column("created_by_user_id", sa.Uuid()))
    op.create_foreign_key("fk_import_revision_creator", "import_profile_revisions", "users", ["created_by_user_id"], ["id"], ondelete="SET NULL")
    # Establish all historical grants before changing ownership/deletion rules.
    op.execute("""INSERT INTO import_profile_grants (user_id, revision_id, reason, acquired_at)
        SELECT p.owner_user_id, r.id, 'MIGRATED', r.created_at FROM import_profile_revisions r
        JOIN import_profiles p ON p.id = r.profile_id WHERE p.owner_user_id IS NOT NULL""")
    op.execute("""INSERT INTO import_profile_preferences (user_id, profile_id, display_name, enabled, hidden)
        SELECT owner_user_id, id, name, status = 'ACTIVE', false FROM import_profiles WHERE owner_user_id IS NOT NULL""")
    op.execute("""UPDATE import_profile_revisions SET created_by_user_id = p.owner_user_id
        FROM import_profiles p WHERE p.id = import_profile_revisions.profile_id""")
    op.drop_constraint("ck_import_profiles_builtin_or_owned", "import_profiles", type_="check")
    op.drop_constraint("fk_import_profiles_owner_user_id", "import_profiles", type_="foreignkey")
    op.create_foreign_key("fk_import_profiles_owner_user_id", "import_profiles", "users", ["owner_user_id"], ["id"], ondelete="SET NULL")
    connection = op.get_bind()
    metadata = sa.MetaData()
    profiles = sa.Table("import_profiles", metadata, autoload_with=connection)
    revisions = sa.Table("import_profile_revisions", metadata, autoload_with=connection)
    preferences = sa.Table("import_profile_preferences", metadata, autoload_with=connection)
    aliases = sa.Table("import_profile_aliases", metadata, autoload_with=connection)
    # Complete configuration sets must agree. Sharing just one structure or
    # revision is insufficient to merge independently learned formats.
    groups = defaultdict(list)
    for profile in connection.execute(sa.select(profiles).where(profiles.c.kind == "LEARNED").order_by(profiles.c.created_at, profiles.c.id)).mappings():
        digests = []
        for item in connection.execute(sa.select(revisions).where(revisions.c.profile_id == profile["id"]).order_by(revisions.c.revision)).mappings():
            digest = configuration_digest_v1(source_mode=profile["source_mode"], **{key: item[key] for key in (
                "source_signature", "match_spec", "mapping_spec", "validation_spec", "matcher_version", "normalizer_version")})
            connection.execute(revisions.update().where(revisions.c.id == item["id"]).values(configuration_digest=digest))
            digests.append(digest)
        if digests:
            groups[tuple(sorted(set(digests)))].append(profile)
    for identical in groups.values():
        canonical = identical[0]
        for duplicate in identical[1:]:
            connection.execute(aliases.insert().values(old_profile_id=duplicate["id"], canonical_profile_id=canonical["id"]))
            # Keep old IDs and revision parents intact. Runtime resolves aliases
            # and combines grants without rewriting historical import pointers.
            if duplicate["owner_user_id"] is not None:
                exists = connection.execute(sa.select(preferences.c.user_id).where(
                    preferences.c.user_id == duplicate["owner_user_id"], preferences.c.profile_id == canonical["id"])).first()
                if not exists:
                    connection.execute(preferences.insert().values(user_id=duplicate["owner_user_id"], profile_id=canonical["id"],
                        display_name=duplicate["name"], enabled=duplicate["status"] == "ACTIVE", hidden=False))
    # Global registry availability is independent from migrated personal toggles.
    op.execute("UPDATE import_profiles SET status = 'ACTIVE' WHERE kind = 'LEARNED'")


def downgrade() -> None:
    # Older code cannot represent shared formats after author deletion. Refuse
    # unsafe downgrade rather than deleting them or inventing a new owner.
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM import_profiles WHERE kind <> 'BUILTIN' AND owner_user_id IS NULL LIMIT 1")).first():
        raise RuntimeError("Shared formats without a source account require restoring the pre-migration backup to downgrade.")
    op.execute("""UPDATE import_profiles p SET status = CASE WHEN pref.enabled AND NOT pref.hidden THEN 'ACTIVE' ELSE 'DISABLED' END,
        name = COALESCE(pref.display_name, p.name)
        FROM import_profile_preferences pref WHERE pref.user_id = p.owner_user_id AND pref.profile_id = p.id""")
    op.drop_table("import_profile_aliases")
    op.drop_table("import_profile_publications")
    op.drop_table("import_profile_preferences")
    op.drop_table("import_profile_grants")
    op.drop_constraint("fk_import_revision_creator", "import_profile_revisions", type_="foreignkey")
    op.drop_column("import_profile_revisions", "created_by_user_id")
    op.drop_index("ix_import_profile_revisions_configuration_digest", table_name="import_profile_revisions")
    op.drop_column("import_profile_revisions", "configuration_digest")
    op.drop_constraint("fk_import_profiles_owner_user_id", "import_profiles", type_="foreignkey")
    op.create_foreign_key("fk_import_profiles_owner_user_id", "import_profiles", "users", ["owner_user_id"], ["id"], ondelete="CASCADE")
    op.create_check_constraint("ck_import_profiles_builtin_or_owned", "import_profiles", "kind = 'BUILTIN' OR owner_user_id IS NOT NULL")
