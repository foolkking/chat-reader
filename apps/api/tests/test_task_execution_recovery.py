"""Owner recovery after supervised interruption, using actual API/worker paths."""
from datetime import datetime
import os
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.core import auth_middleware
from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupOccurrence, ContentCleanupScan
from app.models.task_execution_control import TaskExecutionControl
from app.models.user import User
from app.services.auth import ROOT_ADMIN_USER_ID, provision_owner
from app.services.background_jobs import process_background_job
from app.services.content_cleanup import process_scan_chunk
from app.services.execution_control import SLOT
from app.services.execution_reconciliation import reconcile
from app.services.worker_supervisor import claim
from background_job_test_utils import process_queued_jobs
from test_admin_execution_recovery import PATH, seed
from test_auth import auth_client, owner_login  # noqa: F401
from test_import_profile_postgres import isolated_schema  # noqa: F401


@pytest.fixture(params=[
    "sqlite",
    pytest.param("postgres", marks=pytest.mark.skipif(
        os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
        reason="explicit disposable PostgreSQL required",
    )),
])
def recovery_client(request):
    # Do not initialize auth_client first: that fixture replaces DATABASE_URL
    # with SQLite, which would invalidate the disposable PostgreSQL boundary.
    fixture = "auth_client" if request.param == "sqlite" else "postgres_auth_client"
    return request.getfixturevalue(fixture)


