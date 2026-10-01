from datetime import timedelta
from urllib.parse import parse_qs, urlsplit
import uuid

import pytest

from app.api.routes import auth as auth_routes
from app.core import auth_middleware
from app.core.config import get_settings
from app.models.access import EmailVerificationGrant
from app.models.auth import AuthPrincipal, AuthSession
from app.models.content_cleanup import ContentCleanupRule
from app.models.user import User
from app.services.auth import issue_session, utc_now
from app.services.content_cleanup import active_revisions
from app.services.ownership import OwnershipScope
from test_admin_system import _normal_user_session
from test_auth import auth_client, owner_login  # noqa: F401

PASSWORD = "verification synthetic passphrase"
EMAIL = "verification@example.test"


@pytest.fixture
def mail(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "noreply@example.test")
    get_settings.cache_clear()
    messages = []
    monkeypatch.setattr(auth_routes, "send_email_verification", lambda settings, recipient, url: messages.append(url))
    yield messages
    get_settings.cache_clear()


def configure(client, *, approval=True):
    assert owner_login(client).status_code == 200
    result = client.put("/api/admin/access/registration", json={
        "mode": "OPEN", "require_admin_approval": approval,
        "email_verification_enabled": True, "password_reset_enabled": False,
    })
    assert result.status_code == 200
    client.cookies.clear()


def register(client):
    response = client.post("/api/auth/register", json={
        "email": EMAIL, "password": PASSWORD, "confirm_password": PASSWORD,
    })
    assert response.status_code == 201
    assert response.json()["authenticated"] is False
    assert client.get("/api/auth/session").json()["authenticated"] is False
    return response.json()


def token(mail):
    parsed = urlsplit(mail[-1])
    assert not parsed.query  # Web page and access logs never receive the token.
    return parse_qs(parsed.fragment)["token"][0]


def login(client):
    return client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})


def test_mode_only_update_preserves_policy_and_existing_accounts(auth_client, mail):
    user_id, existing_token = _normal_user_session(auth_client)
    configure(auth_client)
    owner_login(auth_client)
    result = auth_client.put("/api/admin/access/registration", json={"mode": "INVITE_ONLY"})
    assert result.status_code == 200
    assert result.json()["require_admin_approval"] is True
    assert result.json()["email_verification_enabled"] is True
    assert result.json()["password_reset_enabled"] is False
    auth_client.cookies.clear()
    auth_client.cookies.set("chat_reader_session", existing_token)
    assert auth_client.get("/api/auth/me").json()["user_id"] == str(user_id)


def test_policy_cannot_enable_verification_without_mail(auth_client, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "")
    get_settings.cache_clear()
    owner_login(auth_client)
    response = auth_client.put("/api/admin/access/registration", json={"mode": "OPEN", "email_verification_enabled": True})
    assert response.status_code == 422
    assert auth_client.get("/api/admin/access").json()["email_verification_enabled"] is False


@pytest.mark.parametrize("approve_first", [False, True])
def test_approval_and_verification_are_independent(auth_client, mail, approve_first):
    configure(auth_client)
    state = register(auth_client)
    assert state["email_verification_required"] and state["approval_required"]
    assert state["verification_delivery"] == "sent"
    assert login(auth_client).status_code == 401
    with auth_middleware.SessionLocal() as db:
        principal = db.query(AuthPrincipal).filter(AuthPrincipal.user_id == uuid.UUID(state["user_id"])).one()
        assert db.query(AuthSession).filter(AuthSession.principal_id == principal.id).count() == 0
        grant = db.query(EmailVerificationGrant).one()
        assert grant.token_digest != token(mail)
    if approve_first:
        owner_login(auth_client)
        assert auth_client.post(f"/api/admin/access/users/{state['user_id']}/approve").json()["status"] == "PENDING"
        auth_client.cookies.clear()
        assert login(auth_client).status_code == 401
    result = auth_client.post("/api/auth/email-verification/confirm", json={"token": token(mail)})
    assert result.status_code == 200
    assert result.json()["approval_required"] is not approve_first
    assert auth_client.get("/api/auth/session").json()["authenticated"] is False
    if not approve_first:
        assert login(auth_client).status_code == 401
        owner_login(auth_client)
        assert auth_client.post(f"/api/admin/access/users/{state['user_id']}/approve").json()["status"] == "ACTIVE"
        auth_client.cookies.clear()
    assert login(auth_client).status_code == 200
    assert auth_client.post("/api/auth/email-verification/confirm", json={"token": token(mail)}).status_code == 422


@pytest.mark.parametrize("operation", ["reject", "disable"])
def test_rejected_or_disabled_cannot_be_activated_by_verification(auth_client, mail, operation):
    configure(auth_client)
    state = register(auth_client)
    owner_login(auth_client)
    if operation == "reject":
        assert auth_client.post(f"/api/admin/access/users/{state['user_id']}/reject").status_code == 200
    else:
        assert auth_client.patch(f"/api/admin/access/users/{state['user_id']}/status", json={"status": "DISABLED"}).status_code == 200
    auth_client.cookies.clear()
    assert auth_client.post("/api/auth/email-verification/confirm", json={"token": token(mail)}).status_code == 422
    assert login(auth_client).status_code == 401
    with auth_middleware.SessionLocal() as db:
        user = db.get(User, uuid.UUID(state["user_id"]))
        assert user.email_verified_at is None


