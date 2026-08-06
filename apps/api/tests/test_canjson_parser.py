import gzip
import json

import pytest

from app.services.import_pipeline.canjson_parser import (
    CanJsonParseError,
    parse_canjson_v1,
    parse_canjson_v2,
)


def _jsonl(*records: dict) -> bytes:
    return b"".join(json.dumps(record, ensure_ascii=False).encode() + b"\n" for record in records)


def _manifest(message_count: int = 1) -> dict:
    return {
        "record_type": "manifest",
        "format": "chat-reader-canonical-jsonl",
        "version": 2,
        "exported_at": "2026-07-30T00:00:00Z",
        "conversation": {
            "id": "source-conversation-id",
            "title": "CanJSON fixture",
            "display_title": "CanJSON fixture",
        },
        "selection": {"scope": "all_current_messages", "message_count": message_count},
        "content": {"format": "markdown", "versions": "current_only"},
    }


def _message() -> dict:
    return {
        "record_type": "message",
        "id": "source-message-id",
        "seq": 1,
        "order_key": "000001",
        "role": "user",
        "created_at": "2026-07-30T00:00:01Z",
        "current_version": {
            "id": "source-version-id",
            "number": 1,
            "content_markdown": "# Heading\n\nBody",
            "content_hash": "source-hash-is-advisory",
            "edit_type": "imported",
        },
    }


def test_parse_canjson_v2_rebuilds_canonical_content_and_skips_optional_record() -> None:
    payload = _jsonl(
        _manifest(),
        _message(),
        {"record_type": "future_optional", "required": False, "value": 1},
        {"record_type": "end", "record_count": 4, "message_count": 1},
    )

    result = parse_canjson_v2(payload)

    assert result.conversation.source_profile == "chat_reader_canjson_v2"
    assert result.conversation.external_source_id == "source-conversation-id"
    assert result.conversation.message_count == 1
    message = result.conversation.messages[0]
    assert message.source_message_id == "source-message-id"
    assert message.source_current_version_id == "source-version-id"
    assert message.display_text == "# Heading\n\nBody"
    assert message.plain_text == "# Heading Body"
    assert message.content_hash != "source-hash-is-advisory"
    assert any("future_optional" in warning for warning in result.warnings)


def test_parse_canjson_v2_rejects_unknown_required_record() -> None:
    payload = _jsonl(
        _manifest(),
        {"record_type": "future_required", "required": True},
        _message(),
    )

    with pytest.raises(CanJsonParseError, match="Required CanJSON record type"):
        parse_canjson_v2(payload)


def test_parse_canjson_v2_supports_gzip() -> None:
    payload = _jsonl(_manifest(), _message(), {"record_type": "end", "message_count": 1})

    result = parse_canjson_v2(gzip.compress(payload), compressed=True)

    assert result.conversation.messages[0].display_text == "# Heading\n\nBody"


def test_parse_canjson_v2_rejects_manifest_count_mismatch() -> None:
    payload = _jsonl(_manifest(message_count=2), _message())

    with pytest.raises(CanJsonParseError, match="message_count"):
        parse_canjson_v2(payload)


def test_parse_canjson_v1_ignores_derived_payloads() -> None:
    payload = {
        "format": "chat-reader-canonical-export",
        "version": 1,
        "conversation": {"id": "legacy-conversation", "title": "Legacy CanJSON"},
        "messages": [
            {
                "id": "legacy-message",
                "order_key": "000001",
                "role": "assistant",
                "current_version": {
                    "id": "legacy-version",
                    "display_text": "Canonical markdown",
                    "plain_text": "must not be authoritative",
                    "blocks": [{"plain_text": "must not be imported"}],
                },
                "render_blocks": [{"plain_text": "also ignored"}],
            }
        ],
        "toc": [{"text": "ignored"}],
    }

    result = parse_canjson_v1(json.dumps(payload).encode())

    assert result.conversation.messages[0].display_text == "Canonical markdown"
    assert result.conversation.messages[0].plain_text == "Canonical markdown"
    assert any("ignored" in warning for warning in result.warnings)
