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


def test_dialogue_index_is_lightweight_and_preview_window_truncates_heavy_text(client: TestClient) -> None:
    long_text = (
        "# Large heading\n\n"
        "**important** [documentation](https://example.com)\n\n"
        "[![Architecture preview](https://example.com/image.png)](https://example.com/details)\n\n"
        "```ts title=\"sample\"\nconst value = 1\n```\n\n"
        + ("content line\n" * 1100)
    )
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "light-index.json",
                json.dumps(
                    {
                        "metadata": {"title": "Light Index", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "short question"},
                            {"role": "Response", "say": long_text},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]

    index = client.get(f"/api/conversations/{conversation_id}/dialogue-index")
    assert index.status_code == 200
    assert index.json()["message_count"] == 2
    assert [item["role_number"] for item in index.json()["items"]] == [1, 1]
    assert all(len(item["preview"]) <= 160 for item in index.json()["items"])
    assert "current_version" not in index.json()["items"][1]
    assert index.json()["items"][1]["preview"].startswith(
        "Large heading important documentation Architecture preview const value = 1"
    )
    assert not any(marker in index.json()["items"][1]["preview"] for marker in ("#", "**", "```", "]("))

    window = client.get(
        f"/api/conversations/{conversation_id}/message-window",
        params={"limit": 30, "include_blocks": False, "content_mode": "preview"},
    )
    assert window.status_code == 200
    heavy = window.json()["items"][1]
    assert heavy["is_heavy"] is True
    assert heavy["content_truncated"] is True
    assert len(heavy["current_version"]["display_text"]) <= 500
    assert len(heavy["current_version"]["plain_text"]) <= 500
    assert heavy["current_version"]["blocks"] == []
    assert len(window.content) < 20_000


def test_dialogue_index_centers_a_far_anchor_without_returning_every_message(client: TestClient) -> None:
    messages = [
        {"role": "Prompt" if index % 2 == 0 else "Response", "say": f"message {index}"}
        for index in range(120)
    ]
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "index-anchor.json",
                json.dumps(
                    {
                        "metadata": {"title": "Index Anchor", "powered_by": "ChatGPT Exporter"},
                        "messages": messages,
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    conversation_id = client.post(f"/api/imports/{preview.json()['import_id']}/commit").json()["conversation_ids"][0]
    all_messages = client.get(f"/api/conversations/{conversation_id}/messages", params={"limit": 200}).json()
    anchor_id = all_messages[100]["id"]

    index = client.get(
        f"/api/conversations/{conversation_id}/dialogue-index",
        params={"limit": 20, "anchor_message_id": anchor_id},
    )
    assert index.status_code == 200
    payload = index.json()
    assert payload["total"] == 120
    assert len(payload["items"]) == 20
    assert payload["has_previous"] is True
    assert payload["has_more"] is True
    assert anchor_id in {item["message_id"] for item in payload["items"]}

    window_cases = (
        (0, 0, False, True),
        (60, 48, True, True),
        (119, 90, True, False),
    )
    for anchor_index, expected_offset, has_previous, has_more in window_cases:
        window = client.get(
            f"/api/conversations/{conversation_id}/message-window",
            params={
                "limit": 30,
                "anchor_message_id": all_messages[anchor_index]["id"],
                "anchor_before": 12,
                "content_mode": "preview",
            },
        )
        assert window.status_code == 200
        window_payload = window.json()
        assert window_payload["offset"] == expected_offset
        assert window_payload["has_previous"] is has_previous
        assert window_payload["has_more"] is has_more
        assert all_messages[anchor_index]["id"] in {item["id"] for item in window_payload["items"]}

    invalid_anchor_before = client.get(
        f"/api/conversations/{conversation_id}/message-window",
        params={"limit": 30, "anchor_message_id": anchor_id, "anchor_before": 30},
    )
    assert invalid_anchor_before.status_code == 422
