"""Private support requests and explicit per-user limit increases."""
from alembic import op
import sqlalchemy as sa

revision = "20261005_0047"
down_revision = "20261003_0046"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "support_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("requested_limits", sa.JSON(), nullable=False),
        sa.Column("approved_limits", sa.JSON(), nullable=False),
        sa.Column("notify_replies", sa.Boolean(), nullable=False),
        sa.Column("creation_key", sa.String(100), nullable=False),
        sa.Column("creation_digest", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("owner_user_id", "creation_key", name="uq_support_request_creation"),
        sa.CheckConstraint("kind IN ('LIMIT', 'QUESTION', 'ISSUE')", name="ck_support_request_kind"),
        sa.CheckConstraint("status IN ('OPEN', 'WAITING', 'APPROVED', 'REJECTED', 'RESOLVED', 'WITHDRAWN', 'IMPORTED')", name="ck_support_request_status"),
        sa.CheckConstraint("revision >= 1", name="ck_support_request_revision"),
    )
    op.create_table(
        "support_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("request_id", sa.Uuid(), sa.ForeignKey("support_requests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("author_role", sa.String(16), nullable=False),
        sa.Column("operation", sa.String(16), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("operation_key", sa.String(100), nullable=False),
        sa.Column("operation_digest", sa.String(64), nullable=False),
        sa.Column("mail_state", sa.String(20), nullable=False),
        sa.Column("notification_job_id", sa.Uuid(), sa.ForeignKey("background_jobs.id", ondelete="SET NULL")),
        sa.Column("notification_attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("request_id", "operation_key", name="uq_support_message_operation"),
        sa.CheckConstraint("author_role IN ('USER', 'ADMIN', 'IMPORTED')", name="ck_support_message_author"),
        sa.CheckConstraint("mail_state IN ('NOT_REQUESTED', 'UNAVAILABLE', 'QUEUED', 'SENDING', 'ACCEPTED', 'FAILED', 'UNKNOWN')", name="ck_support_message_mail_state"),
    )
    op.create_table(
        "user_limit_overrides",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("import_size_mb", sa.Integer()),
        sa.Column("merge_message_count", sa.Integer()),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("last_operation_key", sa.String(100)),
        sa.Column("last_operation_digest", sa.String(64)),
        sa.Column("change_reason", sa.Text()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("import_size_mb IS NULL OR (import_size_mb >= 1 AND import_size_mb <= 10240)", name="ck_user_limit_import"),
        sa.CheckConstraint("merge_message_count IS NULL OR (merge_message_count >= 2 AND merge_message_count <= 100000)", name="ck_user_limit_merge"),
        sa.CheckConstraint("revision >= 1", name="ck_user_limit_revision"),
    )
    op.create_index("idx_support_owner_updated", "support_requests", ["owner_user_id", "updated_at", "id"])
    op.create_index("idx_support_status_updated", "support_requests", ["status", "updated_at", "id"])
    op.create_index("idx_support_messages_request", "support_messages", ["request_id", "created_at", "id"])
    op.create_index("idx_support_messages_author", "support_messages", ["author_user_id", "created_at"])


def downgrade():
    op.drop_table("user_limit_overrides")
    op.drop_table("support_messages")
    op.drop_table("support_requests")
