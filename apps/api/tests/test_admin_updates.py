from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core import auth_middleware
from app.core.config import get_settings
from app.models.administration import AdminAuditLog
from app.models.auth import AuthSession
from app.services.auth import (
    SESSION_COOKIE_NAME,
    SESSION_PRESENCE_COOKIE_NAME,
    issue_session,
    register_user,
    token_digest,
)
from test_auth import auth_client, owner_login  # noqa: F401


def _root(client: TestClient) -> None:
    assert owner_login(client).status_code == 200


def test_update_api_requires_root_identity(auth_client: TestClient) -> None:
    assert auth_client.get("/api/admin/updates").status_code == 401

    with auth_middleware.SessionLocal() as db:
        user, principal = register_user(
            db,
            "update-normal-user@example.test",
            "normal update user passphrase",
            display_name="Normal update user",
        )
        token, _ = issue_session(db, principal, get_settings(), device_label="update-test")
        assert user.role != "ADMIN"

    auth_client.cookies.set(SESSION_COOKIE_NAME, token)
    auth_client.cookies.set(SESSION_PRESENCE_COOKIE_NAME, "1")
    assert auth_client.get("/api/admin/updates").status_code == 404
    assert auth_client.post("/api/admin/updates/check", json={}).status_code == 404


@pytest.mark.parametrize("origin", ["", "https://attacker.example"])
def test_update_check_rejects_missing_or_foreign_origin(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    origin: str,
) -> None:
    _root(auth_client)
    called = False

    def unexpected_call(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("cross-origin request reached updater")

    monkeypatch.setattr("app.api.routes.admin_updates._call", unexpected_call)
    response = auth_client.post(
        "/api/admin/updates/check",
        json={},
        headers={"Origin": origin},
    )
    assert response.status_code == 403
    assert not called


def test_update_check_uses_only_fixed_check_operation(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root(auth_client)
    calls: list[tuple[str, object]] = []

    def fake_call(action, body=None):
        calls.append((action, body))
        return {"current": "v0.12.0", "target": "v0.12.1"}

    monkeypatch.setattr("app.api.routes.admin_updates._call", fake_call)
    response = auth_client.post("/api/admin/updates/check", json={})

    assert response.status_code == 200
    assert response.json()["target"] == "v0.12.1"
    assert calls == [("check", {})]


def test_update_intent_rejects_extra_fields_before_host_call(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root(auth_client)
    calls: list[object] = []
    monkeypatch.setattr(
        "app.api.routes.admin_updates._call",
        lambda *args, **kwargs: calls.append(args) or {"accepted": True},
    )

    response = auth_client.post(
        "/api/admin/updates/prepare",
        json={
            "id": "a" * 32,
            "expected": "b" * 40,
            "target": "c" * 64,
            "command": "arbitrary command",
        },
    )
    assert response.status_code == 422
    assert calls == []


def test_update_intent_requires_recent_root_login(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root(auth_client)
    raw_token = auth_client.cookies.get(SESSION_COOKIE_NAME)
    assert raw_token
    with auth_middleware.SessionLocal() as db:
        session = (
            db.query(AuthSession)
            .filter_by(token_digest=token_digest(raw_token, get_settings()))
            .one()
        )
        session.created_at = datetime.now(timezone.utc) - timedelta(minutes=11)
        db.commit()

    calls: list[object] = []
    monkeypatch.setattr(
        "app.api.routes.admin_updates._call",
        lambda *args, **kwargs: calls.append(args) or {"accepted": True},
    )
    response = auth_client.post(
        "/api/admin/updates/prepare",
        json={"id": "d" * 32, "expected": "e" * 40, "target": "f" * 64},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "FRESH_LOGIN_REQUIRED"
    assert calls == []


def test_update_intent_is_audited_before_the_fixed_host_operation(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root(auth_client)
    intent = {"id": "1" * 32, "expected": "2" * 40, "target": "3" * 64}
    calls: list[tuple[str, object]] = []

    def fake_call(action, body=None):
        calls.append((action, body))
        return {"accepted": True}

    monkeypatch.setattr("app.api.routes.admin_updates._call", fake_call)
    response = auth_client.post("/api/admin/updates/prepare", json=intent)

    assert response.status_code == 202
    assert response.json() == {"accepted": True}
    assert calls == [("prepare", intent)]
    with auth_middleware.SessionLocal() as db:
        audit = (
            db.query(AdminAuditLog)
            .filter_by(action="release_prepare_requested", resource_type="release")
            .one()
        )
        assert audit.resource_id == intent["id"]
        assert audit.event_metadata == {}


def test_program_confirmation_forwards_only_one_fixed_preparation_id(
    auth_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root(auth_client)
    calls = []
    monkeypatch.setattr("app.api.routes.admin_updates._call",
                        lambda op, body: calls.append((op, body)) or {"accepted": True})
    intent = {"id": "1" * 32, "expected": "2" * 64, "target": "3" * 64}
    for invalid in ("not-a-preparation", "a" * 33):
        assert auth_client.post("/api/admin/updates/apply", json={**intent, "preparation": invalid}).status_code == 422
    assert not calls
    body = {**intent, "preparation": "4" * 32}
    assert auth_client.post("/api/admin/updates/apply", json=body).status_code == 202
    assert calls == [("apply", body)]


def test_update_monitor_ticket_is_short_lived_cookie_not_response_data(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _root(auth_client)
    secret_ticket = "a" * 64
    calls: list[tuple[str, object]] = []

    def fake_call(action, body=None):
        calls.append((action, body))
        return {"ticket": secret_ticket}

    monkeypatch.setattr("app.api.routes.admin_updates._call", fake_call)
    response = auth_client.post(
        "/api/admin/updates/ticket",
        json={"id": "b" * 32},
    )

    assert response.status_code == 200
    assert response.json() == {"ready": True}
    assert secret_ticket not in response.text
    assert calls == [("ticket", {"id": "b" * 32})]
    cookie = next(value for value in response.headers.get_list("set-cookie") if value.startswith("cr_update_monitor="))
    assert "Path=/__updates/" in cookie
    assert "Max-Age=5400" in cookie
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=strict" in cookie
    assert response.headers["cache-control"] == "no-store"


def test_missing_host_updater_is_reported_without_leaking_socket_details(
    auth_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    _root(auth_client)
    monkeypatch.setattr(
        "app.api.routes.admin_updates.SOCKET",
        str(tmp_path / "missing-control.sock"),
    )

    response = auth_client.get("/api/admin/updates")
    assert response.status_code == 503
    assert response.json() == {"detail": "UPDATER_UNAVAILABLE"}
    assert "missing-control.sock" not in response.text
