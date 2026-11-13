"""Root control plane: actual authenticated routes, synthetic cross-account jobs."""
from datetime import datetime, timedelta, timezone
import uuid
import os
import time

import pytest

from app.core import auth_middleware
from app.models.administration import AdminAuditLog
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.task_execution_control import TaskExecutionControl
from app.services.execution_control import SLOT
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session
from test_import_profile_postgres import isolated_schema  # noqa: F401

PATH = "/api/admin/runtime-execution"


def seed(factory, *, kind="job", owner=None, stop_reason=None):
    now = datetime.now(timezone.utc)
    with factory() as db:
        if kind == "job":
            task = BackgroundJob(job_type="conversation_export", owner_user_id=owner,
                payload={"private-body": "never project this"}, error_message="private error",
                status="processing", attempt_count=1, started_at=now)
        else:
            task = ImportRecord(source_profile="private-profile", source_fingerprint=uuid.uuid4().hex,
                detected_title="private title", json_filename="private filename", owner_user_id=owner,
                status="processing", attempt_count=1, started_at=now)
        db.add(task)
        db.flush()
        control = TaskExecutionControl(slot=SLOT, token=uuid.uuid4(), task_kind=kind,
            task_id=task.id, attempt=1, started_at=now, progress_at=now - timedelta(seconds=301),
            stop_requested_at=now if stop_reason else None, stop_reason=stop_reason,
            source_disposition="discard" if stop_reason else None)
        db.add(control)
        db.commit()
        return {"task_kind": kind, "task_id": str(task.id), "execution_token": str(control.token), "attempt": 1}


def check(client, identity):
    return client.get(PATH + "/result", params=identity)


def test_execution_is_root_only_and_snapshot_is_read_only(auth_client):
    assert auth_client.get(PATH).status_code == 401
    user_id, token = _normal_user_session(auth_client)
    identity = seed(auth_middleware.SessionLocal, owner=user_id)
    auth_client.cookies.set("chat_reader_session", token)
    for response in (auth_client.get(PATH), check(auth_client, identity),
                     auth_client.post(PATH + "/stop", json=identity)):
        assert response.status_code == 404
    assert owner_login(auth_client).status_code == 200
    response = auth_client.get(PATH)
    assert response.status_code == 200, response.text
    assert "no-store" in response.headers["cache-control"]
    assert "private" not in response.text
    current = response.json()["current"]
    assert current["identity"] == identity and current["state"] == "stalled"
    assert current["owner"]["id"] == str(user_id) and current["stop_allowed"]
    with auth_middleware.SessionLocal() as db:
        assert db.get(TaskExecutionControl, SLOT).stop_requested_at is None
        assert db.query(AdminAuditLog).filter_by(action="TASK_EXECUTION_STOP_REQUESTED").count() == 0


@pytest.mark.parametrize("kind", ["job", "import"])
def test_stop_is_audited_once_retains_source_and_does_not_complete_task(auth_client, kind):
    user_id, _ = _normal_user_session(auth_client)
    identity = seed(auth_middleware.SessionLocal, kind=kind, owner=user_id)
    assert owner_login(auth_client).status_code == 200
    for _ in range(2):
        response = auth_client.post(PATH + "/stop", json=identity)
        assert response.status_code == 200, response.text
        assert response.json()["state"] == "stopping"
        assert response.json()["canonical_status"] == "processing"
        assert response.json()["source_disposition"] == "retain"
    with auth_middleware.SessionLocal() as db:
        control = db.get(TaskExecutionControl, SLOT)
        assert control.stop_reason == "admin"
        row = db.get(BackgroundJob if kind == "job" else ImportRecord, uuid.UUID(identity["task_id"]))
        assert row.status == "processing" and row.attempt_count == 1
        audit = db.query(AdminAuditLog).filter_by(action="TASK_EXECUTION_STOP_REQUESTED").one()
        assert audit.target_user_id == user_id
        assert audit.resource_id == identity["execution_token"]
    assert check(auth_client, identity).json()["stop_recorded_at"] is not None


