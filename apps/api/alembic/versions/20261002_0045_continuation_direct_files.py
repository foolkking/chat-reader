"""Allow direct Current/Index updates without a complete Pair."""
from alembic import op
import sqlalchemy as sa
revision = "20261002_0045"
down_revision = "20261002_0044"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("continuation_revisions") as batch:
        batch.alter_column("current_sha256", existing_type=sa.String(64), nullable=True)
        batch.alter_column("index_sha256", existing_type=sa.String(64), nullable=True)


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT COUNT(*) FROM continuation_revisions WHERE current_sha256 IS NULL OR index_sha256 IS NULL")).scalar():
        raise RuntimeError("Partial continuation files must be exported or completed before downgrade")
    with op.batch_alter_table("continuation_revisions") as batch:
        batch.alter_column("current_sha256", existing_type=sa.String(64), nullable=False)
        batch.alter_column("index_sha256", existing_type=sa.String(64), nullable=False)
