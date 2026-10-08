"""Dismissal ends only the review and remains recoverable after response loss."""
import uuid
import pytest

from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan
from app.models.message import Message
from app.models.message_version import MessageVersion
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import create_review, session, MARKER
from test_auth import auth_client  # noqa: F401

ROOT = "/api/content-cleanup/scans"


def test_repeated_dismissal_keeps_versions_and_confirms_original_result(client):
    scan, messages = create_review(client, ["Synthetic ordinary answer."])
    with session() as db:
        version_id = db.get(Message, messages[0]).current_version_id
    assert client.delete(f"{ROOT}/{scan}").status_code == 204
    assert client.delete(f"{ROOT}/{scan}").status_code == 204
    result = client.get(f"{ROOT}/{scan}/dismissal")
    assert result.status_code == 200 and result.json()["status"] == "DISMISSED"
    assert result.json()["dismissed_at"]
    with session() as db:
        assert db.get(ContentCleanupScan, scan) is None
        assert db.get(Message, messages[0]).current_version_id == version_id
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1


def test_dismissing_failed_scan_ends_orphan_task(client):
    scan_id, _ = create_review(client, [f"Before {MARKER} after."])
    with session() as db:
        scan = db.get(ContentCleanupScan, scan_id)
        scan.status = "FAILED"
        job = db.get(BackgroundJob, scan.background_job_id)
        job_id = job.id
        job.status = "failed"
        job.error_message = "Synthetic interrupted scan"
        db.commit()
    assert client.delete(f"{ROOT}/{scan_id}").status_code == 204
    with session() as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "committed", "Dismissed failed review must not leave an active failed task"
        assert job.error_message is None
        assert job.result["cleanup_dismissal"]["status"] == "DISMISSED"
    assert client.post(f"/api/tasks/{job_id}/retry").json()["status"] == "committed"


def test_dismissal_lookup_is_read_only_and_not_cleanup_success(client):
    scan, _ = create_review(client, [f"Before {MARKER} after."])
    before = client.get(f"{ROOT}/{scan}").json()
    assert client.get(f"{ROOT}/{scan}/dismissal").json() == {"status": "REVIEW", "scan": before}
    assert client.get(f"{ROOT}/{scan}").json() == before
    assert client.delete(f"{ROOT}/{scan}").status_code == 204
    assert client.get(f"{ROOT}/{scan}/outcome").status_code == 404
    unknown = uuid.uuid4()
    assert client.get(f"{ROOT}/{unknown}/dismissal").status_code == 404
    assert client.delete(f"{ROOT}/{unknown}").status_code == 409


@pytest.mark.parametrize("status", ["QUEUED", "SCANNING", "APPLYING"])
def test_running_review_cannot_be_dismissed(client, status):
    scan_id, _ = create_review(client, [f"Before {MARKER} after."])
    with session() as db:
        db.get(ContentCleanupScan, scan_id).status = status
        db.commit()
    assert client.delete(f"{ROOT}/{scan_id}").status_code == 409
    with session() as db:
        assert db.get(ContentCleanupScan, scan_id) is not None
        assert db.query(BackgroundJob).filter_by(idempotency_key=f"cleanup-dismiss:{scan_id}").count() == 0


def test_failed_scan_just_retried_cannot_be_dismissed(client):
    scan_id, _ = create_review(client, [f"Before {MARKER} after."])
    with session() as db:
        db.get(ContentCleanupScan, scan_id).status = "FAILED"
        db.commit()  # Its job is already queued, as after an explicit retry.
    assert client.delete(f"{ROOT}/{scan_id}").status_code == 409


def test_receipt_failure_rolls_back_dismissal(client, monkeypatch):
    from app.services import cleanup_outcomes
    scan, messages = create_review(client, [f"Before {MARKER} after."])
    assert client.patch(f"{ROOT}/{scan}/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    original = cleanup_outcomes.save_dismissed_outcome
    def fail(db, review):
        original(db, review)
        db.flush()
        raise ValueError("Synthetic receipt failure")
    monkeypatch.setattr(cleanup_outcomes, "save_dismissed_outcome", fail)
    assert client.delete(f"{ROOT}/{scan}").status_code == 409
    assert client.get(f"{ROOT}/{scan}").json()["delete_count"] == 1
    with session() as db:
        assert db.query(MessageVersion).filter_by(message_id=messages[0]).count() == 1
        assert db.query(BackgroundJob).filter_by(idempotency_key=f"cleanup-dismiss:{scan}").count() == 0


def test_other_account_cannot_dismiss_or_read_receipt(auth_client, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from app.core import auth_middleware
    from app.services.content_cleanup import process_scan_chunk
    from test_admin_system import _normal_user_session
    for key in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(key, str(tmp_path / key))
    get_settings.cache_clear()
    try:
        _, token_a = _normal_user_session(auth_client)
        _, token_b = _normal_user_session(auth_client)
        auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token_a)
        conversation = auth_client.post("/api/conversations", json={"title": "Synthetic dismissal isolation", "messages": [
            {"role": "user", "content_markdown": "Question"}, {"role": "assistant", "content_markdown": "Answer"}]}).json()
        scan = auth_client.post(ROOT, json={"source": "BATCH", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [conversation["conversation"]["id"]]}).json()["id"]
        with auth_middleware.SessionLocal() as db:
            while not process_scan_chunk(db, uuid.UUID(scan))["done"]:
                db.commit()
            db.commit()
        for after in [False, True]:
            if after:
                auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token_a)
                assert auth_client.delete(f"{ROOT}/{scan}").status_code == 204
            auth_client.cookies.clear(); auth_client.cookies.set("chat_reader_session", token_b)
            assert auth_client.delete(f"{ROOT}/{scan}").status_code == 409
            assert auth_client.get(f"{ROOT}/{scan}/dismissal").status_code == 404
    finally:
        get_settings.cache_clear()
