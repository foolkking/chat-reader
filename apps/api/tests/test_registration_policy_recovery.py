"""Persisted registration policy, rejection, audit and legacy caller behavior."""
from app.core import auth_middleware
from app.core.config import get_settings
from app.models.administration import AdminAuditLog
from app.models.access import InstanceAccessSetting
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session


def test_stale_policy_cannot_remove_new_approval_requirement(auth_client):
    assert owner_login(auth_client).status_code == 200
    old = auth_client.get("/api/admin/access").json()
    updated = auth_client.put("/api/admin/access/registration", json={"mode": "OPEN", "require_admin_approval": True})
    assert updated.status_code == 200
    result = auth_client.put("/api/admin/access/registration", json={"base_revision": old["revision"], "password_reset_enabled": False})
    assert result.status_code == 409
    assert result.json() == {"detail": "REGISTRATION_POLICY_CHANGED"}
    with auth_middleware.SessionLocal() as db:
        policy = db.get(InstanceAccessSetting, 1)
        assert policy.require_admin_approval is True and policy.password_reset_enabled is True
        events = db.query(AdminAuditLog).filter_by(action="REGISTRATION_MODE_CHANGED").all()
        assert len(events) == 1
        assert events[0].event_metadata == {"mode": "OPEN", "require_admin_approval": True}
    current = auth_client.get("/api/admin/access").json()
    result = auth_client.put("/api/admin/access/registration", json={"base_revision": current["revision"], "password_reset_enabled": False})
    assert result.status_code == 200 and result.json()["require_admin_approval"] is True
    auth_client.cookies.clear()
    password = "synthetic pending user passphrase"
    created = auth_client.post("/api/auth/register", json={"email": "pending-policy@example.test", "password": password, "confirm_password": password})
    assert created.status_code == 201
    assert created.json()["authenticated"] is False and created.json()["approval_required"] is True
    assert auth_client.post("/api/auth/login", json={"email": "pending-policy@example.test", "password": password}).status_code == 401


def test_revision_defaults_noop_and_smtp_discovery_are_not_edits(auth_client, monkeypatch):
    assert owner_login(auth_client).status_code == 200
    first = auth_client.get("/api/admin/access").json()
    assert auth_client.get("/api/admin/access").json()["revision"] == first["revision"]
    response = auth_client.put("/api/admin/access/registration", json={"base_revision": first["revision"]})
    assert response.status_code == 200 and response.json()["revision"] == first["revision"]
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "noreply@example.test")
    get_settings.cache_clear()
    latest = auth_client.get("/api/admin/access").json()
    assert latest["smtp_configured"] is True and latest["revision"] == first["revision"]
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(action="REGISTRATION_MODE_CHANGED").count() == 0


def test_mail_unavailable_does_not_reset_or_block_unmodified_existing_verification(auth_client, monkeypatch):
    assert owner_login(auth_client).status_code == 200
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "noreply@example.test")
    get_settings.cache_clear()
    enabled = auth_client.put("/api/admin/access/registration", json={"email_verification_enabled": True})
    assert enabled.status_code == 200
    monkeypatch.setenv("SMTP_HOST", "")
    get_settings.cache_clear()
    saved = auth_client.put("/api/admin/access/registration", json={"base_revision": enabled.json()["revision"], "require_admin_approval": True})
    assert saved.status_code == 200 and saved.json()["email_verification_enabled"] is True
    assert saved.json()["smtp_configured"] is False
    disabled = auth_client.put("/api/admin/access/registration", json={"email_verification_enabled": False})
    assert disabled.status_code == 200
    denied = auth_client.put("/api/admin/access/registration", json={"email_verification_enabled": True})
    assert denied.status_code == 422
    assert auth_client.get("/api/admin/access").json()["email_verification_enabled"] is False


def test_old_mode_only_and_new_flag_only_writes_preserve_other_fields(auth_client):
    assert owner_login(auth_client).status_code == 200
    initial = auth_client.put("/api/admin/access/registration", json={"mode": "OPEN", "require_admin_approval": True, "password_reset_enabled": False})
    assert initial.status_code == 200
    legacy = auth_client.put("/api/admin/access/registration", json={"mode": "INVITE_ONLY"})
    assert legacy.status_code == 200
    assert legacy.json()["require_admin_approval"] is True and legacy.json()["password_reset_enabled"] is False
    flag = auth_client.put("/api/admin/access/registration", json={"password_reset_enabled": True})
    assert flag.status_code == 200 and flag.json()["registration_mode"] == "INVITE_ONLY"
    assert flag.json()["require_admin_approval"] is True
    assert auth_client.put("/api/admin/access/registration", json={"mode": "INVALID"}).status_code == 422


def test_reading_result_never_mutates_or_audits_and_second_edit_conflicts(auth_client):
    assert owner_login(auth_client).status_code == 200
    saved = auth_client.put("/api/admin/access/registration", json={"require_admin_approval": True})
    assert saved.status_code == 200
    for _ in range(2):
        assert auth_client.get("/api/admin/access").json()["revision"] == saved.json()["revision"]
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(action="REGISTRATION_MODE_CHANGED").count() == 1
    assert auth_client.put("/api/admin/access/registration", json={"mode": "INVITE_ONLY"}).status_code == 200
    assert auth_client.put("/api/admin/access/registration", json={"base_revision": saved.json()["revision"], "password_reset_enabled": False}).status_code == 409


def test_normal_account_cannot_read_or_write_registration_policy(auth_client):
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    auth_client.cookies.set("chat_reader_session_present", "1")
    assert auth_client.get("/api/admin/access").status_code == 404
    assert auth_client.put("/api/admin/access/registration", json={"require_admin_approval": False}).status_code == 404


def test_audit_failure_rolls_back_policy_changes(auth_client, monkeypatch):
    from app.api.routes import admin_access
    assert owner_login(auth_client).status_code == 200
    before = auth_client.get("/api/admin/access").json()
    def fail_audit(*args, **kwargs):
        raise RuntimeError("synthetic audit failure")
    monkeypatch.setattr(admin_access, "_record", fail_audit)
    failed = auth_client.put("/api/admin/access/registration", json={"base_revision": before["revision"], "require_admin_approval": True})
    assert failed.status_code == 500
    assert auth_client.get("/api/admin/access").json() == before
    with auth_middleware.SessionLocal() as db:
        assert db.query(AdminAuditLog).filter_by(action="REGISTRATION_MODE_CHANGED").count() == 0
