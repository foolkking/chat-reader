import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def test_conversation_filters_and_message_detail(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "export.json",
                json.dumps(
                    {
                        "metadata": {"title": "Read API", "powered_by": "ChatGPT Exporter"},
                        "messages": [{"role": "Prompt", "say": "hello"}],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    import_id = preview.json()["import_id"]
    conversation_id = client.post(f"/api/imports/{import_id}/commit").json()["conversation_ids"][0]

    filtered = client.get("/api/conversations?source_profile=chatgpt_exporter_json")
    assert filtered.status_code == 200
    assert filtered.json()[0]["id"] == conversation_id

    messages = client.get(f"/api/conversations/{conversation_id}/messages")
    message_id = messages.json()[0]["id"]

    detail = client.get(f"/api/messages/{message_id}")
    assert detail.status_code == 200
    assert detail.json()["current_version"]["plain_text"] == "hello"

    blocks = client.get(f"/api/messages/{message_id}/blocks?start=0&limit=10")
    assert blocks.status_code == 200
    assert blocks.json()[0]["block_type"] == "paragraph"
