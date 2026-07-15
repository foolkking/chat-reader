"""background jobs and single project membership

Revision ID: 20260715_0007
Revises: 20260715_0006
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260715_0007"
down_revision: str | None = "20260715_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "background_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("job_type", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="queued"),
        sa.Column("phase", sa.String(), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("idempotency_key", sa.String(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("queued_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_background_jobs_status_queued_at", "background_jobs", ["status", "queued_at"])
    op.create_index("idx_background_jobs_type_status", "background_jobs", ["job_type", "status"])
    op.create_index("idx_background_jobs_idempotency_key", "background_jobs", ["idempotency_key"])

    op.execute(
        """
        WITH ranked AS (
          SELECT pc.id,
                 row_number() OVER (
                   PARTITION BY pc.conversation_id
                   ORDER BY
                     CASE
                       WHEN p.is_default = false AND pc.is_pinned = true THEN 0
                       WHEN p.is_default = false THEN 1
                       ELSE 2
                     END,
                     pc.added_at DESC,
                     pc.id
                 ) AS position
          FROM project_conversations pc
          JOIN projects p ON p.id = pc.project_id
        )
        DELETE FROM project_conversations pc
        USING ranked
        WHERE pc.id = ranked.id AND ranked.position > 1
        """
    )
    op.execute(
        """
        INSERT INTO project_conversations (
          id, project_id, conversation_id, sort_order, is_pinned,
          pinned_at, added_at, added_by
        )
        SELECT
          md5(c.id::text || p.id::text)::uuid,
          p.id,
          c.id,
          0,
          false,
          NULL,
          now(),
          'migration'
        FROM conversations c
        CROSS JOIN LATERAL (
          SELECT id
          FROM projects
          WHERE is_default = true
          ORDER BY created_at ASC
          LIMIT 1
        ) p
        WHERE NOT EXISTS (
          SELECT 1
          FROM project_conversations pc
          WHERE pc.conversation_id = c.id
        )
        """
    )
    op.create_unique_constraint(
        "uq_project_conversations_conversation",
        "project_conversations",
        ["conversation_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_project_conversations_conversation", "project_conversations", type_="unique")
    op.drop_index("idx_background_jobs_idempotency_key", table_name="background_jobs")
    op.drop_index("idx_background_jobs_type_status", table_name="background_jobs")
    op.drop_index("idx_background_jobs_status_queued_at", table_name="background_jobs")
    op.drop_table("background_jobs")
