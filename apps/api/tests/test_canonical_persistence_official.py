import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_official_samples import official_single_conversation


def test_official_single_persists_primary_path_only(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={"files": ("conversation.json", json.dumps(official_single_conversation()).encode(), "application/json")},
    )
    import_id = preview.json()["import_id"]
    commit = client.post(f"/api/imports/{import_id}/commit")

    assert commit.status_code == 200
    assert commit.json()["conversation_count"] == 1
    conversation_id = commit.json()["conversation_ids"][0]
    messages = client.get(f"/api/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    payload = messages.json()
    assert len(payload) == 2
    assert [message["role"] for message in payload] == ["user", "assistant"]

    assistant_detail = client.get(f"/api/messages/{payload[1]['id']}")
    ref = assistant_detail.json()["source_refs"][0]
    assert ref["source_node_id"] == "assistant-1"
    assert ref["source_message_id"] == "message-assistant-1"
    assert ref["is_primary_path"] is True
    assert "assistant-alt" not in [message["current_version"]["plain_text"] for message in payload]


def test_official_list_persists_multiple_conversations(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "conversations.json",
                json.dumps([official_single_conversation(), official_single_conversation()]).encode(),
                "application/json",
            )
        },
    )
    import_id = preview.json()["import_id"]
    commit = client.post(f"/api/imports/{import_id}/commit")

    assert commit.status_code == 200
    assert commit.json()["conversation_count"] == 2
    assert commit.json()["message_count"] == 4
