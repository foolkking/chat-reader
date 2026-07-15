import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _exporter_json() -> bytes:
    return json.dumps(
        {
            "metadata": {
                "title": "社交训练",
                "dates": {"created": "2026-07-01 10:00:00", "updated": "2026-07-01 10:10:00"},
                "link": "https://chatgpt.com/c/exporter-id",
                "powered_by": "ChatGPT Exporter",
            },
            "messages": [
                {"role": "Prompt", "say": "你可以教我提高社交能力吗？", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "思考了 13s\n当然可以。\n\n# 建议\n多练习。", "time": "2026-07-01 10:01:00"},
                {"role": "Response", "say": "", "time": "2026-07-01 10:02:00"},
            ],
        },
        ensure_ascii=False,
    ).encode()


def test_exporter_json_import_can_be_committed_and_read(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={"files": ("export.json", _exporter_json(), "application/json")},
    )
    assert preview.status_code == 200
    import_id = preview.json()["import_id"]

    commit = client.post(f"/api/imports/{import_id}/commit")
    assert commit.status_code == 200
    commit_payload = commit.json()
    assert commit_payload["status"] == "committed"
    assert commit_payload["conversation_count"] == 1
    assert commit_payload["message_count"] == 2

    conversation_id = commit_payload["conversation_ids"][0]
    conversations = client.get("/api/conversations")
    assert conversations.status_code == 200
    assert conversations.json()[0]["id"] == conversation_id

    detail = client.get(f"/api/conversations/{conversation_id}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "社交训练"

    messages = client.get(f"/api/conversations/{conversation_id}/messages?include_blocks=true")
    assert messages.status_code == 200
    message_payload = messages.json()
    assert len(message_payload) == 2
    assert message_payload[1]["current_version"]["display_text"].startswith("当然可以。")
    assert any(block["block_type"] == "heading" for block in message_payload[1]["render_blocks"])

    blocks = client.get(f"/api/messages/{message_payload[1]['id']}/blocks")
    assert blocks.status_code == 200
    assert blocks.json()

    message_detail = client.get(f"/api/messages/{message_payload[0]['id']}")
    assert message_detail.status_code == 200
    assert message_detail.json()["source_refs"][0]["source_json_index"] == 0


def test_duplicate_commit_returns_400(client: TestClient) -> None:
    preview = client.post(
        "/api/imports/preview",
        files={"files": ("export.json", _exporter_json(), "application/json")},
    )
    import_id = preview.json()["import_id"]

    assert client.post(f"/api/imports/{import_id}/commit").status_code == 200
    repeated = client.post(f"/api/imports/{import_id}/commit")
    assert repeated.status_code == 200
    assert repeated.json()["conversation_ids"]
