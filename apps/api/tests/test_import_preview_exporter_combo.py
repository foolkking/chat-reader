import json

from fastapi.testclient import TestClient

from test_import_preview_api import client  # noqa: F401


def _json_file(message_count: int = 2) -> bytes:
    messages = []
    for index in range(message_count):
        role = "Prompt" if index % 2 == 0 else "Response"
        say = f"内容 {index}"
        messages.append({"role": role, "say": say, "time": f"2026-07-01 10:{index:02d}:00"})
    return json.dumps(
        {
            "metadata": {
                "title": "社交训练",
                "dates": {
                    "created": "2026-07-01 10:00:00",
                    "updated": "2026-07-01 10:10:00",
                    "exported": "2026-07-01 10:20:00",
                },
                "link": "https://chatgpt.com/c/test-conversation-id",
                "powered_by": "ChatGPT Exporter",
            },
            "messages": messages,
        },
        ensure_ascii=False,
    ).encode()


def _markdown_file() -> bytes:
    return """# 社交训练

Created: 2026-07-01 10:00:00
Updated: 2026-07-01 10:10:00
Exported: 2026-07-01 10:20:00
Link: https://chatgpt.com/c/test-conversation-id

## Prompt:
2026-07-01 10:00:00

内容 0

## Response:
2026-07-01 10:01:00

> 考虑提出的生活建议
> 思考了 13s

内容 1
""".encode()


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


def test_preview_exporter_markdown_returns_conversation_preview(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("export.md", _markdown_file(), "text/markdown")},
    )

    assert response.status_code == 200
    preview = response.json()["conversation_preview"]
    assert preview["source_profile"] == "chatgpt_exporter_markdown"
    assert preview["alignment_status"] == "markdown_only"
    assert preview["cleaned_thinking_summary_count"] == 1


def test_preview_exporter_combo_returns_cleaned_combo_preview(client: TestClient) -> None:
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
    assert preview["cleaned_thinking_summary_count"] == 1
    assert "思考了 13s" not in preview["messages"][1]["display_text_preview"]


def test_preview_messages_are_capped(client: TestClient) -> None:
    response = client.post(
        "/api/imports/preview",
        files={"files": ("export.json", _json_file(message_count=25), "application/json")},
    )

    assert response.status_code == 200
    preview = response.json()["conversation_preview"]
    assert preview["message_count"] == 25
    assert len(preview["messages"]) == 20
