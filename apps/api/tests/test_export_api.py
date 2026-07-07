import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import assistant_message, commit_edit_sample


def test_markdown_export_uses_current_version_and_selected_messages(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    message = assistant_message(sample)
    edit = client.patch(f"/api/messages/{message['id']}", json={"display_text": "Edited export text"})
    assert edit.status_code == 200

    response = client.get(
        f"/api/conversations/{conversation_id}/export?format=markdown&message_ids={message['id']}"
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "attachment" in response.headers["content-disposition"]
    body = response.text
    assert "# Editing Sample" in body
    assert f"## Assistant · {message['order_key']}" in body
    assert "Edited export text" in body
    assert "Original user question" not in body
    assert "raw_storage_uri" not in body
    assert "storage/imports" not in body


def test_canonical_json_export_versions_and_security(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    message = assistant_message(sample)
    client.patch(f"/api/messages/{message['id']}", json={"display_text": "JSON export current"})

    current_only = client.get(f"/api/conversations/{conversation_id}/export?format=canonical_json")
    assert current_only.status_code == 200
    payload = current_only.json()
    assert payload["format"] == "chat-reader-canonical-export"
    assert payload["conversation"]["display_title"] == "Editing Sample"
    assert "versions" not in payload["messages"][1]
    assert "JSON export current" in json.dumps(payload, ensure_ascii=False)
    assert "token_hash" not in json.dumps(payload)
    assert "raw_storage_uri" not in json.dumps(payload)
    assert "storage/imports" not in json.dumps(payload)

    with_versions = client.get(
        f"/api/conversations/{conversation_id}/export?format=canonical_json&include_versions=true"
    )
    assert with_versions.status_code == 200
    versioned = with_versions.json()
    assistant_payload = next(item for item in versioned["messages"] if item["id"] == message["id"])
    assert len(assistant_payload["versions"]) == 2


def test_export_validation_and_event(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]

    invalid_message = client.get(
        f"/api/conversations/{conversation_id}/export?format=markdown&message_ids=00000000-0000-0000-0000-000000000001"
    )
    assert invalid_message.status_code == 400

    exported = client.get(f"/api/conversations/{conversation_id}/export?format=markdown")
    assert exported.status_code == 200
    events = client.get(f"/api/conversations/{conversation_id}/events?event_type=conversation_exported")
    assert events.status_code == 200
    payload = events.json()
    assert payload["total"] == 1
    assert payload["items"][0]["payload"]["format"] == "markdown"
