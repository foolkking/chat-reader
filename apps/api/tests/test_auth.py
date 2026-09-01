from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from pathlib import Path
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core import auth_middleware
from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import app
from app.models.access import AccountInvitation
from app.models.auth import AuthPrincipal, AuthSession
from app.models.user import User
from app.services.auth import authenticate_session, issue_session, provision_owner, verify_login


def owner_login(client: TestClient, password: str = "correct horse battery staple"):
    return client.post("/api/auth/login", json={"email": "admin@example.test", "password": password})


@pytest.fixture()
def auth_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH_SESSION_SECRET", "test-only-session-secret-012345678901234567890")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")
    monkeypatch.setenv("PUBLIC_WEB_BASE_URL", "http://testserver")
    monkeypatch.setenv("AUTH_ACTIVITY_TOUCH_INTERVAL_SECONDS", "600")
    monkeypatch.setenv("AUTH_INACTIVITY_TIMEOUT_SECONDS", "172800")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'auth.db'}")
    get_settings.cache_clear()

    engine = create_engine(f"sqlite:///{tmp_path / 'auth.db'}")
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session, None, None]:
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(auth_middleware, "SessionLocal", factory)
    with factory() as db:
        principal = provision_owner(db, "correct horse battery staple", get_settings())
        user = db.get(User, principal.user_id)
        assert user is not None
        user.normalized_email = "admin@example.test"
        db.commit()

    with TestClient(app) as test_client:
        test_client.headers.update({"Origin": "http://testserver"})
        yield test_client

    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_business_routes_are_protected_but_health_and_login_are_public(auth_client: TestClient) -> None:
    assert auth_client.get("/api/health").status_code == 200
    assert auth_client.get("/api/preferences").status_code == 401
    assert auth_client.get("/api/shared/not-a-token").status_code == 404
    assert auth_client.get("/api/attachments/not-an-id/content").status_code == 401
    assert auth_client.get("/api/offline/packages/not-an-id/download").status_code == 401


