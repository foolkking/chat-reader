"""Add query indexes used by the separated attachment/message save path.

Revision ID: 20260806_0021
Revises: 20260805_0020
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260806_0021"
down_revision: str | None = "20260805_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "idx_attachments_conversation_id_id",
        "attachments",
        ["conversation_id", "id"],
    )
    op.create_index(
        "idx_message_versions_message_created_at",
        "message_versions",
        ["message_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_message_versions_message_created_at", table_name="message_versions")
    op.drop_index("idx_attachments_conversation_id_id", table_name="attachments")
