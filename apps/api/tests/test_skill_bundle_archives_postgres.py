"""Run Bundle archive contracts against migrated PostgreSQL foreign keys in CI."""
import os

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_integrity import archive_db  # noqa: F401
from test_skill_bundle_archives import (
    test_personal_archive_keeps_distinct_scripts_all_versions_and_idempotency as personal_roundtrip,
    test_system_restore_keeps_bundle_history_in_fresh_instance as system_roundtrip,
)

pytestmark = pytest.mark.skipif(os.environ.get('SETTINGS_POSTGRES_INTEGRATION') != '1', reason='requires disposable PostgreSQL')


def test_personal_bundle_archive_postgres(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate('head')
    for key, directory in (('ASSET_STORAGE_DIR', 'objects'), ('EXPORT_STORAGE_DIR', 'exports')):
        monkeypatch.setenv(key, str(tmp_path / directory))
    get_settings.cache_clear()
    with Session(engine) as db:
        personal_roundtrip(db)


@pytest.mark.parametrize('fail_after_restore', [False, True])
def test_system_bundle_archive_postgres(archive_db, isolated_schema, tmp_path, monkeypatch, fail_after_restore):
    engine, migrate = isolated_schema
    migrate('head')
    with Session(engine) as target:
        system_roundtrip(archive_db, target, tmp_path, monkeypatch, fail_after_restore)


def test_zip_default_reset_preserves_personal_selection_postgres(isolated_schema):
    from test_skill_zip_defaults import test_default_migration_preserves_personal_selection as reset_defaults
    engine, migrate = isolated_schema
    migrate('20261002_0045')
    with Session(engine) as db:
        reset_defaults(db)
    migrate('head')