def test_old_page_cannot_stop_next_attempt_and_old_result_can_be_checked(auth_client):
    identity = seed(auth_middleware.SessionLocal)
    assert owner_login(auth_client).status_code == 200
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 200
    with auth_middleware.SessionLocal() as db:
        row = db.get(BackgroundJob, uuid.UUID(identity["task_id"]))
        row.status = "cancelled"
        control = db.get(TaskExecutionControl, SLOT)
        control.token = uuid.uuid4()
        control.task_id = uuid.uuid4()
        control.stop_requested_at = None
        control.stop_reason = None
        db.commit()
    response = auth_client.post(PATH + "/stop", json=identity)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "TASK_EXECUTION_CHANGED"
    result = check(auth_client, identity).json()
    assert result["canonical_status"] == "cancelled" and result["stop_recorded_at"]
    assert not result["stop_allowed"]
    assert auth_client.get(PATH).json()["last_stop"]["identity"] == identity
    with auth_middleware.SessionLocal() as db:
        assert db.get(TaskExecutionControl, SLOT).stop_requested_at is None


def test_retry_reusing_attempt_number_cannot_be_reported_as_original_outcome(auth_client):
    identity = seed(auth_middleware.SessionLocal)
    assert owner_login(auth_client).status_code == 200
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 200
    with auth_middleware.SessionLocal() as db:
        task = db.get(BackgroundJob, uuid.UUID(identity["task_id"]))
        # Manual retry resets attempt_count, so it is not an execution identity.
        task.started_at += timedelta(seconds=1)
        task.status = "committed"
        control = db.get(TaskExecutionControl, SLOT)
        control.token = uuid.uuid4()
        control.started_at = task.started_at
        control.stop_requested_at = control.stop_reason = None
        db.commit()
    result = check(auth_client, identity).json()
    assert result["canonical_status"] is None
    assert result["state"] == "changed" and result["stop_recorded_at"] is not None


def test_committed_result_wins_and_missing_control_does_not_allow_stop(auth_client):
    identity = seed(auth_middleware.SessionLocal)
    assert owner_login(auth_client).status_code == 200
    with auth_middleware.SessionLocal() as db:
        db.get(BackgroundJob, uuid.UUID(identity["task_id"])).status = "committed"
        db.commit()
    result = check(auth_client, identity).json()
    assert result["state"] == "reconciling" and result["canonical_status"] == "committed"
    assert not result["stop_allowed"]
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 409
    with auth_middleware.SessionLocal() as db:
        db.get(BackgroundJob, uuid.UUID(identity["task_id"])).status = "processing"
        db.delete(db.get(TaskExecutionControl, SLOT))
        db.commit()
    assert auth_client.get(PATH).json()["untracked"] is True
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 409


def test_stop_cannot_override_prior_explicit_discard_or_inject_disposition(auth_client):
    identity = seed(auth_middleware.SessionLocal, stop_reason="user")
    assert owner_login(auth_client).status_code == 200
    assert auth_client.post(PATH + "/stop", json={**identity, "source_disposition": "discard"}).status_code == 422
    response = auth_client.post(PATH + "/stop", json=identity)
    assert response.status_code == 200
    assert response.json()["source_disposition"] == "discard"
    with auth_middleware.SessionLocal() as db:
        assert db.get(TaskExecutionControl, SLOT).stop_reason == "user"


def test_unconfirmed_commit_is_read_only_recoverable(auth_client, monkeypatch):
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import OperationalError
    identity = seed(auth_middleware.SessionLocal)
    assert owner_login(auth_client).status_code == 200
    original = Session.commit
    def lost_ack(db):
        control = db.get(TaskExecutionControl, SLOT)
        stopping = control is not None and control.stop_reason == "admin"
        original(db)
        if stopping:
            raise OperationalError("synthetic", {}, Exception("private database error"))
    with monkeypatch.context() as patch:
        patch.setattr(Session, "commit", lost_ack)
        response = auth_client.post(PATH + "/stop", json=identity)
    assert response.status_code == 503 and "private" not in response.text
    assert check(auth_client, identity).json()["state"] == "stopping"
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(action="TASK_EXECUTION_STOP_REQUESTED").count() == 1


