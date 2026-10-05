"""Short-lived export policy, recoverable reclamation and download fences."""
from alembic import op
import sqlalchemy as sa

revision = "20261006_0048"
down_revision = "20261005_0047"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("instance_feature_policies") as batch:
        batch.add_column(sa.Column("export_retention_minutes", sa.Integer(), nullable=False, server_default="3"))
        batch.add_column(sa.Column("export_release_on_close", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.create_check_constraint("ck_feature_export_retention", "export_retention_minutes BETWEEN 1 AND 60")
    with op.batch_alter_table("export_artifacts") as batch:
        batch.add_column(sa.Column("lifecycle_state", sa.String(16), nullable=False, server_default="active"))
        batch.add_column(sa.Column("retention_seconds", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("release_on_close", sa.Boolean(), nullable=False, server_default=sa.false()))
        for name in ("policy_updated_at", "release_requested_at", "reclaimed_at", "retry_at"):
            batch.add_column(sa.Column(name, sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("failure_count", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("failure_code", sa.String(32), nullable=True))
        batch.create_check_constraint("ck_export_artifact_lifecycle", "lifecycle_state IN ('active', 'reclaiming', 'retry', 'reclaimed')")
        batch.create_index("idx_export_artifact_reclamation", ["lifecycle_state", "retry_at", "expires_at"])
    op.create_table(
        "export_artifact_leases",
        sa.Column("artifact_id", sa.Uuid(), sa.ForeignKey("export_artifacts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('viewer', 'claim', 'download')", name="ck_export_artifact_lease_kind"),
    )
    op.create_index("idx_export_artifact_leases_expiry", "export_artifact_leases", ["expires_at"])


def downgrade():
    op.drop_table("export_artifact_leases")
    with op.batch_alter_table("export_artifacts") as batch:
        batch.drop_index("idx_export_artifact_reclamation")
        batch.drop_constraint("ck_export_artifact_lifecycle", type_="check")
        for name in ("lifecycle_state", "retention_seconds", "release_on_close", "policy_updated_at",
                     "release_requested_at", "reclaimed_at", "retry_at", "failure_count", "failure_code"):
            batch.drop_column(name)
    with op.batch_alter_table("instance_feature_policies") as batch:
        batch.drop_constraint("ck_feature_export_retention", type_="check")
        batch.drop_column("export_retention_minutes")
        batch.drop_column("export_release_on_close")