def test_preview_get_does_not_consume_and_resend_revokes_old_link(auth_client, mail):
    configure(auth_client, approval=False)
    register(auth_client)
    first = token(mail)
    assert auth_client.get("/api/auth/email-verification/confirm", params={"token": first}).status_code == 405
    with auth_middleware.SessionLocal() as db:
        assert db.query(EmailVerificationGrant).one().used_at is None
    assert auth_client.post("/api/auth/email-verification/request", json={"email": EMAIL, "password": PASSWORD}).status_code == 204
    assert token(mail) != first
    assert auth_client.post("/api/auth/email-verification/confirm", json={"token": first}).status_code == 422
    assert auth_client.post("/api/auth/email-verification/confirm", json={"token": token(mail)}).status_code == 200
    assert login(auth_client).status_code == 200


@pytest.mark.parametrize("invalidity", ["expiry", "purpose", "credentials"])
def test_expired_wrong_purpose_or_old_credential_grants_fail(auth_client, mail, invalidity):
    configure(auth_client, approval=False)
    register(auth_client)
    with auth_middleware.SessionLocal() as db:
        grant = db.query(EmailVerificationGrant).one()
        if invalidity == "expiry":
            grant.expires_at = utc_now() - timedelta(seconds=1)
        elif invalidity == "purpose":
            grant.purpose = "EMAIL_CHANGE"
        else:
            grant.credential_version -= 1
        db.commit()
    assert auth_client.post("/api/auth/email-verification/confirm", json={"token": token(mail)}).status_code == 422
    assert login(auth_client).status_code == 401


def test_mail_failure_retains_pending_account_and_can_retry(auth_client, mail, monkeypatch):
    configure(auth_client, approval=False)
    def fail(*args):
        raise OSError("synthetic SMTP failure")
    monkeypatch.setattr(auth_routes, "send_email_verification", fail)
    state = register(auth_client)
    assert state["verification_delivery"] == "failed"
    assert login(auth_client).status_code == 401
    monkeypatch.setattr(auth_routes, "send_email_verification", lambda settings, recipient, url: mail.append(url))
    assert auth_client.post("/api/auth/email-verification/request", json={"email": EMAIL, "password": PASSWORD}).status_code == 204
    assert auth_client.post("/api/auth/email-verification/confirm", json={"token": token(mail)}).status_code == 200
    assert login(auth_client).status_code == 200


def test_resend_rate_limit_and_origin(auth_client, mail):
    configure(auth_client, approval=False)
    register(auth_client)
    assert auth_client.post("/api/auth/email-verification/request", json={"email": EMAIL, "password": PASSWORD}, headers={"Origin": "https://foreign.example.test"}).status_code == 403
    for _ in range(5):
        assert auth_client.post("/api/auth/email-verification/request", json={"email": EMAIL, "password": "incorrect"}).status_code == 401
    result = auth_client.post("/api/auth/email-verification/request", json={"email": EMAIL, "password": PASSWORD})
    assert result.status_code == 429
    assert int(result.headers["retry-after"]) > 0


def test_builtin_preferences_are_private_and_change_actual_scan_selection(auth_client):
    first_user, first_token = _normal_user_session(auth_client)
    _, second_token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", first_token)
    rule = next(row for row in auth_client.get("/api/content-cleanup/rules").json() if row["kind"] == "BUILTIN")
    path = f"/api/content-cleanup/rules/{rule['id']}"
    assert auth_client.patch(path, json={"status": "DISABLED"}).status_code == 200
    assert auth_client.patch(path, json={"name": "global rename"}).status_code == 403
    with auth_middleware.SessionLocal() as db:
        assert db.get(ContentCleanupRule, uuid.UUID(rule["id"])).status == "ACTIVE"
        assert all(str(rev.rule_id) != rule["id"] for rev in active_revisions(db, OwnershipScope(first_user)))
    assert next(row for row in auth_client.get("/api/content-cleanup/rules").json() if row["id"] == rule["id"])["status"] == "DISABLED"
    auth_client.cookies.clear()
    auth_client.cookies.set("chat_reader_session", second_token)
    assert next(row for row in auth_client.get("/api/content-cleanup/rules").json() if row["id"] == rule["id"])["status"] == "ACTIVE"
    owner_login(auth_client)
    assert next(row for row in auth_client.get("/api/content-cleanup/rules").json() if row["id"] == rule["id"])["status"] == "ACTIVE"


def test_capabilities_are_private_and_effective(auth_client, monkeypatch):
    assert auth_client.get("/api/auth/capabilities").status_code == 401
    _, user_token = _normal_user_session(auth_client)
    owner_login(auth_client)
    assert auth_client.put("/api/admin/features", json={"maximum_import_size_mb": 2, "maximum_merge_message_count": 17, "allow_user_import": False}).status_code == 200
    auth_client.cookies.clear()
    auth_client.cookies.set("chat_reader_session", user_token)
    result = auth_client.get("/api/auth/capabilities")
    assert result.status_code == 200
    assert result.json()["maximum_import_size_mb"] == 2
    assert result.json()["maximum_merge_message_count"] == 17
    assert result.json()["allow_user_import"] is False
    assert result.json()["role"] == "USER"
    assert auth_client.get("/api/admin/features").status_code == 404
