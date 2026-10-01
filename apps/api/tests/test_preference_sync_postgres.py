import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.user_preference import PreferenceSyncReceipt, UserPreference
from app.schemas.preferences import PreferenceSyncRequest
from app.services.preferences import get_or_create_preferences, preference_read, sync_preferences
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_migration_preserves_values_and_receipts_follow_owner(isolated_schema):
    engine, migrate = isolated_schema
    migrate("20261001_0038")
    with engine.begin() as db:
        db.execute(sa.text("""INSERT INTO user_preferences (subject_key,theme_mode,locale_mode,reader_width_mode,reader_density_mode,reader_font_size_px,section_toc_mode,conversation_sort_mode,conversation_sort_direction,project_sort_mode,project_sort_direction,created_at,updated_at)
            VALUES ('synthetic','dark','en-US','wide','compact',20,'rail','title','asc','title','asc',now(),now())"""))
    migrate("head")
    with Session(engine) as db:
        preference = preference_read(get_or_create_preferences(db, "synthetic"))
        assert preference.theme_mode == "dark"
        assert preference.reader_font_size_px == 20
        assert set(preference.field_revisions.values()) == {1}
        request = PreferenceSyncRequest(operation_id=uuid.uuid4(), changes={"theme_mode": "light"}, base_revisions={"theme_mode": 1})
        sync_preferences(db, request, "synthetic")
        db.commit()
        assert db.query(PreferenceSyncReceipt).count() == 1
        db.delete(db.get(UserPreference, "synthetic"))
        db.commit()
        assert db.query(PreferenceSyncReceipt).count() == 0
    migrate("20261001_0038", "downgrade")
    migrate("head")


def test_concurrent_fields_and_replays_are_serialized(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    barrier = Barrier(3)
    first = PreferenceSyncRequest(operation_id=uuid.uuid4(), changes={"theme_mode": "dark"}, base_revisions={"theme_mode": 1})
    other = PreferenceSyncRequest(operation_id=uuid.uuid4(), changes={"reader_font_size_px": 21}, base_revisions={"reader_font_size_px": 1})
    def run(request):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            result = sync_preferences(db, request, "synthetic")
            db.commit()
            return result
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(run, [first, first, other]))
    assert all(not result.conflicts for result in results)
    assert results[0] == results[1]
    with Session(engine) as db:
        row = preference_read(get_or_create_preferences(db, "synthetic"))
        assert row.theme_mode == "dark" and row.reader_font_size_px == 21
        assert row.field_revisions["theme_mode"] == row.field_revisions["reader_font_size_px"] == 2
        assert db.query(PreferenceSyncReceipt).count() == 2