def test_owner_session_does_not_unlock_an_independently_protected_share(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    created_conversation = auth_client.post(
        "/api/conversations",
        json={
            "title": "Share auth boundary fixture",
            "messages": [
                {"role": "user", "content_markdown": "safe question"},
                {"role": "assistant", "content_markdown": "safe answer"},
            ],
        },
    )
    assert created_conversation.status_code == 201
    conversation_id = created_conversation.json()["conversation"]["id"]
    created = auth_client.post(
        f"/api/conversations/{conversation_id}/shares",
        json={"share_password": "independent share passphrase"},
    )
    assert created.status_code == 200
    token = created.json()["token"]

    # The owner cookie still grants the private application, but it is not a
    # Share unlock credential and cannot cross the capability boundary.
    assert auth_client.get("/api/preferences").status_code == 200
    assert auth_client.get(f"/api/shared/{token}").status_code == 401
    assert auth_client.post(
        f"/api/shared/{token}/unlock",
        json={"password": "correct horse battery staple"},
    ).status_code == 401
    assert auth_client.post(
        f"/api/shared/{token}/unlock",
        json={"password": "independent share passphrase"},
    ).status_code == 200


def test_owner_and_public_share_api_authorities_do_not_cross(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    created = auth_client.post(
        "/api/conversations",
        json={
            "title": "Authority matrix fixture",
            "messages": [
                {"role": "user", "content_markdown": "authority question"},
                {"role": "assistant", "content_markdown": "authority answer"},
            ],
        },
    )
    assert created.status_code == 201
    conversation_id = created.json()["conversation"]["id"]
    share = auth_client.post(f"/api/conversations/{conversation_id}/shares", json={})
    assert share.status_code == 200
    share_token = share.json()["token"]

    owner_routes = [
        "/api/preferences",
        "/api/skills",
        "/api/tasks/active",
        f"/api/conversations/{conversation_id}/attachments",
    ]
    for route in owner_routes:
        assert auth_client.get(route).status_code == 200

    with TestClient(app) as guest:
        assert guest.get(f"/api/shared/{share_token}").status_code == 200
        for route in owner_routes:
            separator = "&" if "?" in route else "?"
            response = guest.get(f"{route}{separator}share_token={share_token}")
            assert response.status_code == 401
            assert response.headers["Cache-Control"] == "no-store"


def test_login_sets_cookie_without_persisting_raw_token(auth_client: TestClient) -> None:
    failed = owner_login(auth_client, "wrong password")
    assert failed.status_code == 401
    assert failed.json() == {"detail": "Email or password is incorrect."}

    logged_in = owner_login(auth_client)
    assert logged_in.status_code == 200
    cookie = logged_in.cookies.get("chat_reader_session")
    assert cookie
    assert logged_in.cookies.get("chat_reader_session_present") == "1"
    set_cookie = logged_in.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie

    session = auth_client.get("/api/auth/session")
    assert session.json()["authenticated"] is True
    with auth_middleware.SessionLocal() as db:
        row = db.query(AuthSession).one()
        principal = db.get(AuthPrincipal, "owner")
        assert principal is not None
        assert principal.password_hash.startswith("$argon2id$")
        assert "correct horse battery staple" not in principal.password_hash
        assert row.token_digest != cookie
        assert len(row.token_digest) == 64


def test_expiry_boundary_and_sliding_activity_are_deterministic(auth_client: TestClient) -> None:
    logged_in = owner_login(auth_client)
    assert logged_in.status_code == 200
    token = logged_in.cookies.get("chat_reader_session")
    assert token
    settings = get_settings()
    with auth_middleware.SessionLocal() as db:
        row = db.query(AuthSession).one()
        now = datetime(2026, 8, 17, 12, 0, tzinfo=timezone.utc)
        row.last_activity_at = now - timedelta(hours=47, minutes=59, seconds=59)
        db.commit()
        assert authenticate_session(db, token, settings, now=now) is not None
        row.last_activity_at = now - timedelta(hours=48)
        db.commit()
        assert authenticate_session(db, token, settings, now=now) is None


def test_activity_touch_is_rate_limited_and_session_secret_rotation_invalidates_restore(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    now = datetime(2026, 8, 17, 12, 0, tzinfo=timezone.utc)
    settings = get_settings()
    with auth_middleware.SessionLocal() as db:
        principal = verify_login(db, "correct horse battery staple", now=now)
        assert principal is not None
        token, session = issue_session(db, principal, settings, now=now - timedelta(minutes=9))
        first = authenticate_session(db, token, settings, now=now)
        assert first is not None and first.touched is False
        session.last_activity_at = now - timedelta(minutes=10)
        db.commit()
        second = authenticate_session(db, token, settings, now=now)
        assert second is not None and second.touched is True

        monkeypatch.setenv("AUTH_SESSION_SECRET", "different-recovery-secret-012345678901234567890")
        get_settings.cache_clear()
        assert authenticate_session(db, token, get_settings(), now=now) is None
        get_settings.cache_clear()


def test_session_polling_does_not_extend_inactivity_but_business_activity_does(
    auth_client: TestClient,
) -> None:
    logged_in = owner_login(auth_client)
    assert logged_in.status_code == 200
    old_activity = datetime.now(timezone.utc) - timedelta(minutes=11)
    with auth_middleware.SessionLocal() as db:
        row = db.query(AuthSession).one()
        row.last_activity_at = old_activity
        db.commit()

    session = auth_client.get("/api/auth/session")
    assert session.status_code == 200
    assert session.json()["authenticated"] is True
    with auth_middleware.SessionLocal() as db:
        after_poll = db.query(AuthSession).one().last_activity_at
        assert after_poll == old_activity.replace(tzinfo=None)

    business = auth_client.get("/api/preferences")
    assert business.status_code == 200
    with auth_middleware.SessionLocal() as db:
        after_business = db.query(AuthSession).one().last_activity_at
        assert after_business > after_poll


def test_sessions_are_independent_and_password_change_revokes_all(auth_client: TestClient) -> None:
    first = owner_login(auth_client)
    second = TestClient(app)
    second.headers.update({"Origin": "http://testserver"})
    with second:
        second_login = owner_login(second)
        assert second_login.status_code == 200
        assert auth_client.get("/api/preferences").status_code != 401
        assert second.get("/api/preferences").status_code != 401
        changed = auth_client.post(
            "/api/auth/password",
            json={
                "current_password": "correct horse battery staple",
                "new_password": "a newer secure owner passphrase",
                "confirm_password": "a newer secure owner passphrase",
            },
        )
        assert changed.status_code == 204
        assert auth_client.get("/api/preferences").status_code == 401
        assert second.get("/api/preferences").status_code == 401
        assert owner_login(second).status_code == 401
        assert owner_login(second, "a newer secure owner passphrase").status_code == 200


def test_logout_other_devices_keeps_the_current_session(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    second = TestClient(app)
    second.headers.update({"Origin": "http://testserver"})
    with second:
        assert owner_login(second).status_code == 200
        sessions = auth_client.get("/api/auth/sessions")
        assert sessions.status_code == 200
        assert len(sessions.json()) == 2
        assert sum(1 for row in sessions.json() if row["current"]) == 1

        assert auth_client.post("/api/auth/sessions/logout-others").status_code == 204
        assert auth_client.get("/api/preferences").status_code == 200
        assert second.get("/api/preferences").status_code == 401


def test_logout_revokes_cookie_and_cross_origin_mutations_are_denied(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    assert auth_client.post("/api/auth/logout").status_code == 204
    assert auth_client.get("/api/preferences").status_code == 401
    assert auth_client.cookies.get("chat_reader_session_present") is None

    logged_in = owner_login(auth_client)
    assert logged_in.status_code == 200
    cross_origin = auth_client.patch(
        "/api/preferences",
        headers={"Origin": "https://evil.example"},
        json={"theme_mode": "dark"},
    )
    assert cross_origin.status_code == 403
    missing_origin = auth_client.patch(
        "/api/preferences",
        headers={"Origin": ""},
        json={"theme_mode": "dark"},
    )
    assert missing_origin.status_code == 403


def test_login_backoff_is_bounded_and_generic(auth_client: TestClient) -> None:
    for _ in range(3):
        assert owner_login(auth_client, "wrong password").status_code == 401
    throttled = owner_login(auth_client)
    assert throttled.status_code == 429
    assert "Retry-After" in throttled.headers


def test_registration_mode_closed_is_explicit(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/api/auth/register",
        json={
            "email": "reader@example.com",
            "password": "reader secure passphrase",
            "confirm_password": "reader secure passphrase",
        },
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "Registration is not open on this instance."}


def test_open_registration_creates_an_independent_email_session(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTH_REGISTRATION_MODE", "OPEN")
    get_settings.cache_clear()
    registered = auth_client.post(
        "/api/auth/register",
        json={
            "email": "Reader@Example.COM",
            "password": "reader secure passphrase",
            "confirm_password": "reader secure passphrase",
            "display_name": "Reader",
        },
    )
    assert registered.status_code == 201
    assert registered.json()["email"] == "reader@example.com"
    assert registered.json()["role"] == "USER"
    assert registered.json()["auth_mode"] == "multi_account"
    assert auth_client.get("/api/auth/me").json()["display_name"] == "Reader"

    assert auth_client.post("/api/auth/logout").status_code == 204
    wrong = auth_client.post(
        "/api/auth/login",
        json={"email": "reader@example.com", "password": "wrong passphrase"},
    )
    assert wrong.status_code == 401
    assert wrong.json() == {"detail": "Email or password is incorrect."}
    logged_in = auth_client.post(
        "/api/auth/login",
        json={"email": "READER@example.com", "password": "reader secure passphrase"},
    )
    assert logged_in.status_code == 200
    assert logged_in.json()["email"] == "reader@example.com"
    get_settings.cache_clear()


def test_legacy_owner_upgrade_binds_email_and_invalidates_sessions(auth_client: TestClient) -> None:
    with auth_middleware.SessionLocal() as db:
        principal = db.get(AuthPrincipal, "owner")
        assert principal is not None and principal.user_id is not None
        user = db.get(User, principal.user_id)
        assert user is not None
        user.normalized_email = None
        db.commit()

    status = auth_client.get("/api/auth/setup/status")
    assert status.json() == {"setup_required": True, "registration_mode": "CLOSED"}
    blocked_login = auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"})
    assert blocked_login.status_code == 409
    wrong = auth_client.post(
        "/api/auth/setup/upgrade",
        json={"current_password": "wrong password", "email": "owner@example.test"},
    )
    assert wrong.status_code == 401
    upgraded = auth_client.post(
        "/api/auth/setup/upgrade",
        json={
            "current_password": "correct horse battery staple",
            "email": "Owner@Example.TEST",
            "display_name": "Archive owner",
        },
    )
    assert upgraded.status_code == 204
    assert auth_client.get("/api/auth/setup/status").json()["setup_required"] is False
    logged_in = auth_client.post(
        "/api/auth/login",
        json={"email": "owner@example.test", "password": "correct horse battery staple"},
    )
    assert logged_in.status_code == 200
    assert logged_in.json()["role"] == "ADMIN"


def test_admin_invitation_user_disable_and_password_reset_contract(auth_client: TestClient) -> None:
    assert auth_client.post(
        "/api/auth/login",
        json={"email": "admin@example.test", "password": "correct horse battery staple"},
    ).status_code == 200
    mode = auth_client.put("/api/admin/access/registration", json={"mode": "INVITE_ONLY"})
    assert mode.status_code == 200
    invitation = auth_client.post("/api/admin/access/invitations", json={"expires_in_hours": 24})
    assert invitation.status_code == 201
    token = invitation.json()["token"]
    assert token not in str(auth_client.get("/api/admin/access/invitations").json())

    assert auth_client.post("/api/auth/logout").status_code == 204
    registered = auth_client.post(
        "/api/auth/register",
        json={
            "email": "invited@example.test",
            "password": "invited secure passphrase",
            "confirm_password": "invited secure passphrase",
            "invitation_token": token,
        },
    )
    assert registered.status_code == 201
    invited_user_id = registered.json()["user_id"]
    assert auth_client.post("/api/auth/logout").status_code == 204
    reused = auth_client.post(
        "/api/auth/register",
        json={
            "email": "second@example.test",
            "password": "second secure passphrase",
            "confirm_password": "second secure passphrase",
            "invitation_token": token,
        },
    )
    assert reused.status_code == 403

    assert auth_client.post(
        "/api/auth/login",
        json={"email": "admin@example.test", "password": "correct horse battery staple"},
    ).status_code == 200
    reset = auth_client.post(
        f"/api/admin/access/users/{invited_user_id}/password-reset",
        json={"expires_in_minutes": 30},
    )
    assert reset.status_code == 201
    reset_token = reset.json()["reset_url"].split("token=", 1)[1]
    assert auth_client.post("/api/auth/logout").status_code == 204
    changed = auth_client.post(
        "/api/auth/password-reset",
        json={
            "token": reset_token,
            "new_password": "replacement secure passphrase",
            "confirm_password": "replacement secure passphrase",
        },
    )
    assert changed.status_code == 204
    assert auth_client.post(
        "/api/auth/login",
        json={"email": "invited@example.test", "password": "replacement secure passphrase"},
    ).status_code == 200
    assert auth_client.post("/api/auth/logout").status_code == 204

    assert auth_client.post(
        "/api/auth/login",
        json={"email": "admin@example.test", "password": "correct horse battery staple"},
    ).status_code == 200
    disabled = auth_client.patch(
        f"/api/admin/access/users/{invited_user_id}/status",
        json={"status": "DISABLED"},
    )
    assert disabled.status_code == 200
    assert auth_client.post("/api/auth/logout").status_code == 204
    assert auth_client.post(
        "/api/auth/login",
        json={"email": "invited@example.test", "password": "replacement secure passphrase"},
    ).status_code == 401


def test_expired_and_revoked_invitations_cannot_register(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put("/api/admin/access/registration", json={"mode": "INVITE_ONLY"}).status_code == 200

    expired = auth_client.post("/api/admin/access/invitations", json={"expires_in_hours": 1})
    assert expired.status_code == 201
    expired_token = expired.json()["token"]
    with auth_middleware.SessionLocal() as db:
        row = db.get(AccountInvitation, uuid.UUID(expired.json()["id"]))
        assert row is not None
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

    revoked = auth_client.post("/api/admin/access/invitations", json={"expires_in_hours": 1})
    assert revoked.status_code == 201
    revoked_token = revoked.json()["token"]
    assert auth_client.delete(f"/api/admin/access/invitations/{revoked.json()['id']}").status_code == 204
    assert auth_client.post("/api/auth/logout").status_code == 204

    for index, token in enumerate((expired_token, revoked_token), start=1):
        response = auth_client.post(
            "/api/auth/register",
            json={
                "email": f"blocked-{index}@example.test",
                "password": "blocked secure passphrase",
                "confirm_password": "blocked secure passphrase",
                "invitation_token": token,
            },
        )
        assert response.status_code == 403
