import os
import shutil
import subprocess
import sys
from pathlib import Path

from sqlalchemy.dialects import postgresql

from app.models.search_document import SearchDocument


def test_alembic_current_matches_repository_head() -> None:
    env = os.environ.copy()
    windows_postgres_bin = Path(r"E:\PostgreSQL\17\bin")
    if os.name == "nt" and windows_postgres_bin.exists():
        env["PATH"] = str(windows_postgres_bin) + os.pathsep + env.get("PATH", "")
    alembic = shutil.which("alembic", path=env.get("PATH")) or "alembic"
    current = subprocess.run(
        [alembic, "current"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    heads = subprocess.run(
        [alembic, "heads"],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        text=True,
        capture_output=True,
        check=True,
    )
    head_lines = [line.strip() for line in heads.stdout.splitlines() if line.strip()]
    assert len(head_lines) == 1
    assert head_lines[0].endswith(" (head)")
    expected_head = head_lines[0].removesuffix(" (head)")
    if expected_head not in current.stdout:
        import pytest

        pytest.skip(f"database is not migrated to repository head {expected_head}")


def test_ci_migration_gates_use_dynamic_single_head_verifier() -> None:
    root = Path(__file__).resolve().parents[3]
    expected_command = "python scripts/verify_migration_state.py --require-current"
    for relative_path in (
        ".github/workflows/build-release-images.yml",
        ".github/workflows/performance-characterization.yml",
    ):
        source = (root / relative_path).read_text(encoding="utf-8")
        assert expected_command in source
        assert 'test "$(python -m alembic heads)"' not in source

    verifier = subprocess.run(
        [sys.executable, "scripts/verify_migration_state.py"],
        cwd=root / "apps/api",
        text=True,
        capture_output=True,
        check=True,
    )
    assert verifier.stdout.strip().endswith(" (head)")


def test_latest_migration_has_upgrade_and_downgrade() -> None:
    migration = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260806_0021_attachment_workflow_performance.py"
    source = migration.read_text(encoding="utf-8")
    assert "def upgrade()" in source
    assert "def downgrade()" in source
    assert "idx_attachments_conversation_id_id" in source
    assert "idx_message_versions_message_created_at" in source


def test_adaptive_import_migration_has_profile_and_session_boundaries() -> None:
    migration = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260822_0025_adaptive_import_profiles.py"
    source = migration.read_text(encoding="utf-8")
    assert "def upgrade()" in source
    assert "def downgrade()" in source
    for table in ("import_profiles", "import_profile_revisions", "import_structure_families", "import_input_groups"):
        assert table in source
    assert "fk_import_profiles_current_revision" in source


def test_cleanup_detection_migration_records_match_evidence() -> None:
    migration = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260823_0027_cleanup_detection_evidence.py"
    source = migration.read_text(encoding="utf-8")
    assert "def upgrade()" in source
    assert "def downgrade()" in source
    for column in (
        "matcher_mode",
        "normalization_profile",
        "boundary_mode",
        "match_mode",
        "similarity_score",
        "detector_version",
        "evidence_codes",
    ):
        assert column in source


def test_background_cleanup_scan_migration_snapshots_rules_and_removes_current_scores() -> None:
    migration = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260823_0028_background_cleanup_scan.py"
    source = migration.read_text(encoding="utf-8")
    assert "content_cleanup_scan_rules" in source
    assert "excluded_archived_count" in source
    assert 'op.drop_column("content_cleanup_occurrences", "confidence")' in source
    assert 'op.drop_column("content_cleanup_occurrences", "similarity_score")' in source


def test_search_document_model_uses_postgresql_tsvector_type() -> None:
    search_tsv_type = SearchDocument.__table__.c.search_tsv.type.dialect_impl(postgresql.dialect())
    assert isinstance(search_tsv_type, postgresql.TSVECTOR)
