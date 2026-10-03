"""Shared Skill cleanup with real PostgreSQL row and foreign-key constraints."""
import os

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_skill_cleanup import test_shared_members_survive_delete_and_rollback as shared_cleanup

pytestmark = pytest.mark.skipif(os.environ.get('SETTINGS_POSTGRES_INTEGRATION') != '1', reason='requires disposable PostgreSQL')


def test_shared_skill_cleanup_postgres(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate('head')
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'assets'))
    get_settings.cache_clear()
    with Session(engine) as db:
        shared_cleanup(db)
