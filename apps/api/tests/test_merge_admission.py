"""Admission receipts do not create another merge after an uncertain response."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.background_job import BackgroundJob
from test_import_preview_api import client  # noqa: F401
from test_auth import auth_client  # noqa: F401
from test_merge_history_and_cancellation import _database_session


URL = "/api/conversations/merge"


def create_sources(client):
    ids = []
    for title in ("Synthetic merge first", "Synthetic merge second"):
        response = client.post("/api/conversations", json={"title": title, "messages": [
            {"role": "user", "content_markdown": "Synthetic preserved question"},
            {"role": "assistant", "content_markdown": "Synthetic preserved answer"},
        ]})
        assert response.status_code == 201
        ids.append(response.json()["conversation"]["id"])
    return ids


def queue(client, ids, key, **options):
    return client.post(URL, json={"conversation_ids": ids, "title": "Synthetic merge", **options},
                       headers={"Idempotency-Key": key})


def test_explicit_new_keys_represent_distinct_deliberate_jobs(client):
    ids = create_sources(client)
    first = queue(client, ids, str(uuid.uuid4()))
    second = queue(client, ids, str(uuid.uuid4()))
    assert first.status_code == second.status_code == 202
    assert first.json()["job_id"] != second.json()["job_id"]
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_merge").count() == 2


@pytest.mark.parametrize("job_status", ["queued", "processing", "cancelling", "committed", "failed", "cancelled"])
def test_same_request_returns_retained_task_in_every_status(client, job_status):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, ids, key)
    assert first.status_code == 202
    job_id = first.json()["job_id"]
    with _database_session() as db:
        job = db.get(BackgroundJob, uuid.UUID(job_id))
        job.status = job_status
        job.phase = job_status
        db.commit()
    replay = queue(client, ids, key)
    assert replay.status_code == 202
    assert replay.json()["job_id"] == job_id
    assert replay.json()["status"] == job_status
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_merge", idempotency_key=key).count() == 1


@pytest.mark.parametrize("changed", ["order", "title", "project"])
def test_same_request_key_rejects_changed_merge_payload(client, changed):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, ids, key)
    assert first.status_code == 202
    options = {}
    if changed == "order":
        ids = list(reversed(ids))
    elif changed == "title":
        options["title"] = "Synthetic different title"
    else:
        project = client.post("/api/projects", json={"name": "Synthetic different project"})
        assert project.status_code == 201
        options["project_id"] = project.json()["id"]
    conflict = queue(client, ids, key, **options)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "MERGE_REQUEST_CONFLICT"
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_merge", idempotency_key=key).count() == 1


def test_replay_returns_receipt_before_source_state_validation(client):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, ids, key)
    assert first.status_code == 202
    assert client.post(f"/api/conversations/{ids[0]}/archive").status_code == 200
    replay = queue(client, ids, key)
    assert replay.status_code == 202
    assert replay.json()["job_id"] == first.json()["job_id"]


def test_admission_lookup_is_read_only_and_not_limited_by_task_center_window(client):
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
        job.status = job.phase = "committed"
        job.completed_at = datetime.now(timezone.utc) - timedelta(days=2)
        db.commit()
    before = client.get(f"/api/tasks/{job_id}").json()
    for _ in range(2):
        found = client.get(lookup)
        assert found.status_code == 200
        assert found.json() == {"found": True, "task": before}
    assert client.get(f"/api/tasks/{job_id}").json() == before
    assert all(task["job_id"] != job_id for task in client.get("/api/tasks/active").json())
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_merge", idempotency_key=key).count() == 1


def test_same_key_and_lookup_are_scoped_to_the_authenticated_owner(auth_client, tmp_path, monkeypatch):
    from app.core.config import get_settings
    from test_admin_system import _normal_user_session
    for name in ("IMPORT_STORAGE_DIR", "EXPORT_STORAGE_DIR", "ASSET_STORAGE_DIR", "OFFLINE_STORAGE_DIR"):
        monkeypatch.setenv(name, str(tmp_path / name))
    get_settings.cache_clear()
    try:
        tokens = [_normal_user_session(auth_client)[1] for _ in range(2)]
        key = str(uuid.uuid4())
        job_ids, source_ids = [], []
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
        rejected = queue(auth_client, source_ids[0], str(uuid.uuid4()))
        assert rejected.status_code == 400
    finally:
        get_settings.cache_clear()


def test_long_request_key_rejection_does_not_admit_a_job(client):
    ids = create_sources(client)
    assert queue(client, ids, "x" * 201).status_code == 422
    assert client.get(f"{URL}/requests/{'x' * 201}").status_code == 422
    with _database_session() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_merge").count() == 0


def test_deleted_sources_do_not_delete_or_hide_an_owned_admission_receipt(client):
    ids, key = create_sources(client), str(uuid.uuid4())
    first = queue(client, ids, key)
    assert first.status_code == 202
    assert client.delete(f"/api/conversations/{ids[0]}").status_code == 204
    found = client.get(f"{URL}/requests/{key}")
    assert found.status_code == 200
    assert found.json()["task"]["job_id"] == first.json()["job_id"]
    assert queue(client, ids, key).json()["job_id"] == first.json()["job_id"]
