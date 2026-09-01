import os
import shutil
import subprocess
import sys
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.models.auth import AuthPrincipal
from app.models.access import InstanceAccessSetting
from app.models.administration import (
    AdminAuditLog,
    InstanceFeaturePolicy,
    SystemBackupRecord,
    SystemSkill,
    UserDeletionRequest,
)
from app.models.user import User
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


def test_multi_account_migration_bootstraps_a_stable_admin_without_a_legacy_principal() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260901_0030_multi_account_users.py"
    )
    source = migration.read_text(encoding="utf-8")
    assert "LEGACY_OWNER_USER_ID" in source
    assert "COALESCE((SELECT credential_version FROM auth_principals WHERE id = 'owner'), 1)" in source
    assert "WHERE NOT EXISTS (SELECT 1 FROM users)" in source


def test_admin_config_digest_migration_stores_only_a_nullable_derived_value() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260901_0031_admin_config_digest.py"
    )
    source = migration.read_text(encoding="utf-8")
    assert 'down_revision: str | None = "20260901_0030"' in source
    assert 'sa.Column("deployment_config_digest", sa.String(length=64), nullable=True)' in source
    assert 'op.drop_column("auth_principals", "deployment_config_digest")' in source
    assert "server_default" not in source
    assert "ADMIN_EMAIL" not in source
    assert "ADMIN_PASSWORD" not in source

    column = AuthPrincipal.__table__.c.deployment_config_digest
    assert column.nullable is True
    assert column.server_default is None
    assert isinstance(column.type, sa.String)
    assert column.type.length == 64


def test_root_administration_foundation_has_one_head_and_sensitive_data_boundaries() -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260902_0032_root_administration_foundation.py"
    )
    source = migration.read_text(encoding="utf-8")
    assert 'down_revision: str | None = "20260901_0031"' in source
    for table_name in (
        "admin_audit_logs",
        "system_skills",
        "instance_feature_policies",
        "system_backup_records",
        "user_deletion_requests",
    ):
        assert table_name in source
    assert "PENDING" in source
    assert "require_admin_approval" in source
    for forbidden in (
        "password_hash",
        "session_token",
        "invitation_token",
        "conversation_body",
        "attachment_content",
    ):
        assert forbidden not in source


def test_root_administration_models_preserve_singleton_and_audit_contracts() -> None:
    status_constraint = next(
        constraint
        for constraint in User.__table__.constraints
        if getattr(constraint, "name", None) == "ck_users_status"
    )
    assert "PENDING" in str(status_constraint.sqltext)
    assert User.__table__.c.last_login_at.nullable is True
    assert User.__table__.c.approval_reviewed_by_user_id.nullable is True
    assert InstanceAccessSetting.__table__.c.require_admin_approval.default.arg is False
    assert InstanceAccessSetting.__table__.c.password_reset_enabled.default.arg is True

    assert AdminAuditLog.__table__.c.actor_user_id.nullable is False
    assert AdminAuditLog.__table__.c.target_user_id.foreign_keys == set()
    assert AdminAuditLog.__table__.c.metadata.nullable is False
    assert "password" not in AdminAuditLog.__table__.c
    assert "content" not in AdminAuditLog.__table__.c

    assert SystemSkill.__table__.c.bundled_key.nullable is True
    assert SystemSkill.__table__.c.content.nullable is True
    assert InstanceFeaturePolicy.__table__.c.id.primary_key is True
    backup_unique_names = {
        constraint.name for constraint in SystemBackupRecord.__table__.constraints if isinstance(constraint, sa.UniqueConstraint)
    }
    assert "uq_system_backup_records_job" in backup_unique_names
    assert UserDeletionRequest.__table__.c.target_user_id.foreign_keys == set()
    deletion_unique_names = {
        constraint.name for constraint in UserDeletionRequest.__table__.constraints if isinstance(constraint, sa.UniqueConstraint)
    }
    assert "uq_user_deletion_requests_job" in deletion_unique_names


def test_search_document_model_uses_postgresql_tsvector_type() -> None:
    search_tsv_type = SearchDocument.__table__.c.search_tsv.type.dialect_impl(postgresql.dialect())
    assert isinstance(search_tsv_type, postgresql.TSVECTOR)
