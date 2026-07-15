import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.core.database import Base
from app.models.import_record import ImportRecord
from app.services.import_queue import claim_next_import, queue_import, recover_stale_imports
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
        assert first.error_message is not None


def _record(import_id: uuid.UUID) -> ImportRecord:
    return ImportRecord(
        id=import_id,
        source_profile="chatgpt_exporter_json",
        source_fingerprint=str(import_id),
        status="previewed",
    )
