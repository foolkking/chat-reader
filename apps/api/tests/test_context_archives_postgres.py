"""Context .cr restore under migrated PostgreSQL foreign-key constraints."""
import os
import pytest
from sqlalchemy.orm import Session
from app.core.config import get_settings
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_integrity import archive_db  # noqa: F401
from test_context_archives import test_personal_context_roundtrip_and_idempotency as personal_roundtrip, test_system_context_restore as system_roundtrip

pytestmark = pytest.mark.skipif(os.environ.get('SETTINGS_POSTGRES_INTEGRATION') != '1', reason='requires disposable PostgreSQL')


def test_personal_context_postgres(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate('head')
    for key, directory in (('ASSET_STORAGE_DIR', 'objects'), ('EXPORT_STORAGE_DIR', 'exports')):
        monkeypatch.setenv(key, str(tmp_path / directory))
    get_settings.cache_clear()
    with Session(engine) as db:
        personal_roundtrip(db)


@pytest.mark.parametrize('rollback', [False, True])
def test_system_context_postgres(archive_db, isolated_schema, tmp_path, monkeypatch, rollback):
    engine, migrate = isolated_schema
    migrate('head')
    with Session(engine) as db:
        system_roundtrip(archive_db, db, tmp_path, monkeypatch, rollback)
