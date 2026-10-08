import uuid
from datetime import datetime, timezone
import pytest

from app.core import auth_middleware
from app.models.administration import AdminAuditLog, UserDeletionRequest
from app.models.background_job import BackgroundJob
from app.models.user import User
from app.services.background_jobs import claim_next_job, process_background_job
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session


@pytest.mark.parametrize("action,verification_required,expected_status,expected_approval,can_login", [
    ("approve", False, "ACTIVE", "APPROVED", True),
    ("approve", True, "PENDING", "APPROVED", False),
    ("reject", False, "DISABLED", "REJECTED", False),
])
def test_review_acknowledges_the_persisted_account_without_bypassing_verification(
    auth_client, action, verification_required, expected_status, expected_approval, can_login,
):
    target, token = _normal_user_session(auth_client)
    with auth_middleware.SessionLocal() as db:
        row = db.get(User, target)
        row.status = "PENDING"
        row.approval_status = "PENDING"
        row.email_verification_required = verification_required
        db.commit()
    assert owner_login(auth_client).status_code == 200
    response = auth_client.post(f"/api/admin/access/users/{target}/{action}")
    assert response.status_code == 200
    result = response.json()
    assert result["id"] == str(target) and result["status"] == expected_status
    persisted = auth_client.get(f"/api/admin/access/users/{target}").json()
    acknowledged = dict(result["user"])
    # SQLite strips timezone metadata on read; compare the actual UTC instant.
    assert datetime.fromisoformat(acknowledged.pop("approval_reviewed_at")).replace(tzinfo=timezone.utc) == datetime.fromisoformat(persisted.pop("approval_reviewed_at")).replace(tzinfo=timezone.utc)
    assert acknowledged == persisted
    assert result["user"]["approval_status"] == expected_approval
    assert result["user"]["can_login"] is can_login
    with auth_middleware.SessionLocal() as db:
        row = db.get(User, target)
        assert (row.status, row.approval_status, row.can_login) == (expected_status, expected_approval, can_login)
    assert not {"password", "password_hash", "token", "credential_version"}.intersection(result["user"])


def test_status_acknowledges_real_revocation_and_pending_enable(auth_client):
    target, token = _normal_user_session(auth_client)
    assert owner_login(auth_client).status_code == 200
    path = f"/api/admin/access/users/{target}"
    disabled = auth_client.patch(path + "/status", json={"status": "DISABLED"})
    assert disabled.status_code == 200
    assert disabled.json()["user"] == auth_client.get(path).json()
    assert disabled.json()["user"]["can_login"] is False
    from app.services.auth import authenticate_session
    from app.core.config import get_settings
    with auth_middleware.SessionLocal() as db:
        assert authenticate_session(db, token, get_settings(), touch=False) is None
        row = db.get(User, target)
        row.email_verification_required = True
        db.commit()
    enabled = auth_client.patch(path + "/status", json={"status": "ACTIVE"})
    assert enabled.status_code == 200
    assert enabled.json()["status"] == "PENDING"
    assert enabled.json()["user"] == auth_client.get(path).json()
    assert enabled.json()["user"]["can_login"] is False


def test_directory_filters_are_literal_paginated_and_root_only(auth_client):
    target, token = _normal_user_session(auth_client)
    with auth_middleware.SessionLocal() as db:
        user = db.get(User, target)
        user.display_name = "Synthetic 10%_reader"
        user.email_verification_required = True
        db.add(User(normalized_email="pending-directory@example.test", status="PENDING", approval_status="PENDING"))
        db.commit()
    _, active_token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", active_token)
    assert auth_client.get("/api/admin/access/users/page").status_code == 404
    assert auth_client.get(f"/api/admin/access/users/{target}").status_code == 404
    assert owner_login(auth_client).status_code == 200
    result = auth_client.get("/api/admin/access/users/page", params={"q": "%_", "state": "UNVERIFIED", "limit": 1}).json()
    assert result["total"] == 1
    assert result["items"][0]["id"] == str(target)
    assert result["items"][0]["can_login"] is False
    assert auth_client.get("/api/admin/access/users/page", params={"q": "%_", "offset": 1}).json()["items"] == []
    assert auth_client.get("/api/admin/access/users/page?state=PENDING").json()["total"] == 1
    assert auth_client.get("/api/admin/access/users/page?state=ACTIVE").json()["total"] == 2
    assert auth_client.get("/api/admin/access/users/page?limit=101").status_code == 422
    assert auth_client.get(f"/api/admin/access/users/{target}").json()["stats"]["conversations"] == 0
    assert isinstance(auth_client.get("/api/admin/access/users").json(), list)