def test_audit_failure_rolls_back_stop_request_without_mutating_business(auth_client, monkeypatch):
    from sqlalchemy.exc import OperationalError
    from app.services import admin_execution
    identity = seed(auth_middleware.SessionLocal)
    assert owner_login(auth_client).status_code == 200
    original = admin_execution.record_admin_audit
    def fail_after_audit(*args, **kwargs):
        original(*args, **kwargs)
        raise OperationalError("synthetic", {}, Exception("private audit failure"))
    monkeypatch.setattr(admin_execution, "record_admin_audit", fail_after_audit)
    response = auth_client.post(PATH + "/stop", json=identity)
    assert response.status_code == 503 and "private" not in response.text
    result = check(auth_client, identity).json()
    assert result["state"] == "stalled" and result["stop_recorded_at"] is None
    with auth_middleware.SessionLocal() as db:
        assert db.get(TaskExecutionControl, SLOT).stop_requested_at is None
        assert db.query(AdminAuditLog).filter_by(action="TASK_EXECUTION_STOP_REQUESTED").count() == 0


def test_stopped_notification_preserves_unknown_side_effect_and_is_not_replayed(auth_client):
    from app.models.support_request import SupportRequest, SupportMessage
    from app.services.auth import ROOT_ADMIN_USER_ID
    from app.services.execution_reconciliation import reconcile
    identity = seed(auth_middleware.SessionLocal, owner=ROOT_ADMIN_USER_ID)
    with auth_middleware.SessionLocal() as db:
        job = db.get(BackgroundJob, uuid.UUID(identity["task_id"]))
        job.job_type = "support_notification"
        request = SupportRequest(owner_user_id=ROOT_ADMIN_USER_ID, kind="ISSUE",
            title="Synthetic issue", creation_key="synthetic", creation_digest="a" * 64)
        db.add(request); db.flush()
        message = SupportMessage(request_id=request.id, author_user_id=ROOT_ADMIN_USER_ID,
            author_role="ADMIN", body="Synthetic reply", operation_key="synthetic",
            operation_digest="b" * 64, mail_state="SENDING", notification_job_id=job.id,
            notification_attempts=1)
        db.add(message); db.commit()
    assert owner_login(auth_client).status_code == 200
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 200
    assert reconcile("job", uuid.UUID(identity["task_id"]), uuid.UUID(identity["execution_token"]), auth_middleware.SessionLocal)
    assert check(auth_client, identity).json()["canonical_status"] == "failed"
    with auth_middleware.SessionLocal() as db:
        message = db.query(SupportMessage).one()
        assert message.mail_state == "UNKNOWN" and message.notification_attempts == 1


def test_admin_interruption_keeps_account_deletion_in_its_original_retry_flow(auth_client):
    from app.models.administration import UserDeletionRequest
    from app.services.execution_reconciliation import reconcile
    from app.services.worker_supervisor import claim
    user_id, _ = _normal_user_session(auth_client)
    assert owner_login(auth_client).status_code == 200
    response = auth_client.post(f"/api/admin/access/users/{user_id}/delete",
        json={"confirm_user_id": str(user_id)}, headers={"Idempotency-Key": "synthetic-admin-stop"})
    assert response.status_code in {200, 202}, response.text
    with auth_middleware.SessionLocal() as db:
        kind, task_id, token = claim(db)
    identity = {"task_kind": kind, "task_id": str(task_id), "execution_token": str(token), "attempt": 1}
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 200
    assert reconcile(kind, task_id, token, auth_middleware.SessionLocal)
    with auth_middleware.SessionLocal() as db:
        assert db.get(BackgroundJob, task_id).status == "failed"
        assert db.query(UserDeletionRequest).one().status == "FAILED"
    response = auth_client.post(f"/api/tasks/{task_id}/retry")
    assert response.status_code == 200 and response.json()["status"] == "queued"
    with auth_middleware.SessionLocal() as db:
        assert db.query(UserDeletionRequest).one().status == "QUEUED"
        assert db.query(BackgroundJob).filter_by(job_type="user_account_delete").count() == 1


