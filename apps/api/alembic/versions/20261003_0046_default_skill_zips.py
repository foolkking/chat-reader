"""Select the three user-supplied ZIP defaults; preserve personal selections."""
from alembic import op
import sqlalchemy as sa

revision = '20261003_0046'
down_revision = '20261002_0045'
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    connection.execute(sa.text("UPDATE system_skills SET default_enabled = false WHERE category IN ('EXPORT_CONTEXT', 'CONVERSATION_RESCUE', 'CONTEXT_MAINTENANCE')"))
    connection.execute(sa.text("""UPDATE system_skills SET default_enabled = true,
        status = 'ACTIVE', content = NULL, content_digest = NULL, byte_size = NULL,
        bundle_revision = 0 WHERE source_kind = 'BUNDLED' AND bundled_key IN
        ('builtin:export:zh-CN', 'builtin:export:en', 'builtin:rescue:zh-CN',
         'builtin:rescue:en', 'builtin:maintenance:zh-CN', 'builtin:maintenance:en')"""))


def downgrade():
    # This is a user-requested default replacement. Previous content versions
    # remain in Skill revision history; do not silently reselect them on downgrade.
    pass
