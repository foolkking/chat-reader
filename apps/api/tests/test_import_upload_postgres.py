"""Real upload admission/receipt races on the disposable PostgreSQL harness."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Event

import pytest
from fastapi import HTTPException, Response, UploadFile
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.api.routes.adaptive_imports import create_adaptive_import_session, get_adaptive_upload_receipt
from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.user import User
from app.services.ownership import OwnershipScope
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
                              reason="requires explicitly selected disposable PostgreSQL")


@pytest.mark.parametrize("first_commits", [True, False])
def test_inflight_same_key_never_waits_or_duplicates_and_read_receipt_never_takes_write_lock(
    isolated_schema, tmp_path, monkeypatch, first_commits,
):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("IMPORT_STORAGE_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr("app.services.uploads.available_memory_bytes", lambda: 16 * 1024**3)
    get_settings.cache_clear()
    with Session(engine) as db:
        user = User(normalized_email="synthetic-upload-race@example.test")
        db.add(user); db.commit(); owner_id = user.id
    key, scope = uuid.uuid4(), OwnershipScope(owner_id)
    held, release = Event(), Event()

    def admit(*, hold=False):
        with Session(engine) as db:
            db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
            if hold:
                def before_commit(_db):
                    held.set()
                    assert release.wait(15)
                    if not first_commits:
                        raise RuntimeError("synthetic pre-commit failure")
                event.listen(db, "before_commit", before_commit)
            source = UploadFile(filename="synthetic.md", file=BytesIO(b"# Synthetic\n\n## User\nQuestion"))
            try:
                return create_adaptive_import_session(files=[source], repair_profile_id=None,
                    target_project_id=None, idempotency_key=key, db=db, ownership_scope=scope)
            finally:
                source.file.close()
                db.rollback()

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(admit, hold=True)
            try:
                assert held.wait(10)
                with Session(engine) as db:
                    db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
                    response = Response()
                    result = get_adaptive_upload_receipt(key, response, db, scope)
                    assert result == {"receipt": None}
                    assert response.headers["cache-control"] == "no-store"
                with pytest.raises(HTTPException) as error:
                    admit()
                assert error.value.status_code == 409
                assert error.value.detail["code"] == "IMPORT_UPLOAD_REQUEST_PENDING"
            finally:
                release.set()
            if first_commits:
                original = first.result(timeout=10)
            else:
                with pytest.raises(HTTPException) as error:
                    first.result(timeout=10)
                assert error.value.status_code == 500
                original = None
        repeated = admit()
        if original:
            assert repeated["import_id"] == original["import_id"]
        with Session(engine) as db:
            assert db.query(ImportRecord).count() == 1
            assert db.query(BackgroundJob).filter_by(job_type="adaptive_import_analysis").count() == 1
            receipt = get_adaptive_upload_receipt(key, Response(), db, scope)["receipt"]
            assert receipt["import_id"] == repeated["import_id"]
            assert receipt["task_id"] == repeated["analysis_task_id"]
    finally:
        get_settings.cache_clear()