def test_only_original_account_can_retry_interrupted_analysis_and_source_is_preserved(auth_client):
    from app.services.execution_reconciliation import reconcile
    user_id, token = _normal_user_session(auth_client)
    identity = seed(auth_middleware.SessionLocal, owner=user_id)
    with auth_middleware.SessionLocal() as db:
        job = db.get(BackgroundJob, uuid.UUID(identity["task_id"]))
        job.job_type = "adaptive_import_analysis"
        source = ImportRecord(owner_user_id=user_id, source_profile="adaptive_json_markdown",
            source_fingerprint="synthetic-retained-source", status="analyzing", session_state="ANALYZING",
            analysis_summary={"analysis_task_id": str(job.id)})
        db.add(source); db.flush()
        source_id = source.id
        job.payload = {"import_id": str(source_id), "previous_state": "COLLECTING"}
        db.commit()
    assert owner_login(auth_client).status_code == 200
    assert auth_client.post(PATH + "/stop", json=identity).status_code == 200
    assert reconcile("job", uuid.UUID(identity["task_id"]), uuid.UUID(identity["execution_token"]), auth_middleware.SessionLocal)
    with auth_middleware.SessionLocal() as db:
        source = db.get(ImportRecord, source_id)
        assert source.status == "failed" and source.session_state == "FAILED"
        assert source.source_fingerprint == "synthetic-retained-source"
        assert db.get(BackgroundJob, uuid.UUID(identity["task_id"])).payload["source_disposition"] == "retain"
    retry_url = f"/api/tasks/{identity['task_id']}/retry"
    assert auth_client.post(retry_url).status_code == 404
    auth_client.cookies.set("chat_reader_session", token)
    response = auth_client.post(retry_url)
    assert response.status_code == 200 and response.json()["status"] == "queued"
    with auth_middleware.SessionLocal() as db:
        assert db.query(BackgroundJob).filter_by(job_type="adaptive_import_analysis").count() == 1
        assert db.get(ImportRecord, source_id).session_state == "ANALYZING"


@pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="disposable PostgreSQL required")
@pytest.mark.parametrize("locked", ["canonical", "control"])
def test_postgres_authenticated_stop_has_bounded_locking_and_atomic_receipt(isolated_schema, monkeypatch, locked):
    from fastapi.testclient import TestClient
    from sqlalchemy.orm import sessionmaker
    from app.core.config import get_settings
    from app.core.database import get_db
    from app.main import app
    from app.models.user import User
    from app.services.auth import provision_owner
    from app.services.execution_control import EXECUTION_LOCK, session_lease
    from app.services.execution_reconciliation import reconcile
    from app.services.worker_supervisor import claim

    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    for key, value in {
        "APP_ENV": "test", "AUTH_ENABLED": "true",
        "AUTH_SESSION_SECRET": "test-only-admin-runtime-secret-0123456789",
        "AUTH_COOKIE_SECURE": "false", "PUBLIC_WEB_BASE_URL": "http://testserver",
    }.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    with factory() as db:
        principal = provision_owner(db, "correct horse battery staple", get_settings())
        db.get(User, principal.user_id).normalized_email = "admin@example.test"
        other = User(normalized_email="synthetic-other@example.test")
        db.add(other); db.flush()
        owner_id = other.id
        db.commit()
    identity = seed(factory, owner=owner_id)
    def dependency():
        with factory() as db:
            yield db
    monkeypatch.setattr(auth_middleware, "SessionLocal", factory)
    app.dependency_overrides[get_db] = dependency
    try:
        with TestClient(app, headers={"Origin": "http://testserver"}) as client:
            assert owner_login(client).status_code == 200
            with factory() as holder:
                model = BackgroundJob if locked == "canonical" else TaskExecutionControl
                holder.query(model).with_for_update().one()
                started = time.monotonic()
                response = client.post(PATH + "/stop", json=identity)
                assert time.monotonic() - started < 2
                assert response.status_code == (200 if locked == "canonical" else 503), response.text
                with factory() as verify:
                    assert verify.get(BackgroundJob, uuid.UUID(identity["task_id"])).status == "processing"
                    assert claim(verify) is None
            if locked == "control":
                assert check(client, identity).json()["stop_recorded_at"] is None
                assert client.post(PATH + "/stop", json=identity).status_code == 200
            with factory() as db:
                assert db.query(AdminAuditLog).filter_by(action="TASK_EXECUTION_STOP_REQUESTED").count() == 1
            # Reconciliation remains the existing executor's responsibility.
            with session_lease(engine, EXECUTION_LOCK) as lease:
                assert lease is not None
                assert reconcile(identity["task_kind"], uuid.UUID(identity["task_id"]),
                    uuid.UUID(identity["execution_token"]), factory)
            result = check(client, identity).json()
            assert result["state"] == "finished" and result["canonical_status"] == "failed"
            assert not result["stop_allowed"]
    finally:
        app.dependency_overrides.pop(get_db, None)
        get_settings.cache_clear()
