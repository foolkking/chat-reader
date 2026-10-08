"""Rescan/admission recovery must survive both source changes and cleanup apply."""
import uuid
import pytest

from test_import_preview_api import client  # noqa: F401
from test_cleanup_safety import MARKER, create_review, session
from test_cleanup_learning import complete_scan
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan
from app.models.conversation import Conversation
from app.models.message import Message
from test_auth import auth_client  # noqa: F401

ROOT = "/api/content-cleanup/scans"
GLOBAL = "/api/content-cleanup/rules/scan-existing"


def test_same_rescan_request_returns_one_task(client):
    old, _ = create_review(client, [f"Before {MARKER} after."])
    key = str(uuid.uuid4())
    first = client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key})
    again = client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key})
    assert first.status_code == again.status_code == 202
    assert first.json()["id"] == again.json()["id"], "Retry must retain the original rescan"
    assert first.json()["previous_scan_id"] == str(old)


def test_lookup_is_read_only_and_request_is_bound_to_original(client):
    old, _ = create_review(client, [f"Before {MARKER} after."])
    other, _ = create_review(client, [f"Other {MARKER} after."])
    key = str(uuid.uuid4())
    path = f"{ROOT}/{old}/rescan-requests/{key}"
    with session() as db:
        count = db.query(BackgroundJob).count()
    assert client.get(path).json() == {"found": False}
    with session() as db:
        assert db.query(BackgroundJob).count() == count
    first = client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key}).json()
    before = client.get(f"{ROOT}/{first['id']}").json()
    assert client.get(path).json()["scan"] == before
    assert client.get(f"{ROOT}/{other}/rescan-requests/{key}").json() == {"found": False}
    second = client.post(f"{ROOT}/{other}/rescan", headers={"Idempotency-Key": key}).json()
    assert first["id"] != second["id"]


@pytest.mark.parametrize("finish", ["apply", "dismiss"])
def test_rescan_receipt_survives_ended_reviews(client, finish):
    old, _ = create_review(client, [f"Before {MARKER} after."])
    key = str(uuid.uuid4())
    new = client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key}).json()
    complete_scan(new["id"])
    if finish == "apply":
        assert client.patch(f"{ROOT}/{new['id']}/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
        assert client.post(f"{ROOT}/{new['id']}/apply").json()["applied"] == 1
    else:
        assert client.delete(f"{ROOT}/{new['id']}").status_code == 204
    assert client.delete(f"{ROOT}/{old}").status_code == 204
    result = client.get(f"{ROOT}/{old}/rescan-requests/{key}").json()
    assert result["found"] is True and result["scan"] is None
    with session() as db:
        count = db.query(BackgroundJob).count()
    assert client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key}).status_code == 409
    with session() as db:
        assert db.query(BackgroundJob).count() == count


def test_retry_keeps_original_snapshot_new_request_rechecks_and_keeps_choices(client):
    old, messages = create_review(client, [f"Before {MARKER} after."])
    assert client.patch(f"{ROOT}/{old}/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    key = str(uuid.uuid4())
    new = client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key}).json()
    complete_scan(new["id"])
    assert client.get(f"{ROOT}/{old}").json()["delete_count"] == 1
    assert client.get(f"{ROOT}/{new['id']}").json()["delete_count"] == 0
    hit = client.get(f"{ROOT}/{new['id']}/occurrences").json()[0]
    path = f"{ROOT}/{new['id']}/occurrences/{hit['id']}/exception"
    preview = client.get(path).json()
    assert client.post(path, json={"confirmed": True, "preview_token": preview["preview_token"]}).status_code == 201
    with session() as db:
        message_version = db.get(Message, messages[0]).current_version_id
        for conversation in db.query(Conversation):
            conversation.offline_revision += 1
        db.commit()
    assert client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key}).json()["id"] == new["id"]
    fresh = client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    complete_scan(fresh["id"])
    assert client.get(f"{ROOT}/{fresh['id']}").json()["occurrence_count"] == 0
    assert client.get(f"{ROOT}/{old}").json()["delete_count"] == 1
    with session() as db:
        assert db.get(Message, messages[0]).current_version_id == message_version


