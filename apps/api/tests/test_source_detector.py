import json

from app.schemas.import_schema import SourceProfile
from app.services.import_pipeline.source_detector import detect_source_profile


def test_detect_chatgpt_exporter_json() -> None:
    content = json.dumps(
        {
            "metadata": {"powered_by": "ChatGPT Exporter"},
            "messages": [{"role": "user", "content": "hello"}],
        }
    ).encode()

    result = detect_source_profile("conversation.json", content)

    assert result.source_profile == SourceProfile.chatgpt_exporter_json
    assert result.confidence >= 0.9


def test_detect_chatgpt_exporter_markdown() -> None:
    content = b"""Created: 2026-07-07
Updated: 2026-07-07
Exported: 2026-07-07
Link: https://example.test

## Prompt:
Hello

## Response:
Hi
"""

    result = detect_source_profile("conversation.md", content)

    assert result.source_profile == SourceProfile.chatgpt_exporter_markdown


def test_detect_official_conversations_json() -> None:
    content = json.dumps(
        [
            {
                "title": "Official",
                "current_node": "node-1",
                "mapping": {"node-1": {"id": "node-1"}},
            }
        ]
    ).encode()

    result = detect_source_profile("conversations.json", content)

    assert result.source_profile == SourceProfile.official_conversations_json


def test_detect_official_single_conversation_json() -> None:
    content = json.dumps(
        {
            "title": "Official",
            "current_node": "node-1",
            "mapping": {"node-1": {"id": "node-1"}},
        }
    ).encode()

    result = detect_source_profile("conversation.json", content)

    assert result.source_profile == SourceProfile.official_conversation_json


def test_detect_csv() -> None:
    result = detect_source_profile("export.csv", b"role,content\nuser,hello\nassistant,hi\n")

    assert result.source_profile == SourceProfile.csv


def test_detect_plain_text() -> None:
    result = detect_source_profile("notes.txt", b"plain transcript")

    assert result.source_profile == SourceProfile.plain_text


def test_invalid_json_returns_unknown_with_warning() -> None:
    result = detect_source_profile("broken.json", b"{not valid json")

    assert result.source_profile == SourceProfile.unknown
    assert result.warnings
