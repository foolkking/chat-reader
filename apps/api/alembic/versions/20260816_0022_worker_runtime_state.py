"""Add the singleton worker liveness state.

Revision ID: 20260816_0022
Revises: 20260806_0021
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0022"
down_revision: str | None = "20260806_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "worker_runtime_states",
        sa.Column("worker_key", sa.String(), nullable=False),
        sa.Column("instance_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("task_kind", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("state IN ('idle', 'busy')", name="ck_worker_runtime_states_state"),
        sa.CheckConstraint(
            "task_kind IS NULL OR task_kind IN ('import', 'job')",
            name="ck_worker_runtime_states_task_kind",
        ),
        sa.CheckConstraint(
            "(state = 'idle' AND task_kind IS NULL) OR "
            "(state = 'busy' AND task_kind IS NOT NULL)",
            name="ck_worker_runtime_states_state_task_kind",
        ),
        sa.PrimaryKeyConstraint("worker_key"),
    )


def downgrade() -> None:
    op.drop_table("worker_runtime_states")
