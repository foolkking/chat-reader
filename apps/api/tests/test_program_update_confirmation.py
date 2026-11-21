"""Additional contract; keep the original nine root-admin update cases frozen."""
import pytest
from fastapi.testclient import TestClient

from test_auth import auth_client, owner_login  # noqa: F401


def test_program_confirmation_forwards_only_one_fixed_preparation_id(
    auth_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert owner_login(auth_client).status_code == 200
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
