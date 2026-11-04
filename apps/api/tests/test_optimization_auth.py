from datetime import datetime, timedelta, timezone

from app.core import auth_middleware
from app.models.auth import AuthSession
from test_auth import auth_client, owner_login  # noqa: F401


def test_expiry_and_unknown_historical_revocation_are_not_conflated(auth_client):
    owner_login(auth_client)
    with auth_middleware.SessionLocal() as db:
        row = db.query(AuthSession).one()
        row.last_activity_at = datetime.now(timezone.utc) - timedelta(hours=49)
        db.commit()
    result = auth_client.get("/api/auth/session")
    assert result.json()["failure_reason"] == "expired"
    owner_login(auth_client)
    with auth_middleware.SessionLocal() as db:
        row = db.query(AuthSession).filter(AuthSession.revoked_at.is_(None)).one()
        row.revoked_at = datetime.now(timezone.utc)
        row.revocation_reason = None
        db.commit()
    assert auth_client.get("/api/auth/session").json()["failure_reason"] == "revoked"
    assert auth_client.get("/api/auth/session").json()["failure_reason"] == "missing_session"


def test_background_poll_does_not_extend_session_but_user_read_does(auth_client):
    owner_login(auth_client)
    with auth_middleware.SessionLocal() as db:
        before = datetime.now(timezone.utc) - timedelta(minutes=20)
        db.query(AuthSession).one().last_activity_at = before
        db.commit()
    for path in ("/api/tasks/active", "/api/offline/catalog", "/api/auth/session"):
        assert auth_client.get(path).status_code == 200
    with auth_middleware.SessionLocal() as db:
        assert db.query(AuthSession).one().last_activity_at.replace(tzinfo=timezone.utc) == before
    result = auth_client.get("/api/preferences")
    assert result.status_code == 200
    assert result.headers["X-Chat-Reader-User"]
    assert datetime.fromisoformat(result.headers["X-Chat-Reader-Session-Expires"]).replace(tzinfo=timezone.utc) > before + timedelta(hours=48)
