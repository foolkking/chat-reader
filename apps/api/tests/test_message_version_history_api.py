from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import assistant_message, commit_edit_sample


def test_version_history_returns_desc_and_keeps_imported_version(client: TestClient) -> None:
    message = assistant_message(commit_edit_sample(client))
    original_version = message["current_version"]

    edit = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "Manual edit history phrase", "edit_reason": "History check"},
    )
    assert edit.status_code == 200

    history = client.get(f"/api/messages/{message['id']}/versions")
    assert history.status_code == 200
    payload = history.json()
    assert payload["current_version_id"] == edit.json()["current_version_id"]
    assert [item["version_number"] for item in payload["items"]] == [2, 1]

    current = payload["items"][0]
    imported = payload["items"][1]
    assert current["is_current"] is True
    assert current["edit_type"] == "manual_edit"
    assert current["edit_reason"] == "History check"
    assert current["based_on_version_id"] == original_version["id"]
    assert imported["is_current"] is False
    assert imported["edit_type"] == "imported"
    assert imported["display_text"] == original_version["display_text"]


def test_restore_creates_new_restore_version(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    message = assistant_message(sample)
    original_version = message["current_version"]

    edit = client.patch(f"/api/messages/{message['id']}", json={"display_text": "Temporary edited text"})
    assert edit.status_code == 200

    restore = client.post(
        f"/api/messages/{message['id']}/versions/{original_version['id']}/restore",
        json={"edit_reason": "Restore original"},
    )
    assert restore.status_code == 200
    restored = restore.json()
    assert restored["version_number"] == 3
    assert restored["message"]["current_version"]["edit_type"] == "restore"
    assert restored["message"]["current_version"]["display_text"] == original_version["display_text"]

    history = client.get(f"/api/messages/{message['id']}/versions").json()
    assert [item["version_number"] for item in history["items"]] == [3, 2, 1]
    assert history["items"][0]["based_on_version_id"] == original_version["id"]
    assert history["items"][0]["is_current"] is True

    events = client.get(
        f"/api/conversations/{sample['conversation_id']}/events?event_type=message_version_restored"
    )
    assert events.status_code == 200
    event_payload = events.json()["items"][0]["payload"]
    assert event_payload["restored_from_version_id"] == original_version["id"]
    assert event_payload["new_version_number"] == 3

    restore_current = client.post(
        f"/api/messages/{message['id']}/versions/{restored['current_version_id']}/restore",
        json={},
    )
    assert restore_current.status_code == 400


def test_restore_rejects_version_from_another_message(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    user_message = next(message for message in sample["messages"] if message["role"] == "user")
    assistant = assistant_message(sample)
    foreign_version_id = user_message["current_version"]["id"]

    response = client.post(
        f"/api/messages/{assistant['id']}/versions/{foreign_version_id}/restore",
        json={},
    )
    assert response.status_code == 404
