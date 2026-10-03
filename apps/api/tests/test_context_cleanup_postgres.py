"""Context cleanup against real PostgreSQL constraints when configured."""
import os

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_context_cleanup import (
    test_retention_preserves_shared_members_and_rollback as retention,
    test_conversation_deletion_reclaims_only_unshared_context as conversation_delete,
    test_account_deletion_preserves_shared_context_and_cleanup_receipts as account_delete,
)

pytestmark = pytest.mark.skipif(os.environ.get('SETTINGS_POSTGRES_INTEGRATION') != '1', reason='requires disposable PostgreSQL')


@pytest.mark.parametrize('scenario', [retention, conversation_delete, account_delete])
def test_context_cleanup_postgres(isolated_schema, tmp_path, monkeypatch, scenario):
    engine, migrate = isolated_schema
    migrate('head')
    monkeypatch.setenv('ASSET_STORAGE_DIR', str(tmp_path / 'assets'))
    get_settings.cache_clear()
    try:
        with Session(engine) as db:
            scenario(db)
    finally:
        get_settings.cache_clear()
