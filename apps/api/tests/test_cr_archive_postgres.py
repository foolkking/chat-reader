import os
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.exporting.cr_archive import _conversation_archive_attachments
from app.services.exporting import cr_archive
from app.services.search import search_indexer
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_export_memory_bounds import retained_versions, seed_export


@pytest.mark.skipif(
    os.environ.get("POSTGRES_EXPORT_INTEGRATION") != "1" or not os.environ.get("DATABASE_URL"),
    reason="requires the Release B PostgreSQL integration matrix",
)
def test_cr_attachment_lookup_does_not_distinct_json_entities_on_postgresql() -> None:
    """Execute the actual query because SQLite accepts a DISTINCT PostgreSQL rejects."""
    database_url = os.environ["DATABASE_URL"]
    engine = create_engine(database_url)
    try:
        with Session(engine) as db:
            assert _conversation_archive_attachments(db, uuid.uuid4()) == []
    finally:
        engine.dispose()


@pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)
def test_cr_body_cursor_and_bounded_search_copy_work_on_postgresql(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(tmp_path / "exports"))
    monkeypatch.setattr(search_indexer, "_MAX_DOCUMENT_TEXT_CHARS", 8 * 1024)
    get_settings.cache_clear()
    try:
        with Session(engine) as db:
            conversation_id, job_id = seed_export(db)
            with retained_versions() as measured:
                result = cr_archive.create_cr_archive(db, conversation_id=conversation_id, job_id=job_id)
            assert measured["loaded"] == 99 and measured["peak"] <= 4, measured
            indexed = search_indexer.rebuild_search_documents_for_conversation(db, conversation_id)
            assert indexed.indexed_count == 34
            db.commit()
            assert result.byte_size > 0
    finally:
        get_settings.cache_clear()
