import json

from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown


def _json(title: str = "社交训练", messages: list[dict] | None = None, link: str = "https://chatgpt.com/c/test-id") -> bytes:
    return json.dumps(
        {
            "metadata": {
                "title": title,
                "dates": {"created": "2026-07-01 10:00:00"},
                "link": link,
                "powered_by": "ChatGPT Exporter",
            },
            "messages": messages
            or [
                {"role": "Prompt", "say": "你可以教我提高社交能力吗？", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "当然可以。", "time": "2026-07-01 10:01:00"},
            ],
        },
        ensure_ascii=False,
    ).encode()


def _markdown(title: str = "社交训练", link: str = "https://chatgpt.com/c/test-id", extra: str = "") -> str:
    return f"""# {title}

Created: 2026-07-01 10:00:00
Link: {link}

## Prompt:
2026-07-01 10:00:00

你可以教我提高社交能力吗？

## Response:
2026-07-01 10:01:00

> 考虑提出的生活建议
> 思考了 13s

当然可以。
{extra}
"""


def test_json_only_alignment() -> None:
    result = align_exporter_sources(parse_exporter_json(_json()), None)

    assert result.alignment_status == "json_only"
    assert result.conversation is not None
    assert result.conversation.message_count == 2


def test_markdown_only_alignment() -> None:
    result = align_exporter_sources(None, parse_exporter_markdown(_markdown()))

    assert result.alignment_status == "markdown_only"
    assert result.conversation is not None
    assert result.conversation.cleaned_thinking_summary_count == 1


def test_json_markdown_exact_alignment() -> None:
    result = align_exporter_sources(parse_exporter_json(_json()), parse_exporter_markdown(_markdown()))

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.source_profile == "chatgpt_exporter_combo"
    assert result.conversation.cleaned_thinking_summary_count == 1
    assert "思考了 13s" not in result.conversation.messages[1].display_text


def test_json_markdown_count_mismatch_is_partial() -> None:
    json_result = parse_exporter_json(_json(messages=[{"role": "Prompt", "say": "你可以教我提高社交能力吗？"}]))
    result = align_exporter_sources(json_result, parse_exporter_markdown(_markdown()))

    assert result.alignment_status == "partial_match"


def test_title_or_link_conflict_detected() -> None:
    result = align_exporter_sources(
        parse_exporter_json(_json(title="A", link="https://chatgpt.com/c/a")),
        parse_exporter_markdown(_markdown(title="B", link="https://chatgpt.com/c/b")),
    )

    assert result.alignment_status == "conflict_detected"
