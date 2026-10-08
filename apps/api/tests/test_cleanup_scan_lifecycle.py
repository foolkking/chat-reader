"""A scan's execution state comes from its real worker task."""
import uuid
from datetime import datetime, timedelta, timezone
import pytest

from sqlalchemy.orm import sessionmaker
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan
from app.models.message_version import MessageVersion
from app.services import background_jobs
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import create_review, session, MARKER
from test_auth import auth_client  # noqa: F401

ROOT = "/api/content-cleanup/scans"


def queued(client):
    _, messages = create_review(client, [f"Before {MARKER} after."])
    response = client.post("/api/content-cleanup/rules/scan-existing", headers={"Idempotency-Key": str(uuid.uuid4())})
    assert response.status_code == 202
    return response.json(), messages


def test_queued_scan_can_be_cancelled_without_changing_content(client):
    scan, messages = queued(client)
    response = client.post(f"/api/tasks/{scan['background_job_id']}/cancel")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    assert client.get(f"{ROOT}/{scan['id']}").json()["status"] == "CANCELLED"
    with session() as db:
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


def test_actual_worker_failure_is_visible_in_scan_read(client, monkeypatch):
    scan, _ = queued(client)
    job_id = uuid.UUID(scan["background_job_id"])
    with session() as db:
        factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
        db.get(BackgroundJob, job_id).status = "processing"
        db.commit()
    def fail(*args, **kwargs):
        raise RuntimeError("Synthetic scan failure")
    monkeypatch.setattr(background_jobs, "process_scan_chunk", fail)
    background_jobs.process_background_job(job_id, session_factory=factory)
    assert client.get(f"/api/tasks/{job_id}").json()["status"] == "failed"
    result = client.get(f"{ROOT}/{scan['id']}").json()
    assert result["status"] == "FAILED", result
    assert result["error_message"] == "Synthetic scan failure"


def test_cancelled_scan_can_be_reopened_rescanned_and_dismissed(client):
    scan, _ = queued(client)
    url = f"{ROOT}/{scan['id']}"
    task = f"/api/tasks/{scan['background_job_id']}"
    for _ in range(2):
        assert client.post(task + "/cancel").json()["status"] == "cancelled"
    assert client.get(url).json()["background_job_status"] == "cancelled"
    again = client.post(url + "/rescan", headers={"Idempotency-Key": str(uuid.uuid4())})
    assert again.status_code == 202 and again.json()["id"] != scan["id"]
    assert again.json()["delete_count"] == 0
    assert client.post(url + "/apply").status_code == 409
    assert client.delete(url).status_code == 204
    assert client.get(url + "/dismissal").json()["status"] == "DISMISSED"


def test_cancelled_pending_visibility_expires_without_deleting_scan(client):
    scan, _ = queued(client)
    assert client.post(f"/api/tasks/{scan['background_job_id']}/cancel").status_code == 200
    assert scan["id"] in [item["id"] for item in client.get(ROOT + "/pending").json()]
    with session() as db:
        db.get(BackgroundJob, uuid.UUID(scan["background_job_id"])).completed_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()
    assert scan["id"] not in [item["id"] for item in client.get(ROOT + "/pending").json()]
    assert client.get(f"{ROOT}/{scan['id']}").json()["status"] == "CANCELLED"


def test_waiting_again_preserves_processed_count_and_never_reports_ready(client):
    scan, _ = queued(client)
    job_id = uuid.UUID(scan["background_job_id"])
    with session() as db:
        factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
        db.get(BackgroundJob, job_id).status = "processing"
        db.commit()
    background_jobs.process_background_job(job_id, session_factory=factory)
    result = client.get(f"{ROOT}/{scan['id']}").json()
    assert result["background_job_status"] == "queued" and result["status"] == "QUEUED"
    assert result["processed_messages"] == result["total_messages"]
    assert client.get(f"/api/tasks/{job_id}").json()["progress"] == 99
    with session() as db:
        db.get(BackgroundJob, job_id).status = "processing"
        db.commit()
    background_jobs.process_background_job(job_id, session_factory=factory)
    assert client.get(f"{ROOT}/{scan['id']}").json()["status"] == "READY"
    assert client.post(f"/api/tasks/{job_id}/cancel").status_code == 409


def test_latest_import_keeps_cancelled_scan_after_general_visibility_expires(client):
    from app.models.import_record import ImportRecord
    from app.models.message import Message
    scan, messages = queued(client)
    with session() as db:
        record = ImportRecord(source_profile="synthetic", source_fingerprint="synthetic-scan-lifecycle",
                              status="committed", conversation_id=db.get(Message, messages[0]).conversation_id)
        db.add(record); db.flush()
        parent = record.id
        job = db.get(BackgroundJob, uuid.UUID(scan["background_job_id"]))
        job.payload = {**job.payload, "parent_task_id": str(parent)}
        db.get(ContentCleanupScan, uuid.UUID(scan["id"])).source = "IMPORT"
        db.commit()
    assert client.post(f"/api/tasks/{scan['background_job_id']}/cancel").status_code == 200
    with session() as db:
        db.get(BackgroundJob, uuid.UUID(scan["background_job_id"])).completed_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()
    assert scan["id"] not in [item["id"] for item in client.get(ROOT + "/pending").json()]
    latest = client.get(ROOT + "/pending", params={"import_id": str(parent)})
    assert latest.status_code == 200 and len(latest.json()) == 1
    assert latest.json()[0]["id"] == scan["id"] and latest.json()[0]["status"] == "CANCELLED"
    with session() as db:
        assert db.get(ImportRecord, parent).status == "committed"
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


@pytest.mark.parametrize("terminal", ["failed", "cancelled"])
def test_new_scan_does_not_reuse_a_terminal_worker_cursor(client, terminal):
    scan, _ = queued(client)
    with session() as db:
        job = db.get(BackgroundJob, uuid.UUID(scan["background_job_id"]))
        job.status = terminal
        db.commit()
    again = client.post("/api/content-cleanup/rules/scan-existing")
    assert again.status_code == 202 and again.json()["id"] != scan["id"]


def test_other_account_cannot_cancel_scan_task(auth_client, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from test_admin_system import _normal_user_session
    for key in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(key, str(tmp_path / key))
    get_settings.cache_clear()
    try:
        _, token_a = _normal_user_session(auth_client)
        _, token_b = _normal_user_session(auth_client)
        auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token_a)
        conversation = auth_client.post("/api/conversations", json={"title": "Synthetic scan isolation", "messages": [{"role": "user", "content_markdown": "Question"}, {"role": "assistant", "content_markdown": "Answer"}]}).json()
        scan = auth_client.post(ROOT, json={"source": "BATCH", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [conversation["conversation"]["id"]]}).json()
        auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token_b)
        assert auth_client.post(f"/api/tasks/{scan['background_job_id']}/cancel").status_code == 404
        assert auth_client.get(f"{ROOT}/{scan['id']}").status_code == 404
        auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token_a)
        assert auth_client.get(f"/api/tasks/{scan['background_job_id']}").json()["status"] == "queued"
    finally:
        get_settings.cache_clear()
