import os
import subprocess
from pathlib import Path

from sqlalchemy.dialects import postgresql

from app.models.search_document import SearchDocument


def test_alembic_current_matches_repository_head() -> None:
    env = os.environ.copy()
    env["PATH"] = r"E:\PostgreSQL\17\bin;" + env.get("PATH", "")
    current = subprocess.run(
        ["alembic", "current"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    heads = subprocess.run(
        ["alembic", "heads"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    assert "20260806_0021" in current.stdout
    assert heads.stdout.strip() == "20260806_0021 (head)"


def test_latest_migration_has_upgrade_and_downgrade() -> None:
    migration = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260806_0021_attachment_workflow_performance.py"
    source = migration.read_text(encoding="utf-8")
    assert "def upgrade()" in source
    assert "def downgrade()" in source
    assert "idx_attachments_conversation_id_id" in source
    assert "idx_message_versions_message_created_at" in source


def test_search_document_model_uses_postgresql_tsvector_type() -> None:
    search_tsv_type = SearchDocument.__table__.c.search_tsv.type.dialect_impl(postgresql.dialect())
    assert isinstance(search_tsv_type, postgresql.TSVECTOR)
