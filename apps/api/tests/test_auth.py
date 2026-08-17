from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core import auth_middleware
from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import app
from app.models.auth import AuthPrincipal, AuthSession
from app.services.auth import authenticate_session, issue_session, provision_owner, verify_login


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
        provision_owner(db, "correct horse battery staple", get_settings())

    with TestClient(app) as test_client:
        test_client.headers.update({"Origin": "http://testserver"})
        yield test_client

    app.dependency_overrides.clear()
    get_settings.cache_clear()


def test_business_routes_are_protected_but_health_and_login_are_public(auth_client: TestClient) -> None:
    assert auth_client.get("/api/health").status_code == 200
    assert auth_client.get("/api/preferences").status_code == 401
    assert auth_client.get("/api/shared/not-a-token").status_code == 401
    assert auth_client.get("/api/attachments/not-an-id/content").status_code == 401
    assert auth_client.get("/api/offline/packages/not-an-id/download").status_code == 401


def test_login_sets_cookie_without_persisting_raw_token(auth_client: TestClient) -> None:
    failed = auth_client.post("/api/auth/login", json={"password": "wrong password"})
    assert failed.status_code == 401
    assert failed.json() == {"detail": "Incorrect password."}

    logged_in = auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"})
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
    logged_in = auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"})
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
    logged_in = auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"})
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
    first = auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"})
    second = TestClient(app)
    second.headers.update({"Origin": "http://testserver"})
    with second:
        second_login = second.post("/api/auth/login", json={"password": "correct horse battery staple"})
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
        assert second.post("/api/auth/login", json={"password": "correct horse battery staple"}).status_code == 401
        assert second.post("/api/auth/login", json={"password": "a newer secure owner passphrase"}).status_code == 200


def test_logout_revokes_cookie_and_cross_origin_mutations_are_denied(auth_client: TestClient) -> None:
    assert auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"}).status_code == 200
    assert auth_client.post("/api/auth/logout").status_code == 204
    assert auth_client.get("/api/preferences").status_code == 401
    assert auth_client.cookies.get("chat_reader_session_present") is None

    logged_in = auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"})
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
        assert auth_client.post("/api/auth/login", json={"password": "wrong password"}).status_code == 401
    throttled = auth_client.post("/api/auth/login", json={"password": "correct horse battery staple"})
    assert throttled.status_code == 429
    assert "Retry-After" in throttled.headers
