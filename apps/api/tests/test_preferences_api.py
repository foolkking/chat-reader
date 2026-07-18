from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_preferences_defaults_and_updates() -> None:
    initial = client.get("/api/preferences")
    assert initial.status_code == 200
    assert initial.json()["theme_mode"] in {"light", "dark", "system"}
    assert initial.json()["locale_mode"] in {"auto", "zh-CN", "en-US"}
    assert "subject_key" not in initial.json()

    updated = client.patch("/api/preferences", json={"theme_mode": "dark", "locale_mode": "zh-CN"})
    assert updated.status_code == 200
    assert updated.json()["theme_mode"] == "dark"
    assert updated.json()["locale_mode"] == "zh-CN"

    client.patch("/api/preferences", json={"theme_mode": "light", "locale_mode": "auto"})


def test_preferences_reject_invalid_values() -> None:
    response = client.patch("/api/preferences", json={"theme_mode": "midnight"})
    assert response.status_code == 422
