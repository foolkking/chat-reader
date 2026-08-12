import gzip
import json

import pytest

from app.schemas.import_schema import SourceProfile
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.import_pipeline.source_detector import detect_source_profile


def _canjson_v2() -> bytes:
    records = [
        {
            "record_type": "manifest",
            "format": "chat-reader-canonical-jsonl",
            "version": 2,
            "conversation": {"id": "source-conversation", "title": "Fixture"},
            "selection": {"message_count": 0},
        },
        {"record_type": "end", "record_count": 2, "message_count": 0},
    ]
    return b"".join(json.dumps(record).encode() + b"\n" for record in records)


def test_detect_chatgpt_exporter_json() -> None:
    content = json.dumps(
        {
            "metadata": {"powered_by": "ChatGPT Exporter"},
            "messages": [{"role": "Prompt", "say": "hello", "time": None}],
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


@pytest.mark.parametrize(("heading", "role"), [("Response", "Response"), ("prompt", "Prompt")])
def test_detect_single_role_exporter_markdown_with_json_context(heading: str, role: str) -> None:
    expected = parse_exporter_json(
        json.dumps(
            {
                "metadata": {},
                "messages": [{"role": role, "say": "Matched body", "time": "2026/8/7 20:05:18"}],
            }
        ).encode()
    ).messages
    content = f"""# Fixture

## {heading}
2026/8/7 20:05:18

Matched body
""".encode()

    result = detect_source_profile("conversation.md", content, expected)

    assert result.source_profile == SourceProfile.chatgpt_exporter_markdown


@pytest.mark.parametrize(
    "content",
    [
        b"# Notes\n\n## Response\n\nExample without exporter timestamp",
        b"# Notes\n\n## Response\n2026/8/7 20:05:18\n\nDated notes are still not an exporter pair",
    ],
)
def test_single_role_or_ordinary_markdown_without_json_context_is_not_misdetected(content: bytes) -> None:
    result = detect_source_profile("notes.md", content)

    assert result.source_profile == SourceProfile.unknown


def test_detect_canjson_v1() -> None:
    content = json.dumps(
        {
            "format": "chat-reader-canonical-export",
            "version": 1,
            "conversation": {"title": "Fixture"},
            "messages": [],
        }
    ).encode()

    result = detect_source_profile("fixture.canonical.json", content)

    assert result.source_profile == SourceProfile.chat_reader_canjson_v1
    assert result.confidence == 1.0


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("fixture.canonical.jsonl", _canjson_v2()),
        ("fixture.canonical.jsonl.gz", gzip.compress(_canjson_v2())),
    ],
)
def test_detect_canjson_v2(filename: str, content: bytes) -> None:
    result = detect_source_profile(filename, content)

    assert result.source_profile == SourceProfile.chat_reader_canjson_v2
    assert result.confidence == 1.0


@pytest.mark.parametrize(
    ("filename", "content", "warning_fragment"),
    [
        (
            "conversations.json",
            json.dumps(
                [
                    {
                        "title": "Official",
                        "current_node": "node-1",
                        "mapping": {"node-1": {"id": "node-1"}},
                    }
                ]
            ).encode(),
            "no longer supported",
        ),
        ("export.csv", b"role,content\nuser,hello\nassistant,hi\n", None),
        ("notes.txt", b"plain transcript", None),
    ],
)
def test_removed_profiles_are_unknown(filename: str, content: bytes, warning_fragment: str | None) -> None:
    result = detect_source_profile(filename, content)

    assert result.source_profile == SourceProfile.unknown
    if warning_fragment:
        assert any(warning_fragment in warning for warning in result.warnings)


def test_invalid_json_returns_unknown_with_warning() -> None:
    result = detect_source_profile("broken.json", b"{not valid json")

    assert result.source_profile == SourceProfile.unknown
    assert result.warnings
