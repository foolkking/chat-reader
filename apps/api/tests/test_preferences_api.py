from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_preferences_defaults_and_updates() -> None:
    initial = client.get("/api/preferences")
    assert initial.status_code == 200
    assert initial.json()["theme_mode"] in {"light", "dark", "system"}
    assert initial.json()["locale_mode"] in {"auto", "zh-CN", "en-US"}
    assert initial.json()["reader_width_mode"] in {"compact", "standard", "wide"}
    assert "subject_key" not in initial.json()

    updated = client.patch(
        "/api/preferences",
        json={"theme_mode": "dark", "locale_mode": "zh-CN", "reader_width_mode": "wide"},
    )
    assert updated.status_code == 200
    assert updated.json()["theme_mode"] == "dark"
    assert updated.json()["locale_mode"] == "zh-CN"
    assert updated.json()["reader_width_mode"] == "wide"

    client.patch(
        "/api/preferences",
        json={"theme_mode": "light", "locale_mode": "auto", "reader_width_mode": "standard"},
    )


def test_preferences_reject_invalid_values() -> None:
    response = client.patch("/api/preferences", json={"theme_mode": "midnight"})
    assert response.status_code == 422

    width_response = client.patch("/api/preferences", json={"reader_width_mode": "maximum"})
    assert width_response.status_code == 422
