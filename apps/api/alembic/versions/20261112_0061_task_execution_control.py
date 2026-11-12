"""Independent, fenced control for the single supervised task execution."""
from alembic import op
import sqlalchemy as sa

revision = "20261112_0061"
down_revision = "20261108_0060"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("asset_objects", sa.Column("storage_deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "task_execution_controls",
        sa.Column("slot", sa.String(32), primary_key=True),
        sa.Column("token", sa.Uuid(), nullable=False, unique=True),
        sa.Column("task_kind", sa.String(16), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("progress_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stop_requested_at", sa.DateTime(timezone=True)),
        sa.Column("stop_reason", sa.String(48)),
        sa.Column("source_disposition", sa.String(16)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
    )


def downgrade():
    op.drop_table("task_execution_controls")
    op.drop_column("asset_objects", "storage_deleted_at")