def test_import_parent_and_active_scope_survive_rescan(client):
    old, messages = create_review(client, [f"Before {MARKER} after.", f"Archived {MARKER} after."])
    parent = str(uuid.uuid4())
    with session() as db:
        scan = db.get(ContentCleanupScan, old)
        scan.source = "IMPORT"
        job = db.get(BackgroundJob, scan.background_job_id)
        job.payload = {**job.payload, "parent_task_id": parent}
        db.get(Conversation, db.get(Message, messages[1]).conversation_id).status = "archived"
        db.commit()
    result = client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    assert result["source"] == "IMPORT" and result["target_count"] == 1
    with session() as db:
        job = db.get(BackgroundJob, uuid.UUID(result["background_job_id"]))
        assert job.payload["parent_task_id"] == job.result["parent_task_id"] == parent


def test_no_header_legacy_rescan_and_invalid_keys(client):
    old, _ = create_review(client, [f"Before {MARKER} after."])
    assert client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": "invalid"}).status_code == 422
    first = client.post(f"{ROOT}/{old}/rescan")
    second = client.post(f"{ROOT}/{old}/rescan")
    assert first.status_code == second.status_code == 202
    assert first.json()["id"] != second.json()["id"]


def test_rescan_and_receipt_deny_other_account(auth_client, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from test_admin_system import _normal_user_session
    for key in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(key, str(tmp_path / key))
    get_settings.cache_clear()
    try:
        _, token_a = _normal_user_session(auth_client)
        _, token_b = _normal_user_session(auth_client)
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", token_a)
        created = auth_client.post("/api/conversations", json={"title": "Synthetic private", "messages": [
            {"role": "user", "content_markdown": "Question"}, {"role": "assistant", "content_markdown": f"Before {MARKER} after."}]}).json()
        old = auth_client.post(ROOT, json={"source": "BATCH", "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [created["conversation"]["id"]]}).json()["id"]
        key = str(uuid.uuid4())
        new = auth_client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key}).json()
        auth_client.cookies.clear()
        auth_client.cookies.set("chat_reader_session", token_b)
        assert auth_client.get(f"{ROOT}/{old}/rescan-requests/{key}").status_code == 404
        assert auth_client.get(f"{ROOT}/{old}/rescan-requests/{uuid.uuid4()}").status_code == 404
        assert auth_client.post(f"{ROOT}/{old}/rescan", headers={"Idempotency-Key": key}).status_code == 404
        assert auth_client.get(f"{ROOT}/{new['id']}").status_code == 404
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize("legacy_pending_job", [False, True])
def test_global_admission_receipt_survives_real_apply(client, legacy_pending_job):
    create_review(client, [f"Before {MARKER} after."])
    key = str(uuid.uuid4())
    admitted = client.post(GLOBAL, headers={"Idempotency-Key": key}).json()
    if legacy_pending_job:
        with session() as db:
            job = db.get(BackgroundJob, uuid.UUID(admitted["background_job_id"]))
            job.payload = {name: value for name, value in job.payload.items() if name != "cleanup_request_key"}
            db.commit()
    scan_id = admitted["id"]
    complete_scan(scan_id)
    assert client.patch(f"{ROOT}/{scan_id}/decisions/filter", json={"decision": "DELETE", "all_matching": True}).status_code == 200
    assert client.post(f"{ROOT}/{scan_id}/apply").json()["applied"] == 1
    assert client.get(f"{ROOT}/{scan_id}/outcome").json()["status"] == "COMPLETED"
    result = client.get(f"{GLOBAL}/requests/{key}").json()
    assert result["found"] is True, "Completion must not erase the admission receipt"
    assert result["scan"] is None and result["job_id"] == admitted["background_job_id"]
    with session() as db:
        count = db.query(BackgroundJob).filter_by(job_type="content_noise_scan").count()
    assert client.post(GLOBAL, headers={"Idempotency-Key": key}).status_code == 409
    with session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="content_noise_scan").count() == count
