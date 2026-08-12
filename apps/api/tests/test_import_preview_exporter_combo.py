import json
import os
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services.import_pipeline import exporter_markdown_parser
from test_import_preview_api import client  # noqa: F401


def _json_file(message_count: int = 2) -> bytes:
    messages = []
    for index in range(message_count):
        role = "Prompt" if index % 2 == 0 else "Response"
        messages.append({"role": role, "say": f"Content {index}", "time": f"2026-07-01 10:{index:02d}:00"})
    return json.dumps(
        {
            "metadata": {
                "title": "Pairing fixture",
                "dates": {
                    "created": "2026-07-01 10:00:00",
                    "updated": "2026-07-01 10:10:00",
                    "exported": "2026-07-01 10:20:00",
                },
                "link": "https://chatgpt.com/c/test-conversation-id",
                "powered_by": "ChatGPT Exporter",
            },
            "messages": messages,
        }
    ).encode()


def _markdown_file() -> bytes:
    return b"""# Pairing fixture

Created: 2026-07-01 10:00:00
Updated: 2026-07-01 10:10:00
Exported: 2026-07-01 10:20:00
Link: https://chatgpt.com/c/test-conversation-id

## Prompt:
2026-07-01 10:00:00

Content 0

## Response:
2026-07-01 10:01:00

Content 1
"""


def test_preview_exporter_json_returns_conversation_preview(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("export.json", _json_file(), "application/json")},
    )

    assert response.status_code == 200
    preview = response.json()["conversation_preview"]
    assert preview["source_profile"] == "chatgpt_exporter_json"
    assert preview["alignment_status"] == "json_only"
    assert preview["message_count"] == 2


def test_preview_exporter_markdown_without_json_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("export.md", _markdown_file(), "text/markdown")},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "json_required"


