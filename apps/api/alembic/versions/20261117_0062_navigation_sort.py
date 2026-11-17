"""Scoped navigation preferences; retain existing user arrangements."""
from alembic import op
import sqlalchemy as sa
import uuid

revision = "20261117_0062"
down_revision = "20261112_0061"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_user_preferences_conversation_sort_mode", "user_preferences", type_="check")
    op.create_check_constraint("ck_user_preferences_conversation_sort_mode", "user_preferences",
        "conversation_sort_mode IN ('recent_read','content_updated','updated','created','imported','title','message_count','custom')")
    op.alter_column("user_preferences", "project_sort_mode", server_default="custom")
    op.alter_column("user_preferences", "project_sort_direction", server_default="asc")
    op.add_column("conversations", sa.Column("unclassified_sort_order", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE conversations SET unclassified_sort_order = manual_sort_order")
    op.create_index("idx_conversations_owner_unclassified_order", "conversations", ["owner_user_id", "unclassified_sort_order"])
    op.add_column("user_preferences", sa.Column("navigation_sort", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("projects", sa.Column("conversation_sort", sa.JSON(), nullable=True))
    op.add_column("projects", sa.Column("sort_revision", sa.Integer(), nullable=False, server_default="1"))
    table = sa.table("user_preferences", sa.column("subject_key"), sa.column("conversation_sort_mode"),
                     sa.column("conversation_sort_direction"), sa.column("navigation_sort", sa.JSON()),
                     sa.column("field_revisions", sa.JSON()))
    conversations = sa.table("conversations", sa.column("owner_user_id", sa.Uuid()),
                             sa.column("manual_sort_order", sa.Integer()))
    projects = sa.table("projects", sa.column("id", sa.Uuid()), sa.column("owner_user_id", sa.Uuid()))
    bind = op.get_bind()
    for row in bind.execute(sa.select(table)):
        value = {"mode": row.conversation_sort_mode, "direction": row.conversation_sort_direction}
        revisions = dict(row.field_revisions or {})
        try:
            owner = uuid.UUID(row.subject_key)
        except ValueError:
            owner = None
        # Zero is the pre-existing unsorted default. Nonzero positions (or an
        # explicitly selected custom mode) are evidence of a saved arrangement.
        # Never mark untouched automatic lists as already initialized.
        saved = row.conversation_sort_mode == "custom" or bind.scalar(sa.select(sa.func.count()).select_from(
            conversations).where(conversations.c.owner_user_id == owner, conversations.c.manual_sort_order != 0))
        if saved:
            revisions.update({"_manual:all:": 1, "_manual:unclassified:": 1})
        # Project placement has always persisted a manual order, even while an
        # automatic view was selected. Preserve those independently.
        for project_id in bind.scalars(sa.select(projects.c.id).where(projects.c.owner_user_id == owner)):
            revisions[f"_manual:project:{project_id}"] = 1
        bind.execute(table.update().where(table.c.subject_key == row.subject_key).values(
            navigation_sort={"all": value, "project_default": value, "unclassified": value, "blocks": "projects_first"},
            field_revisions=revisions))


def downgrade():
    op.drop_constraint("ck_user_preferences_conversation_sort_mode", "user_preferences", type_="check")
    op.execute("UPDATE user_preferences SET conversation_sort_mode = 'updated' WHERE conversation_sort_mode = 'content_updated'")
    op.create_check_constraint("ck_user_preferences_conversation_sort_mode", "user_preferences",
        "conversation_sort_mode IN ('recent_read','updated','created','imported','title','message_count','custom')")
    op.alter_column("user_preferences", "project_sort_mode", server_default="recent_read")
    op.alter_column("user_preferences", "project_sort_direction", server_default="desc")
    op.drop_index("idx_conversations_owner_unclassified_order", table_name="conversations")
    op.drop_column("conversations", "unclassified_sort_order")
    op.drop_column("projects", "sort_revision")
    op.drop_column("projects", "conversation_sort")
    op.drop_column("user_preferences", "navigation_sort")
