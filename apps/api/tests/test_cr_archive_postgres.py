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
from test_import_preview_api import client  # noqa: F401


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


@pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)
def test_cr_reference_roundtrip_uses_real_postgres_transactions(client, isolated_schema, monkeypatch):
    from app.core.database import get_db
    from app.main import app
    from app.models.user import User
    from app.services.ownership import LEGACY_OWNER_USER_ID
    from test_attachment_operation_semantics import (
        test_copy_operations_preserve_literal_examples_and_rewrite_only_live_references as roundtrip,
    )
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        if db.get(User, LEGACY_OWNER_USER_ID) is None:
            db.add(User(id=LEGACY_OWNER_USER_ID, role="ADMIN", status="ACTIVE"))
        db.commit()

    def database():
        # Match production SessionLocal; preview stages child rows before the
        # parent import is added and intentionally flushes them together.
        with Session(engine, autoflush=False) as db:
            yield db

    old = app.dependency_overrides[get_db]
    app.dependency_overrides[get_db] = database
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    try:
        roundtrip(client, "cr_restore", True)
    finally:
        app.dependency_overrides[get_db] = old
        get_settings.cache_clear()
