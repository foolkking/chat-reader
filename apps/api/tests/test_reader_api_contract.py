import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def test_reader_api_contract_uses_canonical_blocks(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={
            "files": (
                "reader.json",
                json.dumps(
                    {
                        "metadata": {
                            "title": "Reader Contract",
                            "powered_by": "ChatGPT Exporter",
                        },
                        "messages": [
                            {"role": "Prompt", "say": "Show a code sample"},
                            {
                                "role": "Response",
                                "say": "# Example\n\n```python\nprint('hello')\n```",
                            },
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    assert preview.status_code == 200
    preview_payload = preview.json()
    assert preview_payload["can_commit"] is True
    assert preview_payload["commit_endpoint"].endswith("/commit")

    commit = client.post(f"/api/imports/{preview_payload['import_id']}/commit")
    assert commit.status_code == 200
    conversation_id = commit.json()["conversation_ids"][0]

    conversations = client.get("/api/conversations")
    assert conversations.status_code == 200
    assert any(conversation["id"] == conversation_id for conversation in conversations.json())

    messages = client.get(f"/api/conversations/{conversation_id}/messages?include_blocks=true")
    assert messages.status_code == 200
    message_payload = messages.json()
    assert "raw_storage_uri" not in json.dumps(message_payload)
    assert message_payload[1]["render_blocks"]
    assert {block["block_type"] for block in message_payload[1]["render_blocks"]} >= {"heading", "code"}

    blocks = client.get(f"/api/messages/{message_payload[1]['id']}/blocks")
    assert blocks.status_code == 200
    block_payload = blocks.json()
    assert [block["block_index"] for block in block_payload] == sorted(
        block["block_index"] for block in block_payload
    )


def test_reader_and_share_previews_use_the_same_role_aware_summary_projection(client: TestClient) -> None:
    source = "分析合成示例\r\nThinking 5s\r\n\r\nVisible answer."
    created = client.post("/api/conversations", json={
        "title": "Synthetic role-aware previews",
        "messages": [{"role": "user", "content_markdown": source},
                     {"role": "assistant", "content_markdown": source}],
    })
    assert created.status_code == 201
    conversation_id = created.json()["conversation"]["id"]
    owner = client.get(f"/api/conversations/{conversation_id}/dialogue-index").json()["items"]
    shared = client.post(f"/api/conversations/{conversation_id}/shares", json={"title": "Synthetic previews"})
    assert shared.status_code == 200
    public = client.get(f"/api/shared/{shared.json()['token']}/dialogue-index")
    assert public.status_code == 200
    assert [row["preview"] for row in owner] == [row["preview"] for row in public.json()["items"]]
    assert owner[0]["preview"].startswith("分析合成示例")
    assert owner[1]["preview"] == "Visible answer."