@pytest.fixture
def postgres_auth_client(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    for key, value in {
        "APP_ENV": "test", "AUTH_ENABLED": "true",
        "AUTH_SESSION_SECRET": "test-only-owner-recovery-secret-0123456789",
        "AUTH_COOKIE_SECURE": "false", "PUBLIC_WEB_BASE_URL": "http://testserver",
        "DATABASE_URL": engine.url.render_as_string(hide_password=False),
        "IMPORT_STORAGE_DIR": str(tmp_path / "imports"),
        "EXPORT_STORAGE_DIR": str(tmp_path / "exports"),
        "OFFLINE_STORAGE_DIR": str(tmp_path / "offline"),
        "ASSET_STORAGE_DIR": str(tmp_path / "assets"),
        "ASSET_STORAGE_BACKEND": "local",
    }.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    with factory() as db:
        principal = provision_owner(db, "correct horse battery staple", get_settings())
        db.get(User, principal.user_id).normalized_email = "admin@example.test"
        db.commit()

    def dependency():
        with factory() as db:
            yield db

    monkeypatch.setattr(auth_middleware, "SessionLocal", factory)
    app.dependency_overrides[get_db] = dependency
    try:
        with TestClient(app, headers={"Origin": "http://testserver"}) as client:
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        get_settings.cache_clear()


def create_conversations(client, count):
    ids = []
    for index in range(count):
        response = client.post("/api/conversations", json={
            "title": f"Synthetic recovery source {index}",
            "messages": [
                {"role": "user", "content_markdown": "Synthetic question"},
                {"role": "assistant", "content_markdown": "Synthetic answer"},
            ],
        })
        assert response.status_code == 201, response.text
        ids.append(response.json()["conversation"]["id"])
    process_queued_jobs(max_jobs=20)
    return ids


@pytest.mark.parametrize("job_type", [
    "user_account_delete",
    "attachment_derivative",
    "conversation_derived_rebuild",
    "toc_refresh",
    "conversation_auto_clean",
    "context_object_cleanup",
    "personal_search_backfill",
])
def test_supervised_owner_stop_keeps_existing_non_cancellable_boundary(recovery_client, job_type):
    auth_client = recovery_client
    identity = seed(auth_middleware.SessionLocal, owner=ROOT_ADMIN_USER_ID)
    task_id = uuid.UUID(identity["task_id"])
    with auth_middleware.SessionLocal() as db:
        db.get(BackgroundJob, task_id).job_type = job_type
        db.commit()
    assert owner_login(auth_client).status_code == 200
    task = auth_client.get(f"/api/tasks/{task_id}")
    assert task.status_code == 200 and task.json()["cancellable"] is False
    response = auth_client.post(f"/api/tasks/{task_id}/cancel")
    assert response.status_code == 409, response.text
    with auth_middleware.SessionLocal() as db:
        assert db.get(TaskExecutionControl, SLOT).stop_requested_at is None
        assert db.get(BackgroundJob, task_id).status == "processing"
    # Root's explicit execution control remains available; an owner cancel is
    # not interchangeable with an administrator interruption and its recovery.
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 200


@pytest.mark.parametrize("job_type", [
    "conversation_export", "attachment_batch_download", "offline_package",
])
def test_supervised_stop_does_not_accept_an_unrelated_source_discard(recovery_client, job_type):
    auth_client = recovery_client
    identity = seed(auth_middleware.SessionLocal, owner=ROOT_ADMIN_USER_ID)
    task_id = uuid.UUID(identity["task_id"])
    with auth_middleware.SessionLocal() as db:
        db.get(BackgroundJob, task_id).job_type = job_type
        db.commit()
    assert owner_login(auth_client).status_code == 200
    response = auth_client.post(f"/api/tasks/{task_id}/cancel", json={"source_disposition": "discard"})
    assert response.status_code == 409, response.text
    with auth_middleware.SessionLocal() as db:
        assert db.get(TaskExecutionControl, SLOT).stop_requested_at is None
    response = auth_client.post(f"/api/tasks/{task_id}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "processing"
    assert response.json()["execution_state"] == "stopping"
    assert auth_client.post(f"/api/tasks/{task_id}/retry").status_code == 409
    assert reconcile("job", task_id, uuid.UUID(identity["execution_token"]), auth_middleware.SessionLocal)
    assert auth_client.get(f"/api/tasks/{task_id}").json()["status"] == "cancelled"


def test_support_notification_is_hidden_at_every_task_action(recovery_client):
    auth_client = recovery_client
    identity = seed(auth_middleware.SessionLocal, owner=ROOT_ADMIN_USER_ID)
    task_id = uuid.UUID(identity["task_id"])
    with auth_middleware.SessionLocal() as db:
        db.get(BackgroundJob, task_id).job_type = "support_notification"
        db.commit()
    assert owner_login(auth_client).status_code == 200
    for response in (
        auth_client.get(f"/api/tasks/{task_id}"),
        auth_client.post(f"/api/tasks/{task_id}/retry"),
        auth_client.post(f"/api/tasks/{task_id}/cancel"),
    ):
        assert response.status_code == 404, response.text
    with auth_middleware.SessionLocal() as db:
        assert db.get(TaskExecutionControl, SLOT).stop_requested_at is None


@pytest.mark.parametrize("first_fails", [False, True])
def test_batch_delete_retry_keeps_committed_item_receipts_and_resumes_only_remaining(
    recovery_client, monkeypatch, first_fails,
):
    auth_client = recovery_client
    assert owner_login(auth_client).status_code == 200
    conversation_ids = create_conversations(auth_client, 3)
    response = auth_client.post("/api/conversations/batch-delete",
        headers={"Idempotency-Key": "synthetic-interrupted-delete"},
        json={"conversation_ids": conversation_ids})
    assert response.status_code == 202, response.text
    task_id = uuid.UUID(response.json()["job_id"])
    factory = auth_middleware.SessionLocal
    calls = []
    from app.services.background_jobs import delete_conversation_record

    def observed_delete(db, conversation_id):
        calls.append(str(conversation_id))
        if first_fails and str(conversation_id) == conversation_ids[0]:
            raise RuntimeError("synthetic item failure")
        return delete_conversation_record(db, conversation_id)

    monkeypatch.setattr("app.services.background_jobs.delete_conversation_record", observed_delete)
    with factory() as db:
        kind, claimed_id, token = claim(db)
    assert claimed_id == task_id
    process_background_job(task_id, session_factory=factory)
    assert reconcile(kind, task_id, token, factory)
    prior = auth_client.get(f"/api/tasks/{task_id}").json()
    assert prior["status"] == "queued" and prior["processed_items"] == 1
    receipts = {
        "deleted_ids": [] if first_fails else conversation_ids[:1],
        "failed": [{"id": conversation_ids[0], "error": "CONVERSATION_DELETE_FAILED"}] if first_fails else [],
    }
    for key, value in receipts.items():
        assert prior["result"][key] == value
    with factory() as db:
        kind, claimed_id, token = claim(db)
    assert claimed_id == task_id
    identity = {"task_kind": kind, "task_id": str(task_id), "execution_token": str(token), "attempt": 1}
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 200
    assert reconcile(kind, task_id, token, factory)
    assert auth_client.get(f"/api/tasks/{task_id}").json()["status"] == "failed"
    response = auth_client.post(f"/api/tasks/{task_id}/retry")
    assert response.status_code == 200
    retried = response.json()
    assert retried["status"] == "queued" and retried["processed_items"] == 1
    for key, value in receipts.items():
        assert retried["result"].get(key) == value
    repeated = auth_client.post(f"/api/tasks/{task_id}/retry")
    assert repeated.status_code == 200
    assert datetime.fromisoformat(repeated.json()["queued_at"]) == datetime.fromisoformat(retried["queued_at"])
    for _ in range(2):
        with factory() as db:
            kind, claimed_id, token = claim(db)
        assert claimed_id == task_id
        process_background_job(task_id, session_factory=factory)
        assert reconcile(kind, task_id, token, factory)
    finished = auth_client.get(f"/api/tasks/{task_id}").json()
    assert finished["status"] == "committed" and finished["processed_items"] == 3
    assert finished["result"]["deleted_ids"] == (conversation_ids[1:] if first_fails else conversation_ids)
    assert finished["result"]["failed"] == receipts["failed"]
    assert calls == ([conversation_ids[0]] * 2 if first_fails else conversation_ids[:1]) + conversation_ids[1:]
    assert auth_client.get(f"/api/conversations/{conversation_ids[0]}").status_code == (200 if first_fails else 404)
    with factory() as db:
        assert db.query(BackgroundJob).filter_by(job_type="conversation_batch_delete").count() == 1
        assert db.get(BackgroundJob, task_id).payload["conversation_ids"] == conversation_ids


def test_scan_reads_report_independent_stop_without_changing_canonical_job_status(recovery_client):
    auth_client = recovery_client
    assert owner_login(auth_client).status_code == 200
    conversation_id = create_conversations(auth_client, 1)[0]
    rule = auth_client.post("/api/content-cleanup/rules",
        json={"name": "Synthetic recovery rule", "match_value": "Synthetic"})
    assert rule.status_code in {200, 201}, rule.text
    response = auth_client.post("/api/content-cleanup/scans", json={
        "scope_type": "CURRENT_CONVERSATION", "conversation_ids": [conversation_id],
    })
    assert response.status_code == 202, response.text
    scan_id = uuid.UUID(response.json()["id"])
    task_id = uuid.UUID(response.json()["background_job_id"])
    factory = auth_middleware.SessionLocal
    with factory() as db:
        kind, claimed_id, token = claim(db)
        assert claimed_id == task_id
        process_scan_chunk(db, scan_id, chunk_size=1)
        db.commit()
    with factory() as holder:
        if holder.get_bind().dialect.name == "postgresql":
            holder.query(BackgroundJob).filter_by(id=task_id).with_for_update().one()
            holder.query(ContentCleanupScan).filter_by(id=scan_id).with_for_update().one()
        started = time.monotonic()
        response = auth_client.post(f"/api/tasks/{task_id}/cancel")
        assert response.status_code == 200 and response.json()["execution_state"] == "stopping"
        requested = response.json()["stop_requested_at"]
        detail = auth_client.get(f"/api/content-cleanup/scans/{scan_id}")
        pending = auth_client.get("/api/content-cleanup/scans/pending")
        assert time.monotonic() - started < 2
    assert detail.status_code == pending.status_code == 200
    scans = [detail.json(), next(item for item in pending.json() if item["id"] == str(scan_id))]
    for scan in scans:
        assert scan["status"] == "SCANNING"
        assert scan["background_job_status"] == "processing"
        assert scan.get("execution_state") == "stopping"
        assert datetime.fromisoformat(scan["stop_requested_at"]) == datetime.fromisoformat(requested)
    with factory() as db:
        assert db.get(BackgroundJob, task_id).status == "processing"
        assert db.get(ContentCleanupScan, scan_id).status == "SCANNING"
        retained_occurrences = db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).count()
        assert retained_occurrences > 0
    assert reconcile(kind, task_id, token, factory)
    ended = auth_client.get(f"/api/content-cleanup/scans/{scan_id}").json()
    assert ended["status"] == "CANCELLED" and ended.get("execution_state") is None
    with factory() as db:
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id).count() == retained_occurrences
    assert auth_client.post(f"/api/content-cleanup/scans/{scan_id}/apply").status_code == 409
