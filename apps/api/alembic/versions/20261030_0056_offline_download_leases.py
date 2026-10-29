"""protect superseded offline packages during browser downloads"""
from alembic import op
import sqlalchemy as sa


revision = "20261030_0056"
down_revision = "20261030_0055"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "offline_package_leases",
        sa.Column("storage_uri", sa.Text(), nullable=False),
        sa.Column("lease_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("storage_uri", "lease_id", name="pk_offline_package_leases"),
    )
    op.create_index(
        "idx_offline_package_leases_expiry",
        "offline_package_leases",
        ["expires_at"],
        unique=False,
    )


def downgrade():
    op.drop_index("idx_offline_package_leases_expiry", table_name="offline_package_leases")
    op.drop_table("offline_package_leases")
