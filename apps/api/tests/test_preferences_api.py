from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _restore_default_preferences() -> None:
    response = client.patch(
        "/api/preferences",
        json={
            "theme_mode": "light",
            "locale_mode": "auto",
            "reader_width_mode": "standard",
            "reader_density_mode": "comfortable",
            "reader_font_size_px": 17,
            "conversation_sort_mode": "recent_read",
            "conversation_sort_direction": "desc",
            "project_sort_mode": "recent_read",
            "project_sort_direction": "desc",
        },
    )
    assert response.status_code == 200


def test_preferences_defaults_and_updates() -> None:
    _restore_default_preferences()
    initial = client.get("/api/preferences")
    assert initial.status_code == 200
    assert initial.json()["theme_mode"] in {"light", "dark", "system"}
    assert initial.json()["locale_mode"] in {"auto", "zh-CN", "en-US"}
    assert initial.json()["reader_width_mode"] in {"compact", "standard", "wide"}
    assert initial.json()["reader_density_mode"] in {"compact", "comfortable", "large"}
    assert initial.json()["reader_font_size_px"] == 17
    assert initial.json()["conversation_sort_mode"] == "recent_read"
    assert initial.json()["conversation_sort_direction"] == "desc"
    assert initial.json()["project_sort_mode"] == "recent_read"
    assert initial.json()["project_sort_direction"] == "desc"
    assert "subject_key" not in initial.json()

    updated = client.patch(
        "/api/preferences",
        json={
            "theme_mode": "dark",
            "locale_mode": "zh-CN",
            "reader_width_mode": "wide",
            "reader_density_mode": "large",
            "reader_font_size_px": 21,
            "conversation_sort_mode": "title",
            "conversation_sort_direction": "asc",
            "project_sort_mode": "conversation_count",
            "project_sort_direction": "desc",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["theme_mode"] == "dark"
    assert updated.json()["locale_mode"] == "zh-CN"
    assert updated.json()["reader_width_mode"] == "wide"
    assert updated.json()["reader_density_mode"] == "large"
    assert updated.json()["reader_font_size_px"] == 21
    assert updated.json()["conversation_sort_mode"] == "title"
    assert updated.json()["conversation_sort_direction"] == "asc"
    assert updated.json()["project_sort_mode"] == "conversation_count"

    _restore_default_preferences()


def test_preferences_reject_invalid_values() -> None:
    response = client.patch("/api/preferences", json={"theme_mode": "midnight"})
    assert response.status_code == 422

    width_response = client.patch("/api/preferences", json={"reader_width_mode": "maximum"})
    assert width_response.status_code == 422
    assert client.patch("/api/preferences", json={"reader_density_mode": "tiny"}).status_code == 422
    assert client.patch("/api/preferences", json={"reader_font_size_px": 14}).status_code == 422
    assert client.patch("/api/preferences", json={"reader_font_size_px": 23}).status_code == 422
    assert client.patch("/api/preferences", json={"conversation_sort_mode": "random"}).status_code == 422
