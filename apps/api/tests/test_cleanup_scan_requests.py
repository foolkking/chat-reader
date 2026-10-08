"""Global scan requests retain one account-owned task across response loss."""
import uuid

from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.content_cleanup import ContentCleanupScan
from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session
from test_auth import auth_client  # noqa: F401

URL = "/api/content-cleanup/rules/scan-existing"


def test_retry_keeps_original_scan_after_source_revision_changes(client):
    create_review(client, [f"Before {MARKER} after."])
    key = str(uuid.uuid4())
    first = client.post(URL, headers={"Idempotency-Key": key})
    assert first.status_code == 202, first.text
    with session() as db:
        for conversation in db.query(Conversation):
            conversation.offline_revision += 1
        db.commit()
    again = client.post(URL, headers={"Idempotency-Key": key})
    assert again.status_code == 202, again.text
    assert again.json()["id"] == first.json()["id"]
    with session() as db:
        assert db.query(BackgroundJob).filter_by(idempotency_key=key, job_type="content_noise_scan").count() == 1


def test_request_lookup_is_read_only_and_survives_review_dismissal(client):
    create_review(client, [f"Before {MARKER} after."])
    key = str(uuid.uuid4())
    lookup = f"{URL}/requests/{key}"
    assert client.get(lookup).json() == {"found": False}
    first = client.post(URL, headers={"Idempotency-Key": key}).json()
    before = client.get(f"/api/content-cleanup/scans/{first['id']}").json()
    recovered = client.get(lookup)
    assert recovered.status_code == 200
    assert recovered.json()["job_id"] == first["background_job_id"]
    assert client.get(f"/api/content-cleanup/scans/{first['id']}").json() == before
    with session() as db:
        db.delete(db.get(ContentCleanupScan, uuid.UUID(first["id"])))
        db.commit()
    recovered = client.get(lookup).json()
    assert recovered["found"] is True and recovered["scan"] is None
    assert client.post(URL, headers={"Idempotency-Key": key}).status_code == 409
    with session() as db:
        assert db.query(BackgroundJob).filter_by(idempotency_key=key).count() == 1


def test_new_explicit_request_rechecks_new_exceptions(client):
    from test_cleanup_learning import complete_scan
    create_review(client, [f"Before {MARKER} after."])
    first = client.post(URL, headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    complete_scan(first["id"])
    hit = client.get(f"/api/content-cleanup/scans/{first['id']}/occurrences").json()[0]
    path = f"/api/content-cleanup/scans/{first['id']}/occurrences/{hit['id']}/exception"
    preview = client.get(path).json()
    assert client.post(path, json={"confirmed": True, "preview_token": preview["preview_token"]}).status_code == 201
    second = client.post(URL, headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    assert second["id"] != first["id"]
    complete_scan(second["id"])
    assert client.get(f"/api/content-cleanup/scans/{second['id']}").json()["occurrence_count"] == 0


def test_rejected_request_can_be_retried_after_conversation_exists(client):
    key = str(uuid.uuid4())
    assert client.post(URL, headers={"Idempotency-Key": key}).status_code == 422
    assert client.get(f"{URL}/requests/{key}").json() == {"found": False}
    create_review(client, [f"Before {MARKER} after."])
    assert client.post(URL, headers={"Idempotency-Key": key}).status_code == 202
    assert client.get(f"{URL}/requests/{key}").json()["found"] is True


def test_request_lookup_and_same_key_are_account_scoped(auth_client, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from test_admin_system import _normal_user_session
    for key in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(key, str(tmp_path / key))
    get_settings.cache_clear()
    try:
        _, first_token = _normal_user_session(auth_client)
        _, second_token = _normal_user_session(auth_client)
        request_id = str(uuid.uuid4())
        jobs = []
        for token in (first_token, second_token):
            auth_client.cookies.clear()
            auth_client.cookies.set("chat_reader_session", token)
            assert auth_client.get(f"{URL}/requests/{request_id}").json() == {"found": False}
            response = auth_client.post("/api/conversations", json={"title": "Synthetic owner scan", "messages": [
                {"role": "user", "content_markdown": "Synthetic question"},
                {"role": "assistant", "content_markdown": f"Before {MARKER} after."},
            ]})
            assert response.status_code == 201
            response = auth_client.post(URL, headers={"Idempotency-Key": request_id})
            assert response.status_code == 202
            jobs.append(response.json()["background_job_id"])
            assert response.json()["target_count"] == 1
            assert auth_client.get(f"{URL}/requests/{request_id}").json()["job_id"] == jobs[-1]
        assert jobs[0] != jobs[1]
        assert auth_client.get(f"/api/tasks/{jobs[0]}").status_code == 404
    finally:
        get_settings.cache_clear()
