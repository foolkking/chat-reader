"""expand annotation types for reader marks

Revision ID: 20260724_0015
Revises: 20260723_0014
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260724_0015"
down_revision: str | None = "20260723_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_annotation_type", "conversation_annotations", type_="check")
    op.create_check_constraint(
        "ck_annotation_type",
        "conversation_annotations",
        "annotation_type IN ('highlight','underline','strikethrough','comment','bookmark')",
    )


def downgrade() -> None:
    op.execute(
        "UPDATE conversation_annotations SET annotation_type = 'highlight' "
        "WHERE annotation_type IN ('underline','strikethrough','comment')"
    )
    op.drop_constraint("ck_annotation_type", "conversation_annotations", type_="check")
    op.create_check_constraint(
        "ck_annotation_type",
        "conversation_annotations",
        "annotation_type IN ('highlight','bookmark')",
    )
