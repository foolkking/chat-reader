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
