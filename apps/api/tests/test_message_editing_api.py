import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def commit_edit_sample(client: TestClient) -> dict:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "edit.json",
                json.dumps(
                    {
                        "metadata": {"title": "Editing Sample", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "Original user question"},
                            {"role": "Response", "say": "Original assistant unique old phrase"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200
    conversation_id = commit.json()["conversation_ids"][0]
    window = client.get(
        f"/api/conversations/{conversation_id}/message-window?include_blocks=true&limit=10"
    )
    assert window.status_code == 200
    return {"conversation_id": conversation_id, "messages": window.json()["items"]}


def assistant_message(sample: dict) -> dict:
    return next(message for message in sample["messages"] if message["role"] == "assistant")


def test_patch_message_creates_new_version_and_current_blocks(client: TestClient) -> None:
    message = assistant_message(commit_edit_sample(client))
    original_version = message["current_version"]

    response = client.patch(
        f"/api/messages/{message['id']}",
        json={
            "display_text": "# Edited Heading\n\nEdited assistant unique new phrase",
            "edit_reason": "Fix wording",
            "base_version_id": original_version["id"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["previous_version_id"] == original_version["id"]
    assert payload["version_number"] == 2
    assert payload["message"]["current_version"]["display_text"].startswith("# Edited Heading")
    assert payload["message"]["current_version"]["edit_type"] == "manual_edit"

    message_detail = client.get(f"/api/messages/{message['id']}")
    assert message_detail.status_code == 200
    assert "Edited assistant" in message_detail.json()["current_version"]["display_text"]

    blocks = client.get(f"/api/messages/{message['id']}/blocks").json()
    assert blocks[0]["block_type"] == "heading"
    assert blocks[0]["plain_text"] == "Edited Heading"


def test_patch_message_validation_and_conflict(client: TestClient) -> None:
    message = assistant_message(commit_edit_sample(client))
    original_version_id = message["current_version"]["id"]

    empty = client.patch(f"/api/messages/{message['id']}", json={"display_text": "   "})
    assert empty.status_code == 400

    unchanged = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": message["current_version"]["display_text"]},
    )
    assert unchanged.status_code == 400

    edited = client.patch(f"/api/messages/{message['id']}", json={"display_text": "Changed once"})
    assert edited.status_code == 200

    conflict = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "Changed twice", "base_version_id": original_version_id},
    )
    assert conflict.status_code == 409


def test_edit_writes_conversation_event(client: TestClient) -> None:
    sample = commit_edit_sample(client)
    message = assistant_message(sample)

    response = client.patch(
        f"/api/messages/{message['id']}",
        json={"display_text": "Event edited phrase", "edit_reason": "Event check"},
    )
    assert response.status_code == 200

    events = client.get(
        f"/api/conversations/{sample['conversation_id']}/events?event_type=message_edited"
    )
    assert events.status_code == 200
    payload = events.json()
    assert payload["total"] == 1
    assert payload["items"][0]["target_message_id"] == message["id"]
    assert payload["items"][0]["payload"]["edit_reason"] == "Event check"


def test_task_checkbox_toggle_creates_v2_then_replaces_current_for_user_and_assistant(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "tasks.json",
                json.dumps({
                    "metadata": {"title": "Task toggles", "powered_by": "ChatGPT Exporter"},
                    "messages": [
                        {"role": "Prompt", "say": "- [ ] User task"},
                        {"role": "Response", "say": "- [ ] Assistant task\n\n```md\n- [ ] example only\n```"},
                    ],
                }).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200
    conversation_id = commit.json()["conversation_ids"][0]
    messages = client.get(f"/api/conversations/{conversation_id}/message-window?include_blocks=true&limit=10").json()["items"]

    for message in messages:
        current = message["current_version"]
        paragraph = next(block for block in message["render_blocks"] if block["block_type"] == "paragraph")
        tasks = paragraph["data"]["tasks"]
        assert len(tasks) == 1
        task_key = tasks[0]["task_key"]

        first = client.post(
            f"/api/messages/{message['id']}/tasks/{task_key}/toggle",
            json={"base_version_id": current["id"], "checked": True},
        )
        assert first.status_code == 200, first.text
        first_payload = first.json()
        assert first_payload["version_number"] == 2
        assert "- [x]" in first_payload["message_version"]["display_text"]

        second = client.post(
            f"/api/messages/{message['id']}/tasks/{task_key}/toggle",
            json={"base_version_id": first_payload["current_version_id"], "checked": False},
        )
        assert second.status_code == 200, second.text
        assert second.json()["version_number"] == 2
        assert "- [ ]" in second.json()["message_version"]["display_text"]
        history = client.get(f"/api/messages/{message['id']}/versions").json()["items"]
        assert [item["version_number"] for item in history] == [2, 1]

        conflict = client.post(
            f"/api/messages/{message['id']}/tasks/{task_key}/toggle",
            json={"base_version_id": current["id"], "checked": True},
        )
        assert conflict.status_code == 409