def test_preview_exporter_combo_exposes_markdown_display_preview(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files=[
            ("files", ("export.json", _json_file(), "application/json")),
            ("files", ("export.md", _markdown_file(), "text/markdown")),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["files"]) == 2
    preview = payload["conversation_preview"]
    assert preview["source_profile"] == "chatgpt_exporter_combo"
    assert preview["alignment_status"] == "exact_match"
    assert preview["cleaned_thinking_summary_count"] == 0
    assert preview["alignment_summary"] == {"exact": 2}
    assert preview["messages"][1]["display_text_preview"] == "Content 1"
    assert preview["first_user_message_markdown"] == "Content 0"


def test_preview_pairing_budget_returns_structured_422(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(exporter_markdown_parser, "PAIRING_MAX_CANDIDATES", 1)
    response = client.post(
        "/api/imports/preview",
        files=[
            ("files", ("export.json", _json_file(), "application/json")),
            ("files", ("export.md", _markdown_file(), "text/markdown")),
        ],
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "pairing_candidate_limit"


def test_preview_pairing_conflict_disables_commit(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files=[
            ("files", ("export.json", _json_file(message_count=1), "application/json")),
            ("files", ("export.md", _markdown_file(), "text/markdown")),
        ],
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["conversation_preview"]["alignment_status"] == "conflict_detected"
    assert payload["can_commit"] is False
    assert payload["commit_endpoint"] is None
    commit = client.post(f"/api/imports/{payload['import_id']}/commit")
    assert commit.status_code == 409


def test_preview_messages_are_capped(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("export.json", _json_file(message_count=25), "application/json")},
    )

    assert response.status_code == 200
    preview = response.json()["conversation_preview"]
    assert preview["message_count"] == 25
    assert len(preview["messages"]) == 20


def test_preview_preserves_first_user_markdown_structure(client: TestClient) -> None:
    markdown = b"""# Pairing fixture

## Prompt:
2026-07-01 10:00:00

### Preview heading

- preview list item

## Response:
2026-07-01 10:01:00
"""
    response = client.post(
        "/api/imports/preview",
        files=[
            (
                "files",
                (
                    "export.json",
                    json.dumps(
                        {
                            "metadata": {"title": "Pairing fixture"},
                            "messages": [
                                {
                                    "role": "Prompt",
                                    "say": "Preview heading preview list item",
                                    "time": "2026-07-01 10:00:00",
                                }
                            ],
                        }
                    ).encode(),
                    "application/json",
                ),
            ),
            ("files", ("export.md", markdown, "text/markdown")),
        ],
    )

    assert response.status_code == 200
    preview = response.json()["conversation_preview"]
    assert preview["first_user_message_markdown"] == "### Preview heading\n\n- preview list item"


def test_preview_response_only_json_markdown_is_supported(client: TestClient) -> None:
    json_content = json.dumps(
        {
            "metadata": {"title": "Response only", "powered_by": "ChatGPT Exporter"},
            "messages": [
                {"role": "Response", "say": "The matched response body.", "time": "2026/8/7 20:05:18"}
            ],
        }
    ).encode()
    markdown = b"""# Response only

## response
2026/8/7 20:05:18

The matched response body.
"""

    response = client.post(
        "/api/imports/preview",
        files=[
            ("files", ("response.json", json_content, "application/json")),
            ("files", ("response.md", markdown, "text/markdown")),
        ],
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["can_commit"] is True
    assert payload["conversation_preview"]["alignment_status"] == "exact_match"
    assert payload["conversation_preview"]["message_count"] == 1
    assert payload["conversation_preview"]["response_count"] == 1
    assert payload["conversation_preview"]["alignment_issues"] == []


def test_real_exporter_pair_preview_commit_and_retry(client: TestClient) -> None:
    fixture_dir = os.getenv("CHAT_READER_E2E_FIXTURE_DIR")
    if not fixture_dir:
        pytest.skip("CHAT_READER_E2E_FIXTURE_DIR is not configured")
    root = Path(fixture_dir)
    json_path = next(root.glob("*.json"))
    markdown_path = next(root.glob("*.md"))
    started = time.perf_counter()
    response = client.post(
        "/api/imports/preview",
        files=[
            ("files", (json_path.name, json_path.read_bytes(), "application/json")),
            ("files", (markdown_path.name, markdown_path.read_bytes(), "text/markdown")),
        ],
    )
    elapsed = time.perf_counter() - started
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["conversation_preview"]["message_count"] == 398
    assert payload["conversation_preview"]["alignment_status"] == "exact_match"
    assert elapsed < 20

    first = client.post(f"/api/imports/{payload['import_id']}/commit")
    assert first.status_code == 200, first.text
    assert first.json()["message_count"] == 398
    repeated = client.post(f"/api/imports/{payload['import_id']}/commit")
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["conversation_ids"] == first.json()["conversation_ids"]


def test_response_only_real_pair_preview(client: TestClient) -> None:
    json_path_value = os.getenv("CHAT_READER_IMPORT_PAIR_JSON")
    markdown_path_value = os.getenv("CHAT_READER_IMPORT_PAIR_MARKDOWN")
    if not json_path_value or not markdown_path_value:
        pytest.skip("CHAT_READER_IMPORT_PAIR_JSON and CHAT_READER_IMPORT_PAIR_MARKDOWN are not configured")

    json_path = Path(json_path_value)
    markdown_path = Path(markdown_path_value)
    response = client.post(
        "/api/imports/preview",
        files=[
            ("files", (json_path.name, json_path.read_bytes(), "application/json")),
            ("files", (markdown_path.name, markdown_path.read_bytes(), "text/markdown")),
        ],
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    preview = payload["conversation_preview"]
    assert payload["can_commit"] is True
    assert preview["alignment_status"] == "exact_match"
    assert preview["message_count"] == 1
    assert preview["prompt_count"] == 0
    assert preview["response_count"] == 1
    assert preview["alignment_issues"] == []
