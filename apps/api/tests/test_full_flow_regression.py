import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401
from background_job_test_utils import process_queued_jobs


def _preview_commit(client: TestClient, files: dict) -> str:
    preview = client.post("/api/imports/preview", files=files)
    assert preview.status_code == 200
    commit = client.post(f"/api/imports/{preview.json()['import_id']}/commit")
    assert commit.status_code == 200
    return commit.json()["conversation_ids"][0]


def test_exporter_json_full_flow(client: TestClient) -> None:
    conversation_id = _preview_commit(
        client,
        {
            "files": (
                "flow.json",
                json.dumps(
                    {
                        "metadata": {"title": "JSON Flow", "powered_by": "ChatGPT Exporter"},
                        "messages": [
                            {"role": "Prompt", "say": "json flow alpha"},
                            {"role": "Response", "say": "# JSON Flow Heading\n\njson flow answer"},
                        ],
                    }
                ).encode(),
                "application/json",
            )
        },
    )
    assert client.get("/api/conversations").status_code == 200
    assert client.get(f"/api/conversations/{conversation_id}/message-window?include_blocks=true").json()["total"] == 2
    assert client.get("/api/search?q=alpha").json()["total"] >= 1
    assert client.get(f"/api/conversations/{conversation_id}/toc").json()["items"][0]["text"] == "JSON Flow Heading"
    message_id = client.get(f"/api/conversations/{conversation_id}/message-window").json()["items"][1]["id"]
    assert client.patch(f"/api/messages/{message_id}", json={"display_text": "# Edited Flow\n\nupdated"}).status_code == 200
    process_queued_jobs()
    assert client.get("/api/search?q=updated").json()["total"] >= 1
    share = client.post(f"/api/conversations/{conversation_id}/shares", json={}).json()
    assert client.get(f"/api/shared/{share['token']}").status_code == 200
    assert client.get(f"/api/conversations/{conversation_id}/export?format=markdown").status_code == 200
    assert client.get(f"/api/conversations/{conversation_id}/export?format=canonical_json").status_code == 200


def test_exporter_json_with_optional_markdown_validation_flow(client: TestClient) -> None:
    markdown = """# Combo Flow

Created: 2026-07-01 10:00:00
Updated: 2026-07-01 10:10:00
Exported: 2026-07-01 10:20:00
Link: https://chatgpt.com/c/combo-flow

## Prompt:
2026-07-01 10:00:00

combo question

## Response:
2026-07-01 10:01:00

### Rendered Markdown

- safe list item

```python
print("safe")
```
"""
    combo_json = {
        "metadata": {"title": "Combo Flow", "powered_by": "ChatGPT Exporter"},
        "messages": [
            {"role": "Prompt", "say": "combo question", "time": "2026-07-01 10:00:00"},
            {"role": "Response", "say": "JSON fallback body", "time": "2026-07-01 10:01:00"},
        ],
    }
    combo_id = _preview_commit(
        client,
        [
            ("files", ("combo.json", json.dumps(combo_json).encode(), "application/json")),
            ("files", ("combo.md", markdown.encode(), "text/markdown")),
        ],
    )
    combo_messages = client.get(f"/api/conversations/{combo_id}/message-window?include_blocks=true").json()["items"]
    assert combo_messages[0]["role"] == "user"
    assert combo_messages[1]["current_version"]["display_text"].startswith("### Rendered Markdown")
    assert [block["block_type"] for block in combo_messages[1]["render_blocks"]] == ["heading", "paragraph", "code"]


def test_official_conversations_are_rejected_from_the_main_import_flow(client: TestClient) -> None:
    official = [
        {
            "id": "official-flow",
            "title": "Official Flow",
            "current_node": "assistant-1",
            "mapping": {
                "root": {"id": "root", "message": None, "parent": None, "children": ["user-1"]},
                "user-1": {
                    "id": "user-1",
                    "message": {"id": "m-user", "author": {"role": "user"}, "content": {"content_type": "text", "parts": ["official question"]}},
                    "parent": "root",
                    "children": ["assistant-1", "assistant-alt"],
                },
                "assistant-1": {
                    "id": "assistant-1",
                    "message": {"id": "m-assistant", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["official primary answer"]}},
                    "parent": "user-1",
                    "children": [],
                },
                "assistant-alt": {
                    "id": "assistant-alt",
                    "message": {"id": "m-alt", "author": {"role": "assistant"}, "content": {"content_type": "text", "parts": ["branch should not show"]}},
                    "parent": "user-1",
                    "children": [],
                },
            },
        }
    ]
    response = client.post(
        "/api/imports/preview",
        files={"files": ("conversations.json", json.dumps(official).encode(), "application/json")},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unsupported_source_profile"
