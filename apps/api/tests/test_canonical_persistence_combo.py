import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def test_exporter_combo_persists_markdown_display_text(client: TestClient) -> None:
    json_file = json.dumps(
        {
            "metadata": {
                "title": "Combo",
                "link": "https://chatgpt.com/c/combo-id",
                "powered_by": "ChatGPT Exporter",
            },
            "messages": [
                {"role": "Prompt", "say": "Question", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "JSON answer", "time": "2026-07-01 10:01:00"},
            ],
        }
    ).encode()
    markdown_file = b"""# Combo
Link: https://chatgpt.com/c/combo-id

## Prompt:
2026-07-01 10:00:00

Question

## Response:
2026-07-01 10:01:00

Markdown answer
"""

    preview = client.post(
        "/api/imports/preview",
        files=[
            ("files", ("export.json", json_file, "application/json")),
            ("files", ("export.md", markdown_file, "text/markdown")),
        ],
    )
    import_id = preview.json()["import_id"]
    commit = client.post(f"/api/imports/{import_id}/commit")
    conversation_id = commit.json()["conversation_ids"][0]

    messages = client.get(f"/api/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assistant = messages.json()[1]
    assert assistant["current_version"]["plain_text"] == "JSON answer"
    assert assistant["current_version"]["display_text"] == "Markdown answer"

    detail = client.get(f"/api/messages/{assistant['id']}")
    refs = detail.json()["source_refs"][0]
    assert refs["source_json_index"] == 1
    assert refs["source_markdown_index"] == 1
