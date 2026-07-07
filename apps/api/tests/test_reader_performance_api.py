import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def test_message_window_paginates_and_includes_current_page_blocks(client: TestClient) -> None:
    messages = [
        {"role": "Prompt", "say": "first"},
        {"role": "Response", "say": "# Heading\n\nbody"},
        {"role": "Prompt", "say": "second"},
        {"role": "Response", "say": "done"},
    ]
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "window.json",
                json.dumps(
                    {
                        "metadata": {"title": "Window Sample", "powered_by": "ChatGPT Exporter"},
                        "messages": messages,
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]

    first_page = client.get(f"/api/conversations/{conversation_id}/message-window?limit=2&offset=0&include_blocks=true")
    assert first_page.status_code == 200
    payload = first_page.json()
    assert payload["total"] == 4
    assert payload["has_more"] is True
    assert len(payload["items"]) == 2
    assert payload["items"][1]["render_blocks"]

    second_page = client.get(f"/api/conversations/{conversation_id}/message-window?limit=2&offset=2")
    assert second_page.status_code == 200
    assert second_page.json()["has_more"] is False


def test_message_blocks_endpoint_sorts_and_caps_limit(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "blocks.json",
                json.dumps(
                    {
                        "metadata": {"title": "Blocks Sample", "powered_by": "ChatGPT Exporter"},
                        "messages": [{"role": "Response", "say": "# A\n\n```text\ncode\n```"}],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]
    message_id = client.get(f"/api/conversations/{conversation_id}/messages").json()[0]["id"]

    blocks = client.get(f"/api/messages/{message_id}/blocks?start=0&limit=200")
    assert blocks.status_code == 200
    payload = blocks.json()
    assert [block["block_index"] for block in payload] == sorted(block["block_index"] for block in payload)

    too_large = client.get(f"/api/messages/{message_id}/blocks?start=0&limit=201")
    assert too_large.status_code == 422
