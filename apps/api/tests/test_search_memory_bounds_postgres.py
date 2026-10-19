"""Exercise actual streamed joins and paged deletes on disposable PostgreSQL."""
import os

import pytest
from sqlalchemy.orm import Session

from app.core.config import get_settings
import test_search_memory_bounds as regressions
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL")


@pytest.mark.parametrize("case", ["projection", "extract", "sync_window", "backfill_window",
    "sync_prune", "backfill_prune"])
def test_search_resource_contract_on_postgresql(isolated_schema, tmp_path, monkeypatch, case):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    get_settings.cache_clear()
    try:
        with Session(engine) as db:
            if case == "projection":
                regressions.test_attachment_index_projects_only_required_fields(db)
            elif case == "extract":
                regressions.test_attachment_index_uses_newest_ready_extract_and_bounded_file_read(db)
            elif case.endswith("window"):
                regressions.test_annotation_index_body_read_window_is_bounded(db, case.startswith("backfill"))
            else:
                regressions.test_stale_annotation_pruning_never_loads_search_bodies(db, case.startswith("backfill"))
    finally:
        get_settings.cache_clear()
