"""Retained deletion admission is independent of execution and mutable sources."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.background_job import BackgroundJob
from background_job_test_utils import process_queued_jobs
from test_auth import auth_client  # noqa: F401
from test_import_preview_api import client  # noqa: F401
from test_merge_admission import create_sources
from test_merge_history_and_cancellation import _database_session

URL = "/api/conversations/batch-delete"


def queue(client, ids, key):
    return client.post(URL, json={"conversation_ids": ids}, headers={"Idempotency-Key": key})


@pytest.mark.parametrize("job_status", ["queued", "processing", "cancelling", "committed", "failed", "cancelled"])
def test_replay_returns_every_retained_status_without_restarting(client, job_status):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, ids, key)
    assert first.status_code == 202
    job_id = first.json()["job_id"]
    with _database_session() as db:
        job = db.get(BackgroundJob, uuid.UUID(job_id))
        job.status = job.phase = job_status
        job.result = {"deleted_ids": []}
        db.commit()
    replay = queue(client, ids, key)
    assert replay.status_code == 202
    assert replay.json()["job_id"] == job_id
    assert replay.json()["status"] == job_status
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_batch_delete", idempotency_key=key).count() == 1


@pytest.mark.parametrize("changed", ["order", "targets"])
def test_reusing_key_for_changed_order_or_targets_conflicts(client, changed):
    ids, key = create_sources(client), str(uuid.uuid4())
    assert queue(client, ids, key).status_code == 202
    conflict = queue(client, list(reversed(ids)) if changed == "order" else ids[:1], key)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "DELETE_REQUEST_CONFLICT"
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_batch_delete", idempotency_key=key).count() == 1


def test_duplicate_ids_keep_existing_first_occurrence_normalization(client):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, [ids[0], ids[0], ids[1]], key)
    assert first.status_code == 202
    assert first.json()["total_items"] == 2
    replay = queue(client, ids, key)
    assert replay.status_code == 202
    assert replay.json()["job_id"] == first.json()["job_id"]


def test_worker_completion_does_not_hide_receipt_or_block_replay(client):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, ids, key)
    assert first.status_code == 202
    process_queued_jobs(max_jobs=10)
    task = client.get(f"/api/tasks/{first.json()['job_id']}").json()
    assert task["status"] == "committed"
    assert task["result"]["deleted_ids"] == ids
    for conversation_id in ids:
        assert client.get(f"/api/conversations/{conversation_id}").status_code == 404
    found = client.get(f"{URL}/requests/{key}")
    assert found.status_code == 200
    assert found.json() == {"found": True, "task": task}
    replay = queue(client, ids, key)
    assert replay.status_code == 202
    assert replay.json() == task
    assert queue(client, ids, str(uuid.uuid4())).status_code == 404


def test_partial_cancelled_receipt_replays_before_source_validation(client):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, ids, key)
    assert first.status_code == 202
    assert client.delete(f"/api/conversations/{ids[0]}").status_code == 204
    with _database_session() as db:
        job = db.get(BackgroundJob, uuid.UUID(first.json()["job_id"]))
        job.status = job.phase = "cancelled"
        job.processed_items = 1
        job.result = {"deleted_ids": ids[:1]}
        db.commit()
    replay = queue(client, ids, key)
    assert replay.status_code == 202
    assert replay.json()["job_id"] == first.json()["job_id"]
    assert replay.json()["status"] == "cancelled"
    assert replay.json()["result"]["deleted_ids"] == ids[:1]
    assert client.get(f"/api/conversations/{ids[1]}").status_code == 200


def test_lookup_is_read_only_outside_active_task_result_window(client):
    ids, key = create_sources(client), str(uuid.uuid4())
    lookup = f"{URL}/requests/{key}"
    missing = client.get(lookup)
    assert missing.status_code == 200
    assert missing.json() == {"found": False, "task": None}
    first = queue(client, ids, key)
    assert first.status_code == 202
    job_id = first.json()["job_id"]
    with _database_session() as db:
        job = db.get(BackgroundJob, uuid.UUID(job_id))
        job.status = job.phase = "cancelled"
        job.completed_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()
    before = client.get(f"/api/tasks/{job_id}").json()
    for _ in range(2):
        response = client.get(lookup)
        assert response.status_code == 200
        assert response.json() == {"found": True, "task": before}
    assert client.get(f"/api/tasks/{job_id}").json() == before
    assert all(task["job_id"] != job_id for task in client.get("/api/tasks/active").json())
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_batch_delete", idempotency_key=key).count() == 1


def test_same_key_isolated_by_authenticated_owner(auth_client, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from test_admin_system import _normal_user_session
    for name in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(name, str(tmp_path / name))
    get_settings.cache_clear()
    try:
        tokens = [_normal_user_session(auth_client)[1] for _ in range(2)]
        key, job_ids, source_ids = str(uuid.uuid4()), [], []
        for token in tokens:
            auth_client.cookies.clear()
            auth_client.cookies.set("chat_reader_session", token)
            missing = auth_client.get(f"{URL}/requests/{key}")
            assert missing.status_code == 200
            assert missing.json() == {"found": False, "task": None}
            ids = create_sources(auth_client)
            source_ids.append(ids)
            first = queue(auth_client, ids, key)
            assert first.status_code == 202
            job_ids.append(first.json()["job_id"])
            found = auth_client.get(f"{URL}/requests/{key}").json()
            assert found["task"]["job_id"] == job_ids[-1]
            assert "payload" not in found["task"] and "idempotency_key" not in found["task"]
        assert job_ids[0] != job_ids[1]
        assert auth_client.get(f"/api/tasks/{job_ids[0]}").status_code == 404
        assert queue(auth_client, source_ids[0], str(uuid.uuid4())).status_code == 404
    finally:
        get_settings.cache_clear()


def test_keys_bounded_without_admitting_work(client):
    ids = create_sources(client)
    assert queue(client, ids, "x" * 201).status_code == 422
    assert client.get(f"{URL}/requests/{'x' * 201}").status_code == 422
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_batch_delete").count() == 0


def test_new_explicit_keys_still_represent_distinct_confirmed_requests(client):
    ids = create_sources(client)
    first = queue(client, ids, str(uuid.uuid4()))
    second = queue(client, ids, str(uuid.uuid4()))
    assert first.status_code == second.status_code == 202
    assert first.json()["job_id"] != second.json()["job_id"]
