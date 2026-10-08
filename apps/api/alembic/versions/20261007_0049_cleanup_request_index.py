"""Index durable cleanup admission identity independently of completion."""
from alembic import op
import sqlalchemy as sa

revision = "20261007_0049"
down_revision = "20261006_0048"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("idx_background_jobs_cleanup_request", "background_jobs", [
        "owner_user_id", "job_type", sa.column("payload", sa.JSON)["cleanup_request_key"].as_string(),
    ])


def downgrade():
    op.drop_index("idx_background_jobs_cleanup_request", table_name="background_jobs")
