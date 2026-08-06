import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def test_exporter_combo_timestamp_conflict_must_not_persist_markdown_over_json(client: TestClient) -> None:
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
2026-07-01 10:02:00

Markdown answer
"""

    preview = client.post(
        "/api/imports/preview",
        files=[
            ("files", ("export.json", json_file, "application/json")),
            ("files", ("export.md", markdown_file, "text/markdown")),
        ],
    )
    assert preview.status_code == 200
    payload = preview.json()
    assert payload["can_commit"] is False
    assert payload["conversation_preview"]["alignment_status"] == "conflict_detected"
    commit = client.post(f"/api/imports/{payload['import_id']}/commit")
    assert commit.status_code == 409
