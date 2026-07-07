import json

import pytest

from app.services.import_pipeline.exporter_json_parser import ExporterJsonParseError, parse_exporter_json


def _sample(messages: list[dict]) -> bytes:
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


def test_valid_exporter_json_parses_title_link_and_messages() -> None:
    result = parse_exporter_json(
        _sample(
            [
                {"role": "Prompt", "say": "你可以教我提高社交能力吗？", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "当然可以。", "time": "2026-07-01 10:01:00"},
            ]
        )
    )

    assert result.title == "社交训练"
    assert result.external_conversation_id == "test-conversation-id"
    assert result.message_count == 2
    assert result.messages[0].role == "user"
    assert result.messages[1].role == "assistant"


def test_empty_say_counted() -> None:
    result = parse_exporter_json(_sample([{"role": "Prompt", "say": "", "time": None}]))

    assert result.empty_message_count == 1
    assert result.messages[0].is_empty is True


def test_invalid_messages_raises_parse_error() -> None:
    content = json.dumps(
        {
            "metadata": {"powered_by": "ChatGPT Exporter"},
            "messages": {"not": "a list"},
        }
    )

    with pytest.raises(ExporterJsonParseError):
        parse_exporter_json(content)
