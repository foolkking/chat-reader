import uuid
import logging
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import Base
from app.models.import_record import ImportRecord
from app.services.import_queue import claim_next_import, queue_import, recover_stale_imports, retry_import_manually
from app.services.retry_policy import MAX_AUTOMATIC_ATTEMPTS
from test_import_preview_api import client  # noqa: F401


def test_commit_queues_and_is_idempotent(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("IMPORT_COMMIT_INLINE", "false")
    get_settings.cache_clear()
    preview = client.post(
        "/api/imports/preview",
        files={"files": ("queued.json", b'{"metadata":{"powered_by":"ChatGPT Exporter"},"messages":[]}', "application/json")},
    )
    import_id = preview.json()["import_id"]

    first = client.post(f"/api/imports/{import_id}/commit")
    second = client.post(f"/api/imports/{import_id}/commit")

    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["status"] == "queued"
    assert second.json()["queued_at"] == first.json()["queued_at"]
    assert client.get(f"/api/imports/{import_id}/status").json()["status"] == "queued"
    assert any(task["import_id"] == import_id for task in client.get("/api/imports/active").json())


def test_claim_order_and_stale_recovery(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'queue.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    first_id = uuid.uuid4()
    second_id = uuid.uuid4()
    with factory() as db:
        first = _record(first_id)
        second = _record(second_id)
        db.add_all([first, second])
        db.flush()
        queue_import(first, db)
        queue_import(second, db)
        first.queued_at = datetime.now(timezone.utc) - timedelta(seconds=5)
        db.commit()

    with factory() as db:
        assert claim_next_import(db) == first_id
        first = db.get(ImportRecord, first_id)
        assert first is not None
        assert first.session_state == "IMPORTING"
        db.commit()

    with factory() as db:
        first = db.get(ImportRecord, first_id)
        assert first is not None
        first.heartbeat_at = datetime.now(timezone.utc) - timedelta(minutes=6)
        db.commit()

    with factory() as db:
        assert recover_stale_imports(db, 300) == 1
        db.commit()
        first = db.get(ImportRecord, first_id)
        assert first is not None
        assert first.status == "queued"
        assert first.session_state == "READY"
        assert first.error_message is not None


def test_stale_import_recovery_is_bounded_and_manual_retry_starts_a_new_bounded_lifecycle(tmp_path, caplog) -> None:
    caplog.set_level(logging.INFO, logger="app.services.import_queue")
    engine = create_engine(f"sqlite:///{tmp_path / 'bounded.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    import_id = uuid.uuid4()
    with factory() as db:
        record = _record(import_id)
        record.status = "processing"
        record.phase = "parsing"
        record.attempt_count = MAX_AUTOMATIC_ATTEMPTS
        record.heartbeat_at = datetime.now(timezone.utc) - timedelta(minutes=6)
        db.add(record)
        db.commit()

    with factory() as db:
        assert recover_stale_imports(db, 300) == 0
        db.commit()
        record = db.get(ImportRecord, import_id)
        assert record is not None
        assert record.status == "failed"
        assert record.session_state == "FAILED"
        assert "Automatic recovery stopped" in (record.error_message or "")

    with factory() as db:
        assert recover_stale_imports(db, 300) == 0
        record = db.get(ImportRecord, import_id)
        assert record is not None
        retry_import_manually(record, db)
        db.commit()
        assert record.status == "queued"
        assert record.session_state == "READY"
        assert record.attempt_count == 0

    for expected_attempt in range(1, MAX_AUTOMATIC_ATTEMPTS + 1):
        with factory() as db:
            assert claim_next_import(db) == import_id
            record = db.get(ImportRecord, import_id)
            assert record is not None
            assert record.attempt_count == expected_attempt
            record.heartbeat_at = datetime.now(timezone.utc) - timedelta(minutes=6)
            db.commit()
        with factory() as db:
            assert recover_stale_imports(db, 300) == (1 if expected_attempt < MAX_AUTOMATIC_ATTEMPTS else 0)
            db.commit()

    with factory() as db:
        record = db.get(ImportRecord, import_id)
        assert record is not None
        assert record.status == "failed"
        assert record.attempt_count == MAX_AUTOMATIC_ATTEMPTS
    assert '"event":"import_auto_retry_exhausted"' in caplog.text
    assert '"event":"import_manual_retry"' in caplog.text


def _record(import_id: uuid.UUID) -> ImportRecord:
    return ImportRecord(
        id=import_id,
        source_profile="chatgpt_exporter_json",
        source_fingerprint=str(import_id),
        status="previewed",
    )
