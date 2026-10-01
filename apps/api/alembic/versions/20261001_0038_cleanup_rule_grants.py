"""Retain acquired noise-rule versions independently of system publication.

Revision ID: 20261001_0038
Revises: 20260930_0037
"""
from collections import defaultdict

import sqlalchemy as sa
from alembic import op

from app.services.cleanup_rule_identity import MATCH_FIELDS, configuration_digest_v1

revision = "20261001_0038"
down_revision = "20260930_0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("content_cleanup_rule_grants",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("content_cleanup_rule_revisions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("reason", sa.String(16), nullable=False), sa.Column("acquired_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("content_cleanup_rule_publications",
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("content_cleanup_rules.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision_id", sa.Uuid(), sa.ForeignKey("content_cleanup_rule_revisions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("published_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False), sa.Column("withdrawn_at", sa.DateTime(timezone=True)))
    op.create_table("content_cleanup_rule_aliases",
        sa.Column("old_rule_id", sa.Uuid(), sa.ForeignKey("content_cleanup_rules.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("canonical_rule_id", sa.Uuid(), sa.ForeignKey("content_cleanup_rules.id", ondelete="RESTRICT"), nullable=False))
    op.create_index("ix_content_cleanup_rule_aliases_canonical_rule_id", "content_cleanup_rule_aliases", ["canonical_rule_id"])
    op.add_column("content_cleanup_rule_preferences", sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("content_cleanup_rule_preferences", sa.Column("display_name", sa.String(200)))
    op.add_column("content_cleanup_rule_preferences", sa.Column("current_revision_id", sa.Uuid()))
    op.create_foreign_key("fk_cleanup_preference_revision", "content_cleanup_rule_preferences", "content_cleanup_rule_revisions", ["current_revision_id"], ["id"], ondelete="SET NULL")
    op.add_column("content_cleanup_rule_revisions", sa.Column("configuration_digest", sa.String(64)))
    op.create_index("ix_content_cleanup_rule_revisions_configuration_digest", "content_cleanup_rule_revisions", ["configuration_digest"])
    op.add_column("content_cleanup_rule_revisions", sa.Column("created_by_user_id", sa.Uuid()))
    op.create_foreign_key("fk_cleanup_revision_creator", "content_cleanup_rule_revisions", "users", ["created_by_user_id"], ["id"], ondelete="SET NULL")
    # Establish ownership before changing cascades. No historical rule is public.
    op.execute("""INSERT INTO content_cleanup_rule_grants (user_id, revision_id, reason, acquired_at)
        SELECT r.owner_user_id, v.id, 'MIGRATED', v.created_at FROM content_cleanup_rules r
        JOIN content_cleanup_rule_revisions v ON v.rule_id = r.id WHERE r.kind = 'USER_LITERAL' AND r.owner_user_id IS NOT NULL""")
    op.execute("""INSERT INTO content_cleanup_rule_preferences (user_id, rule_id, enabled, hidden, display_name, current_revision_id, updated_at)
        SELECT r.owner_user_id, r.id, r.status = 'ACTIVE', false, r.name,
        (SELECT v.id FROM content_cleanup_rule_revisions v WHERE v.rule_id = r.id ORDER BY v.revision DESC LIMIT 1), r.updated_at
        FROM content_cleanup_rules r WHERE r.kind = 'USER_LITERAL' AND r.owner_user_id IS NOT NULL
        ON CONFLICT (user_id, rule_id) DO UPDATE SET
          display_name = COALESCE(content_cleanup_rule_preferences.display_name, EXCLUDED.display_name),
          current_revision_id = COALESCE(content_cleanup_rule_preferences.current_revision_id, EXCLUDED.current_revision_id)""")
    op.execute("""UPDATE content_cleanup_rule_revisions v SET created_by_user_id = r.owner_user_id
        FROM content_cleanup_rules r WHERE r.id = v.rule_id""")
    op.drop_constraint("fk_content_cleanup_rules_owner_user_id", "content_cleanup_rules", type_="foreignkey")
    op.create_foreign_key("fk_content_cleanup_rules_owner_user_id", "content_cleanup_rules", "users", ["owner_user_id"], ["id"], ondelete="SET NULL")
    connection = op.get_bind()
    metadata = sa.MetaData()
    rules = sa.Table("content_cleanup_rules", metadata, autoload_with=connection)
    revisions = sa.Table("content_cleanup_rule_revisions", metadata, autoload_with=connection)
    preferences = sa.Table("content_cleanup_rule_preferences", metadata, autoload_with=connection)
    aliases = sa.Table("content_cleanup_rule_aliases", metadata, autoload_with=connection)
    groups = defaultdict(list)
    for rule in connection.execute(sa.select(rules).where(rules.c.kind == "USER_LITERAL").order_by(rules.c.created_at, rules.c.id)).mappings():
        digests = []
        for item in connection.execute(sa.select(revisions).where(revisions.c.rule_id == rule["id"])).mappings():
            digest = configuration_digest_v1({key: item[key] for key in MATCH_FIELDS}, scope=rule["scope"])
            connection.execute(revisions.update().where(revisions.c.id == item["id"]).values(configuration_digest=digest))
            digests.append(digest)
        if digests:
            groups[tuple(sorted(set(digests)))].append(rule)
    for identical in groups.values():
        canonical = identical[0]
        for duplicate in identical[1:]:
            connection.execute(aliases.insert().values(old_rule_id=duplicate["id"], canonical_rule_id=canonical["id"]))
            if duplicate["owner_user_id"] is not None:
                previous = connection.execute(sa.select(preferences).where(preferences.c.user_id == duplicate["owner_user_id"], preferences.c.rule_id == duplicate["id"])).mappings().first()
                exists = connection.execute(sa.select(preferences.c.user_id).where(preferences.c.user_id == duplicate["owner_user_id"], preferences.c.rule_id == canonical["id"])).first()
                if previous and not exists:
                    connection.execute(preferences.insert().values(**{**dict(previous), "rule_id": canonical["id"]}))
    op.execute("UPDATE content_cleanup_rules SET status = 'ACTIVE' WHERE kind = 'USER_LITERAL'")


def downgrade() -> None:
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT 1 FROM content_cleanup_rules WHERE kind = 'USER_LITERAL' AND owner_user_id IS NULL LIMIT 1")).first():
        raise RuntimeError("Retained rules without a source account require restoring the pre-migration backup to downgrade.")
    op.execute("""UPDATE content_cleanup_rules r SET name = COALESCE(p.display_name, r.name),
        status = CASE WHEN p.enabled AND NOT p.hidden THEN 'ACTIVE' ELSE 'DISABLED' END
        FROM content_cleanup_rule_preferences p WHERE p.rule_id = r.id AND p.user_id = r.owner_user_id""")
    op.drop_table("content_cleanup_rule_aliases")
    op.drop_table("content_cleanup_rule_publications")
    op.drop_table("content_cleanup_rule_grants")
    op.drop_constraint("fk_cleanup_preference_revision", "content_cleanup_rule_preferences", type_="foreignkey")
    for column in ("current_revision_id", "display_name", "hidden"):
        op.drop_column("content_cleanup_rule_preferences", column)
    op.drop_constraint("fk_cleanup_revision_creator", "content_cleanup_rule_revisions", type_="foreignkey")
    op.drop_column("content_cleanup_rule_revisions", "created_by_user_id")
    op.drop_index("ix_content_cleanup_rule_revisions_configuration_digest", table_name="content_cleanup_rule_revisions")
    op.drop_column("content_cleanup_rule_revisions", "configuration_digest")
    op.drop_constraint("fk_content_cleanup_rules_owner_user_id", "content_cleanup_rules", type_="foreignkey")
    op.create_foreign_key("fk_content_cleanup_rules_owner_user_id", "content_cleanup_rules", "users", ["owner_user_id"], ["id"], ondelete="CASCADE")
