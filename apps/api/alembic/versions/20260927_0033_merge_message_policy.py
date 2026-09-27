"""Add the administrator-controlled conversation merge message limit.

Revision ID: 20260927_0033
Revises: 20260902_0032
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260927_0033"
down_revision: str | None = "20260902_0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "instance_feature_policies",
        sa.Column(
            "maximum_merge_message_count",
            sa.Integer(),
            nullable=False,
            server_default="1000",
        ),
    )
    op.create_check_constraint(
        "ck_instance_feature_policies_merge_message_count",
        "instance_feature_policies",
        "maximum_merge_message_count >= 2",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_instance_feature_policies_merge_message_count",
        "instance_feature_policies",
        type_="check",
    )
    op.drop_column("instance_feature_policies", "maximum_merge_message_count")
