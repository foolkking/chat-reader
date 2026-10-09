from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_projects_api import _commit_conversation


def test_recent_item_create_increment_and_sort(client: TestClient) -> None:
    first_id = _commit_conversation(client, "Recent First")
    second_id = _commit_conversation(client, "Recent Second")
    second_message_id = client.get(f"/api/conversations/{second_id}/messages").json()[0]["id"]

    first_recent = client.post(f"/api/conversations/{first_id}/recent", json={})
    assert first_recent.status_code == 200
    assert first_recent.json()["open_count"] == 1

    second_recent = client.post(
        f"/api/conversations/{second_id}/recent",
        json={"last_message_id": second_message_id, "context": {"source": "reader"}},
    )
    assert second_recent.status_code == 200
    assert second_recent.json()["last_message_id"] == second_message_id

    second_recent_again = client.post(f"/api/conversations/{second_id}/recent", json={})
    assert second_recent_again.status_code == 200
    assert second_recent_again.json()["id"] == second_recent.json()["id"]
    assert second_recent_again.json()["open_count"] == 2

    recent_items = client.get("/api/recent-items")
    assert recent_items.status_code == 200
    assert recent_items.json()[0]["conversation_id"] == second_id
    assert any(item["conversation_id"] == first_id for item in recent_items.json())


def test_reading_position_updates_recent_progress_without_reopening(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Recent Progress")
    message_id = client.get(f"/api/conversations/{conversation_id}/messages").json()[0]["id"]

    saved = client.put(
        f"/api/conversations/{conversation_id}/reading-position",
        json={
            "message_id": message_id,
            "block_index": 0,
            "scroll_offset": 0,
            "anchor_data": {"progress": 42.5},
        },
    )
    assert saved.status_code == 200

    recent = client.get("/api/recent-items").json()[0]
    assert recent["conversation_id"] == conversation_id
    assert recent["context"]["progress"] == 42.5
    assert recent["context"]["block_index"] == 0
    assert recent["open_count"] == 1

    conversation = client.get(f"/api/conversations/{conversation_id}").json()
    assert conversation["reading_progress"] == 42.5


def test_recent_open_preserves_canonical_revision_content_and_existing_read_context(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic recent canonical contract")
    path = f"/api/conversations/{conversation_id}"
    before = client.get(path).json()
    window_response = client.get(f"{path}/message-window")
    assert window_response.status_code == 200
    window = window_response.json()
    anchor = window["items"][0]["id"]
    first = client.post(f"{path}/recent", json={
        "last_message_id": anchor, "context": {"progress": 68, "source": "synthetic-reader"},
    })
    assert first.status_code == 200
    second = client.post(f"{path}/recent", json={})
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["open_count"] == first.json()["open_count"] + 1
    assert second.json()["last_message_id"] == anchor
    assert second.json()["context"] == first.json()["context"]
    after = client.get(path).json()
    for field in ("offline_revision", "title", "display_title", "description_markdown", "project_id", "parser_version", "render_version", "content_hash"):
        assert after[field] == before[field]
    assert after["reading_progress"] == 68
    assert client.get(f"{path}/message-window").json() == window
    assert client.get(f"{path}/reading-position").json()["position"] is None


def test_reading_progress_has_its_own_time_without_advancing_content_revision(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    conversation_id = _commit_conversation(client, "Synthetic recent time ordering")
    path = f"/api/conversations/{conversation_id}"
    anchor = client.get(f"{path}/message-window").json()["items"][0]["id"]
    opened = client.post(f"{path}/recent", json={})
    assert opened.status_code == 200
    original = opened.json()
    observation_time = datetime.fromisoformat(original["last_opened_at"]).replace(tzinfo=timezone.utc)
    previous = original["conversation"]
    for progress in (80, 20):
        observation_time += timedelta(seconds=1)
        monkeypatch.setattr("app.services.reading.reading_service.utc_now", lambda: observation_time)
        saved = client.put(f"{path}/reading-position", json={
            "message_id": anchor, "block_index": 0, "scroll_offset": 0, "anchor_data": {"progress": progress},
        })
        assert saved.status_code == 200
        current = client.get(path).json()
        assert current["offline_revision"] == previous["offline_revision"]
        assert current["reading_progress"] == progress
        assert datetime.fromisoformat(current["last_read_at"]).replace(tzinfo=timezone.utc) > datetime.fromisoformat(previous["last_read_at"]).replace(tzinfo=timezone.utc)
        assert client.get("/api/recent-items").json()[0]["open_count"] == original["open_count"]
        previous = current


def test_recent_summary_is_not_a_full_detail_or_a_receipt_for_later_metadata(client: TestClient) -> None:
    conversation_id = _commit_conversation(client, "Synthetic recent summary boundary")
    path = f"/api/conversations/{conversation_id}"
    response = client.post(f"{path}/recent", json={})
    assert response.status_code == 200
    old_summary = response.json()["conversation"]
    assert "render_version" not in old_summary and "content_hash" not in old_summary
    updated = client.patch(path, json={"title": "Synthetic newer canonical title", "display_title": "Synthetic newer canonical title"})
    assert updated.status_code == 200
    current = client.get(path).json()
    assert current["offline_revision"] == old_summary["offline_revision"] + 1
    assert current["title"] != old_summary["title"]
    assert "render_version" in current and "content_hash" in current
    latest = client.post(f"{path}/recent", json={})
    assert latest.status_code == 200
    assert latest.json()["conversation"]["offline_revision"] == current["offline_revision"]
    assert "render_version" not in latest.json()["conversation"]