def test_deletion_idempotency_persisted_state_session_lock_and_retry(auth_client, monkeypatch):
    target, token = _normal_user_session(auth_client)
    other, _ = _normal_user_session(auth_client)
    assert owner_login(auth_client).status_code == 200
    url = f"/api/admin/access/users/{target}/delete"
    args = {"json": {"confirm_user_id": str(target)}, "headers": {"Idempotency-Key": "directory-delete"}}
    queued = auth_client.post(url, **args)
    assert queued.status_code == 202
    job_id = uuid.UUID(queued.json()["job_id"])
    assert auth_client.post(url, **args).json()["job_id"] == str(job_id)
    assert auth_client.post(url, json=args["json"]).json()["job_id"] == str(job_id)
    assert auth_client.post(f"/api/admin/access/users/{other}/delete", json={"confirm_user_id": str(other)},
                            headers=args["headers"]).status_code == 409
    row = auth_client.get(f"/api/admin/access/users/{target}").json()
    assert row["status"] == "DISABLED" and row["deletion"]["job_id"] == str(job_id)
    assert auth_client.patch(f"/api/admin/access/users/{target}/status", json={"status": "ACTIVE"}).status_code == 409
    assert auth_client.post(f"/api/admin/access/users/{target}/password-reset", json={}).status_code == 409
    with auth_middleware.SessionLocal() as db:
        from app.services.auth import authenticate_session
        from app.core.config import get_settings
        assert authenticate_session(db, token, get_settings(), touch=False) is None
        assert claim_next_job(db, job_type="user_account_delete") == job_id
        db.commit()
    from app.services import background_jobs
    real = background_jobs.execute_user_account_delete
    def fail_after_delete(*a, **kw):
        real(*a, **kw)
        raise RuntimeError("Synthetic rollback")
    monkeypatch.setattr(background_jobs, "execute_user_account_delete", fail_after_delete)
    process_background_job(job_id, session_factory=auth_middleware.SessionLocal)
    row = auth_client.get(f"/api/admin/access/users/{target}").json()
    assert row["deletion"]["status"] == "failed" and row["status"] == "DISABLED"
    assert auth_client.post(url, **args).json()["job_id"] == str(job_id)
    assert auth_client.post(f"/api/tasks/{job_id}/retry").json()["status"] == "queued"
    with auth_middleware.SessionLocal() as db:
        assert db.query(UserDeletionRequest).one().status == "QUEUED"
        assert claim_next_job(db, job_type="user_account_delete") == job_id
        db.commit()
    monkeypatch.setattr(background_jobs, "execute_user_account_delete", real)
    process_background_job(job_id, session_factory=auth_middleware.SessionLocal)
    assert auth_client.get(f"/api/admin/access/users/{target}").status_code == 404
    assert auth_client.post(url, **args).json()["job_id"] == str(job_id)
    with auth_middleware.SessionLocal() as db:
        assert db.query(BackgroundJob).filter_by(job_type="user_account_delete").count() == 1
        assert db.query(AdminAuditLog).filter_by(action="USER_DELETED").count() == 1
        assert db.query(AdminAuditLog).filter_by(action="USER_DELETE_QUEUED").count() == 1
