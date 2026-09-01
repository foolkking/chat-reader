"""Persist the deployment administrator configuration digest.

Revision ID: 20260901_0031
Revises: 20260901_0030
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_0031"
down_revision: str | None = "20260901_0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "auth_principals",
        sa.Column("deployment_config_digest", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("auth_principals", "deployment_config_digest")
