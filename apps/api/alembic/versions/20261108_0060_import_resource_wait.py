"""Eligible-at scheduling for bounded import resource waits."""
from alembic import op
import sqlalchemy as sa

revision = "20261108_0060"
down_revision = "20261105_0059"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("imports", "background_jobs"):
        op.add_column(table, sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index(f"idx_{table}_status_next_run", table, ["status", "next_run_at"])


def downgrade():
    for table in ("background_jobs", "imports"):
        op.drop_index(f"idx_{table}_status_next_run", table_name=table)
        op.drop_column(table, "next_run_at")
