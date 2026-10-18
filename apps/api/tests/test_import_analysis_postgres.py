"""Cancellation must not wait for the analysis transaction's ImportRecord lock."""
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import sessionmaker

from app.api.routes.adaptive_imports import cancel_adaptive_import_session
from app.api.routes.tasks import cancel_task
from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.import_profile import ImportInputGroup, ImportStructureFamily
from app.models.import_record import ImportRecord
from app.models.user import User
from app.services.adaptive_import import service
from app.services.background_jobs import claim_next_job, process_background_job
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema as _isolated_schema

isolated_schema = _isolated_schema
pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


@pytest.mark.parametrize("via_tasks", [False, True])
@pytest.mark.parametrize("pause_at", ["before_parse", "before_publish"])
def test_cancellation_during_analysis_rolls_back_before_removing_sources(
    isolated_schema, tmp_path, monkeypatch, via_tasks, pause_at,
):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        owner = User(normalized_email="analysis-queue@example.test")
        db.add(owner)
        db.flush()
        record = service.begin_session(db, 1, owner_user_id=owner.id)
        service.add_session_source_stream(
            db, record, "synthetic.json",
            BytesIO(b'{"metadata":{"powered_by":"ChatGPT Exporter"},'
                    b'"messages":[{"role":"Prompt","say":"Synthetic input."}]}'),
            max_file_bytes=1024 * 1024,
        )
        job = service.queue_session_analysis(db, record)
        db.commit()
        owner_id, import_id, job_id = owner.id, record.id, job.id
        assert claim_next_job(db, job_type="adaptive_import_analysis") == job_id
        db.commit()

    paused, release = threading.Event(), threading.Event()
    original_analyze = service.analyze_initial_session

    def pause():
        paused.set()
        assert release.wait(timeout=15), "Test did not release the analysis worker."

    def analyze(*args, **kwargs):
        if pause_at == "before_parse":
            pause()
        return original_analyze(*args, **kwargs)

    def before_publish(_connection, _cursor, statement, parameters, _context, _many):
        if pause_at != "before_publish" or not statement.startswith("UPDATE background_jobs"):
            return
        values = parameters.values() if isinstance(parameters, dict) else parameters
        if "committed" in values:
            pause()

    monkeypatch.setattr(service, "analyze_initial_session", analyze)
    event.listen(engine, "before_cursor_execute", before_publish)
    root = tmp_path / "imports" / str(import_id)

    def cancel():
        with factory() as db:
            db.execute(text("SET LOCAL lock_timeout = '3s'"))
            db.execute(text("SET LOCAL statement_timeout = '5s'"))
            scope = OwnershipScope(owner_id)
            if via_tasks:
                result = cancel_task(job_id, db=db, ownership_scope=scope)
                assert result.status == "cancelling"
            else:
                cancel_adaptive_import_session(import_id, db=db, ownership_scope=scope)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            worker = executor.submit(process_background_job, job_id, session_factory=factory)
            try:
                assert paused.wait(timeout=10)
                # The worker has already flushed imports, holding its row lock.
                # Cancel must update only BackgroundJob and return immediately.
                executor.submit(cancel).result(timeout=7)
                assert root.exists()
                assert (root / "synthetic.json").is_file()
                with factory() as db:
                    assert db.get(BackgroundJob, job_id).status == "cancelling"
                    assert db.get(ImportRecord, import_id).session_state == "ANALYZING"
            finally:
                release.set()
                worker.result(timeout=20)
        with factory() as db:
            assert db.get(BackgroundJob, job_id).status == "cancelled"
            assert db.get(ImportRecord, import_id).session_state == "CANCELED"
            assert db.query(Conversation).count() == 0
            assert db.query(ImportInputGroup).filter_by(import_id=import_id).count() == 0
            assert db.query(ImportStructureFamily).filter_by(import_id=import_id).count() == 0
        assert not root.exists()
    finally:
        release.set()
        event.remove(engine, "before_cursor_execute", before_publish)
        get_settings.cache_clear()
