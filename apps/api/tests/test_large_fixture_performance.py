import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _large_exporter_payload(pair_count: int, heavy: bool = False) -> bytes:
    messages = []
    for index in range(pair_count):
        messages.append({"role": "Prompt", "say": f"large prompt {index}"})
        response = f"# Heading {index}\n\nlarge response {index}\n\n```text\ncode {index}\n```"
        if heavy and index == 0:
            response += "\n\n" + ("heavy-content " * 1200)
        messages.append({"role": "Response", "say": response})
    return json.dumps(
        {
            "metadata": {"title": f"Large {pair_count}", "powered_by": "ChatGPT Exporter"},
            "messages": messages,
        }
    ).encode()


def test_large_200_and_1000_message_conversations_have_window_limits(client: TestClient) -> None:
    for pair_count in [100, 500]:
        preview = client.post(
            "/api/imports/preview",
            files={"files": (f"large-{pair_count}.json", _large_exporter_payload(pair_count), "application/json")},
        )
        assert preview.status_code == 200
        commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
        assert commit.status_code == 200
        conversation_id = commit.json()["conversation_ids"][0]
        total_messages = pair_count * 2

        window = client.get(f"/api/conversations/{conversation_id}/message-window?limit=50&include_blocks=true")
        assert window.status_code == 200
        payload = window.json()
        assert payload["total"] == total_messages
        assert len(payload["items"]) == 50
        assert payload["has_more"] is (total_messages > 50)

        capped = client.get(f"/api/conversations/{conversation_id}/message-window?limit=500")
        assert capped.status_code == 422

        reindex = client.post("/api/search/reindex", json={"conversation_id": conversation_id})
        assert reindex.status_code == 200
        assert reindex.json()["indexed_count"] >= total_messages


def test_heavy_message_and_block_limit_guards(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={"files": ("heavy.json", _large_exporter_payload(2, heavy=True), "application/json")},
    )
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    conversation_id = commit.json()["conversation_ids"][0]
    window = client.get(f"/api/conversations/{conversation_id}/message-window?include_blocks=true").json()
    heavy_message = next(message for message in window["items"] if message["is_heavy"])
    assert heavy_message["char_count"] > 12000

    blocks = client.get(f"/api/messages/{heavy_message['id']}/blocks?limit=200")
    assert blocks.status_code == 200
    too_many_blocks = client.get(f"/api/messages/{heavy_message['id']}/blocks?limit=500")
    assert too_many_blocks.status_code == 422
