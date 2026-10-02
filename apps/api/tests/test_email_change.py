from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest

from app.api.routes import auth as routes
from app.core import auth_middleware
from app.core.config import get_settings
from app.models.access import EmailVerificationGrant, PasswordResetGrant
from app.models.auth import AuthSession
from app.models.user import User
from app.services.access import create_password_reset_grant
from app.services.auth import register_user, issue_session, utc_now
from test_auth import auth_client, owner_login  # noqa: F401

PASSWORD = "synthetic email change passphrase"
OLD = "email-old@example.test"
NEW = "email-new@example.test"


@pytest.fixture
def email_account(auth_client, monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_FROM_ADDRESS", "noreply@example.test")
    get_settings.cache_clear()
    mail = []
    monkeypatch.setattr(routes, "send_email_change", lambda settings, recipient, url: mail.append((recipient, url)))
    with auth_middleware.SessionLocal() as db:
        user, principal = register_user(db, OLD, PASSWORD)
        current, current_session = issue_session(db, principal, get_settings())
        other, _ = issue_session(db, principal, get_settings())
        uid, sid = user.id, current_session.id
        _, reset = create_password_reset_grant(db, get_settings(), uid, actor_user_id=None)
        db.commit()
        reset_id = reset.id
    auth_client.cookies.set("chat_reader_session", current)
    yield auth_client, mail, uid, sid, other, reset_id
    get_settings.cache_clear()


def request(client, email=NEW, password=PASSWORD):
    return client.post("/api/auth/email-change/request", json={"new_email": email, "current_password": password})


def token(mail):
    url = urlsplit(mail[-1][1])
    assert not url.query
    fields = parse_qs(url.fragment)
    assert fields["purpose"] == ["email-change"]
    return fields["token"][0]


def test_email_change_preserves_identity_and_current_session_only(email_account):
    client, mail, uid, sid, other, reset_id = email_account
    created = client.post("/api/conversations", json={"title": "Synthetic retained content", "messages": [{"role": "user", "content_markdown": "Synthetic question"}, {"role": "assistant", "content_markdown": "Synthetic answer"}]})
    assert created.status_code == 201
    conversation_id = created.json()["conversation"]["id"]
    assert request(client, " EMAIL-New@Example.Test ").status_code == 200
    assert client.get("/api/auth/me").json()["email"] == OLD
    assert client.get("/api/auth/email-change").json()["pending"]["target_email"] == NEW
    grant_token = token(mail)
    assert client.post("/api/auth/email-change/preview", json={"token": grant_token}).json()["target_email"] == NEW
    assert client.get("/api/auth/email-change/confirm").status_code == 405
    with auth_middleware.SessionLocal() as db:
        grant = db.query(EmailVerificationGrant).one()
        assert grant.used_at is None and grant.token_digest != grant_token
        assert (grant.expires_at - grant.created_at).total_seconds() == 1800
    response = client.post("/api/auth/email-change/confirm", json={"token": grant_token})
    assert response.status_code == 200
    assert response.json()["user_id"] == str(uid)
    assert response.json()["email"] == NEW
    assert client.get("/api/auth/me").json()["email"] == NEW
    assert client.get(f"/api/conversations/{conversation_id}").status_code == 200
    assert client.get("/api/auth/email-change").json()["pending"] is None
    assert client.post("/api/auth/email-change/confirm", json={"token": grant_token}).status_code == 422
    with auth_middleware.SessionLocal() as db:
        assert db.get(User, uid).email_verified_at is not None
        assert db.get(AuthSession, sid).revoked_at is None
        assert db.get(AuthSession, sid).credential_version == db.get(User, uid).credential_version
        assert db.get(PasswordResetGrant, reset_id).revoked_at is not None
        assert db.query(AuthSession).filter(AuthSession.revoked_at.is_(None)).count() == 1
    client.cookies.clear(); client.cookies.set("chat_reader_session", other)
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": OLD, "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/login", json={"email": NEW, "password": PASSWORD}).status_code == 200


def test_reissue_cancel_and_delivery_failure_keep_old_address(email_account, monkeypatch):
    client, mail, *_ = email_account
    assert request(client).status_code == 200
    old_token = token(mail)
    def fail(*args):
        raise OSError("synthetic mail failure")
    monkeypatch.setattr(routes, "send_email_change", fail)
    assert request(client).status_code == 503
    assert client.get("/api/auth/me").json()["email"] == OLD
    assert client.post("/api/auth/email-change/confirm", json={"token": old_token}).status_code == 422
    monkeypatch.setattr(routes, "send_email_change", lambda settings, recipient, url: mail.append((recipient, url)))
    assert request(client).status_code == 200
    fresh = token(mail)
    assert client.post("/api/auth/email-change/cancel").status_code == 204
    assert client.get("/api/auth/email-change").json()["pending"] is None
    assert client.post("/api/auth/email-change/confirm", json={"token": fresh}).status_code == 422
    assert client.get("/api/auth/me").json()["email"] == OLD


@pytest.mark.parametrize("invalidity", ["expiry", "purpose", "credentials"])
def test_invalid_grants_do_not_change_email(email_account, invalidity):
    client, mail, *_ = email_account
    assert request(client).status_code == 200
    with auth_middleware.SessionLocal() as db:
        grant = db.query(EmailVerificationGrant).one()
        if invalidity == "expiry": grant.expires_at = utc_now() - timedelta(seconds=1)
        elif invalidity == "purpose": grant.purpose = "REGISTER"
        else: grant.credential_version -= 1
        db.commit()
    assert client.post("/api/auth/email-change/confirm", json={"token": token(mail)}).status_code == 422
    assert client.get("/api/auth/me").json()["email"] == OLD


def test_authentication_origin_root_and_wrong_account(email_account):
    client, mail, *_ = email_account
    assert request(client, password="incorrect").status_code == 422
    assert not mail
    assert client.post("/api/auth/email-change/request", json={"new_email": NEW, "current_password": PASSWORD}, headers={"Origin": "https://foreign.example.test"}).status_code == 403
    assert request(client).status_code == 200
    grant_token = token(mail)
    assert client.post("/api/auth/email-verification/confirm", json={"token": grant_token}).status_code == 422
    with auth_middleware.SessionLocal() as db:
        _, principal = register_user(db, "email-other@example.test", PASSWORD)
        other, _ = issue_session(db, principal, get_settings())
    client.cookies.clear(); client.cookies.set("chat_reader_session", other)
    assert client.post("/api/auth/email-change/preview", json={"token": grant_token}).status_code == 422
    assert client.post("/api/auth/email-change/confirm", json={"token": grant_token}).status_code == 422
    assert client.get("/api/auth/email-change").json()["pending"] is None
    client.cookies.clear()
    assert client.post("/api/auth/email-change/confirm", json={"token": grant_token}).status_code == 401
    assert owner_login(client).status_code == 200
    assert request(client).status_code == 403
    assert client.get("/api/auth/email-change").status_code == 403


def test_uniqueness_rechecked_when_confirming(email_account):
    client, mail, *_ = email_account
    assert request(client, OLD).status_code == 422
    assert request(client, "invalid").status_code == 422
    assert request(client, "admin@example.test").status_code == 409
    assert request(client).status_code == 200
    with auth_middleware.SessionLocal() as db:
        register_user(db, NEW, PASSWORD); db.commit()
    assert client.post("/api/auth/email-change/confirm", json={"token": token(mail)}).status_code == 409
    assert client.get("/api/auth/me").json()["email"] == OLD
    with auth_middleware.SessionLocal() as db:
        assert db.query(EmailVerificationGrant).one().used_at is None


def test_password_change_invalidates_pending_email_grant(email_account):
    client, mail, *_ = email_account
    assert request(client).status_code == 200
    changed = "synthetic changed passphrase"
    assert client.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": changed, "confirm_password": changed}).status_code == 204
    assert client.post("/api/auth/login", json={"email": OLD, "password": changed}).status_code == 200
    assert client.post("/api/auth/email-change/confirm", json={"token": token(mail)}).status_code == 422


@pytest.mark.parametrize("status", ["DISABLED", "PENDING"])
def test_disabled_or_unapproved_account_cannot_confirm(email_account, status):
    client, mail, uid, *_ = email_account
    assert request(client).status_code == 200
    grant_token = token(mail)
    with auth_middleware.SessionLocal() as db:
        db.get(User, uid).status = status
        db.commit()
    assert client.post("/api/auth/email-change/confirm", json={"token": grant_token}).status_code == 401
    with auth_middleware.SessionLocal() as db:
        assert db.get(User, uid).normalized_email == OLD
        assert db.query(EmailVerificationGrant).one().used_at is None


def test_smtp_configuration_and_request_rate_limit(email_account, monkeypatch):
    client, _, *_ = email_account
    monkeypatch.setenv("SMTP_HOST", ""); get_settings.cache_clear()
    assert client.get("/api/auth/email-change").json()["email_delivery_available"] is False
    assert request(client).status_code == 503
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test"); get_settings.cache_clear()
    for _ in range(5): assert request(client, password="wrong").status_code == 422
    response = request(client)
    assert response.status_code == 429 and int(response.headers["retry-after"]) > 0
