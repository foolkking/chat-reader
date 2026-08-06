import gzip
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


def test_canonical_json_export_streams_large_conversation(client: TestClient) -> None:
    messages = [
        {
            "role": "Prompt" if index % 2 == 0 else "Response",
            "say": f"Message {index}: " + ("long content. " * 80 if index in {0, 997} else "content"),
        }
        for index in range(998)
    ]
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "large-export.json",
                json.dumps({"metadata": {"title": "Large export", "powered_by": "ChatGPT Exporter"}, "messages": messages}).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200, commit.text
    conversation_id = commit.json()["conversation_ids"][0]

    response = client.get(f"/api/conversations/{conversation_id}/export?format=canonical_json")

    assert response.status_code == 200
    payload = response.json()
    assert payload["conversation"]["message_count"] == 998
    assert len(payload["messages"]) == 998
    assert payload["messages"][0]["current_version"]["blocks"]
    assert payload["messages"][-1]["current_version"]["blocks"]


def test_canjson_v2_export_is_compact_streaming_jsonl(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    message = assistant_message(sample)
    edit = client.patch(f"/api/messages/{message['id']}", json={"display_text": "CanJSON v2 current body"})
    assert edit.status_code == 200

    response = client.get(
        f"/api/conversations/{conversation_id}/exports/canjson?message_ids={message['id']}&include_versions=true"
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert ".canonical.jsonl" in response.headers["content-disposition"]
    records = [json.loads(line) for line in response.content.splitlines() if line]
    assert records[0]["record_type"] == "manifest"
    assert records[0]["format"] == "chat-reader-canonical-jsonl"
    assert records[0]["version"] == 2
    assert records[0]["selection"] == {"scope": "selected_messages", "message_count": 1}
    assert records[-1]["record_type"] == "end"
    messages = [record for record in records if record["record_type"] == "message"]
    assert len(messages) == 1
    assert messages[0]["id"] == message["id"]
    assert messages[0]["current_version"]["content_markdown"] == "CanJSON v2 current body"
    serialized = response.content.decode()
    assert "render_blocks" not in serialized
    assert '"blocks"' not in serialized
    assert '"plain_text"' not in serialized
    assert "CanJSON v2 current body" in serialized
    assert any(record["record_type"] == "message_version" for record in records)


def test_v2_exports_include_description_only_when_requested(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    updated = client.patch(
        f"/api/conversations/{conversation_id}",
        json={"description_markdown": "Optional conversation description"},
    )
    assert updated.status_code == 200

    markdown_default = client.get(f"/api/conversations/{conversation_id}/exports/markdown")
    markdown_opted = client.get(
        f"/api/conversations/{conversation_id}/exports/markdown?include_description=true"
    )
    assert "Optional conversation description" not in markdown_default.text
    assert "## Description" in markdown_opted.text
    assert "Optional conversation description" in markdown_opted.text

    canjson = client.get(
        f"/api/conversations/{conversation_id}/exports/canjson?include_description=true"
    )
    records = [json.loads(line) for line in canjson.content.splitlines() if line]
    assert records[0]["conversation"]["description_markdown"] == "Optional conversation description"


def test_canjson_v2_gzip_export_can_be_previewed_and_committed(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]
    source_messages = client.get(f"/api/conversations/{conversation_id}/messages").json()
    expected_content = [item["current_version"]["display_text"] for item in source_messages]

    response = client.get(f"/api/conversations/{conversation_id}/exports/canjson?compression=gzip")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/gzip")
    decompressed = gzip.decompress(response.content)
    assert json.loads(decompressed.splitlines()[0])["format"] == "chat-reader-canonical-jsonl"

    preview = client.post(
        "/api/imports/preview",
        files={"files": ("round-trip.canonical.jsonl.gz", response.content, "application/gzip")},
    )
    assert preview.status_code == 200, preview.text
    preview_payload = preview.json()
    assert preview_payload["conversation_preview"]["source_profile"] == "chat_reader_canjson_v2"
    assert preview_payload["can_commit"] is True

    committed = client.post(f"/api/imports/{preview_payload['import_id']}/commit")
    assert committed.status_code == 200, committed.text
    cloned_id = committed.json()["conversation_ids"][0]
    assert cloned_id != conversation_id
    cloned_messages = client.get(f"/api/conversations/{cloned_id}/messages").json()
    assert [item["current_version"]["display_text"] for item in cloned_messages] == expected_content


def test_markdown_v2_export_has_markers_and_no_default_toc(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    conversation_id = sample["conversation_id"]

    response = client.get(f"/api/conversations/{conversation_id}/exports/markdown")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    assert "format: \"chat-reader-markdown-export\"" in response.text
    assert "version: 2" in response.text
    assert "<!-- chat-reader-message" in response.text
    assert "<!-- /chat-reader-message -->" in response.text
    assert "## Message Index" not in response.text
    assert "## Contents" not in response.text
