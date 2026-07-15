"""add durable import queue state

Revision ID: 20260715_0006
Revises: 20260707_0005
Create Date: 2026-07-15 00:06:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "20260715_0006"
down_revision: str | None = "20260707_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("imports", sa.Column("phase", sa.Text(), nullable=False, server_default="previewed"))
    op.add_column("imports", sa.Column("progress", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("imports", sa.Column("processed_messages", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("imports", sa.Column("total_messages", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("imports", sa.Column("queued_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("imports", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("imports", sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("imports", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("imports", sa.Column("error_message", sa.Text(), nullable=True))
    op.add_column("imports", sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("idx_imports_status_queued_at", "imports", ["status", "queued_at"])


def downgrade() -> None:
    op.drop_index("idx_imports_status_queued_at", table_name="imports")
    for column in (
        "attempt_count",
        "error_message",
        "completed_at",
        "heartbeat_at",
        "started_at",
        "queued_at",
        "total_messages",
        "processed_messages",
        "progress",
        "phase",
    ):
        op.drop_column("imports", column)
