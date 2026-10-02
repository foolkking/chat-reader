"""Durable, paginated system archive identity review.

Revision ID: 20261002_0042
Revises: 20261001_0041
"""
from alembic import op
import sqlalchemy as sa

revision = "20261002_0042"
down_revision = "20261001_0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("archive_restore_accounts",
        sa.Column("preview_job_id", sa.Uuid(), sa.ForeignKey("background_jobs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("source_key", sa.String(120), primary_key=True),
        sa.Column("source_role", sa.String(20), nullable=False),
        sa.Column("normalized_email", sa.String(320), nullable=True),
        sa.Column("display_name", sa.String(200), nullable=True),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("target_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("decision IN ('ROOT', 'NEW', 'EXISTING', 'UNSET')", name="ck_archive_restore_account_decision"))


def downgrade() -> None:
    op.drop_table("archive_restore_accounts")
