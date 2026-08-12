import json
import time

import pytest

from app.services.import_pipeline.exporter_aligner import align_exporter_sources
from app.services.import_pipeline.canonical_draft import preview_markdown
from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import ExporterMarkdownPairingError, parse_exporter_markdown


def _json(title: str = "Social training", messages: list[dict] | None = None, link: str = "https://chatgpt.com/c/test-id") -> bytes:
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
                {"role": "Prompt", "say": "Can you help?", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "Yes, I can.", "time": "2026-07-01 10:01:00"},
            ],
        }
    ).encode()


def _markdown(title: str = "Social training", link: str = "https://chatgpt.com/c/test-id", extra: str = "") -> str:
    return f"""# {title}

Created: 2026-07-01 10:00:00
Link: {link}

## Prompt:
2026-07-01 10:00:00

Can you help?

## Response:
2026-07-01 10:01:00

Yes, I can.{extra}
"""


def test_json_only_alignment() -> None:
    result = align_exporter_sources(parse_exporter_json(_json()), None)

    assert result.alignment_status == "json_only"
    assert result.conversation is not None
    assert result.conversation.message_count == 2


def test_markdown_only_alignment_is_supported_in_service_layer() -> None:
    result = align_exporter_sources(None, parse_exporter_markdown(_markdown()))

    assert result.alignment_status == "markdown_only"
    assert result.conversation is not None
    assert result.conversation.cleaned_thinking_summary_count == 0


def test_json_markdown_exact_alignment_uses_markdown_as_display_authority() -> None:
    result = align_exporter_sources(parse_exporter_json(_json()), parse_exporter_markdown(_markdown()))

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.source_profile == "chatgpt_exporter_combo"
    assert result.conversation.cleaned_thinking_summary_count == 0
    assert result.conversation.messages[1].display_source == "markdown"
    assert result.conversation.messages[1].display_text == "Yes, I can."
    assert result.conversation.alignment_status == "exact_match"


def test_json_markdown_count_mismatch_blocks_commit() -> None:
    json_result = parse_exporter_json(_json(messages=[{"role": "Prompt", "say": "Can you help?"}]))
    result = align_exporter_sources(json_result, parse_exporter_markdown(_markdown()))

    assert result.alignment_status == "conflict_detected"
    assert result.conversation is not None
    assert result.conversation.messages[0].display_source == "markdown"
    assert any("blocks commit" in warning for warning in result.warnings)


def test_same_timestamp_with_unrelated_markdown_blocks_commit() -> None:
    json_result = parse_exporter_json(
        _json(messages=[{"role": "Prompt", "say": "JSON is canonical", "time": "2026-07-01 10:00:00"}])
    )
    markdown = """# Social training

## Prompt:
2026-07-01 10:00:00

Different Markdown validation text
"""

    result = align_exporter_sources(json_result, parse_exporter_markdown(markdown))

    assert result.alignment_status == "conflict_detected"
    assert result.conversation is not None
    assert result.conversation.messages[0].display_source == "json"
    assert result.conversation.messages[0].alignment_status == "json_only"
    assert {issue["source"] for issue in result.conversation.alignment_issues} == {"json", "markdown"}
    assert {issue["reason"] for issue in result.conversation.alignment_issues} == {"content_mismatch"}


def test_structurally_paired_markdown_preserves_rendering_constructs() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {
                    "role": "Response",
                    "say": "Rendered heading rendered list item print rendered",
                    "time": "2026-07-01 10:00:00",
                }
            ]
        )
    )
    markdown = """# Social training

## Response:
2026-07-01 10:00:00

### Rendered heading

- rendered list item

```python
print("rendered")
```
"""

    result = align_exporter_sources(json_result, parse_exporter_markdown(markdown))

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.messages[0].display_source == "markdown"
    assert result.conversation.messages[0].display_text.startswith("### Rendered heading")
    assert "```python" in result.conversation.messages[0].display_text


def test_same_timestamp_allows_rich_markdown_when_json_is_a_lossy_fallback() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {
                    "role": "Response",
                    "say": "JSON fallback body",
                    "time": "2026-07-01 10:00:00",
                }
            ]
        )
    )
    markdown = """# Social training

## Response:
2026-07-01 10:00:00

### Authoritative Markdown

- structured display body
"""

    result = align_exporter_sources(json_result, parse_exporter_markdown(markdown))

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.messages[0].alignment_status == "by_order"
    assert result.conversation.messages[0].display_source == "markdown"


def test_empty_json_messages_in_any_position_do_not_shift_alignment() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {"role": "Prompt", "say": "", "time": "2026-07-01 09:59:00"},
                {"role": "Prompt", "say": "Can you help?", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "   \n", "time": "2026-07-01 10:00:30"},
                {"role": "Response", "say": "Yes, I can.", "time": "2026-07-01 10:01:00"},
                {"role": "Prompt", "say": "", "time": "2026-07-01 10:02:00"},
            ]
        )
    )

    result = align_exporter_sources(json_result, parse_exporter_markdown(_markdown(), json_result.messages))

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert [message.source_json_index for message in result.conversation.messages] == [1, 3]
    assert result.conversation.ignored_json_empty_count == 3
    assert result.conversation.ignored_markdown_empty_count == 0
    assert result.conversation.alignment_issues == []


def test_nonempty_middle_gap_is_reported_without_shifting_later_match() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {"role": "Prompt", "say": "Can you help?", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "Missing middle", "time": "2026-07-01 10:00:30"},
                {"role": "Response", "say": "Yes, I can.", "time": "2026-07-01 10:01:00"},
            ]
        )
    )

    result = align_exporter_sources(json_result, parse_exporter_markdown(_markdown(), json_result.messages))

    assert result.alignment_status == "conflict_detected"
    assert result.conversation is not None
    assert [message.alignment_status for message in result.conversation.messages] == ["exact", "json_only", "exact"]
    assert result.conversation.alignment_issues == [
        {
            "source": "json",
            "source_index": 1,
            "role": "assistant",
            "timestamp": "2026-07-01 10:00:30",
            "reason": "unmatched",
        }
    ]


@pytest.mark.parametrize(
    ("messages", "expected_issue_index"),
    [
        (
            [
                {"role": "Prompt", "say": "Missing head", "time": "2026-07-01 09:59:00"},
                {"role": "Prompt", "say": "Can you help?", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "Yes, I can.", "time": "2026-07-01 10:01:00"},
            ],
            0,
        ),
        (
            [
                {"role": "Prompt", "say": "Can you help?", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "Yes, I can.", "time": "2026-07-01 10:01:00"},
                {"role": "Response", "say": "Missing tail", "time": "2026-07-01 10:02:00"},
            ],
            2,
        ),
    ],
)
def test_nonempty_head_or_tail_gap_is_reported_without_losing_matches(
    messages: list[dict],
    expected_issue_index: int,
) -> None:
    json_result = parse_exporter_json(_json(messages=messages))

    result = align_exporter_sources(json_result, parse_exporter_markdown(_markdown(), json_result.messages))

    assert result.alignment_status == "conflict_detected"
    assert result.conversation is not None
    assert sum(message.alignment_status == "exact" for message in result.conversation.messages) == 2
    assert result.conversation.alignment_issues == [
        {
            "source": "json",
            "source_index": expected_issue_index,
            "role": "user" if expected_issue_index == 0 else "assistant",
            "timestamp": messages[expected_issue_index]["time"],
            "reason": "unmatched",
        }
    ]


def test_unique_timestamp_alignment_stays_linear_at_realistic_scale() -> None:
    messages = [
        {
            "role": "Prompt" if index % 2 == 0 else "Response",
            "say": f"message {index}",
            "time": f"2026-07-01 10:{index // 60:02d}:{index % 60:02d}",
        }
        for index in range(398)
    ]
    json_result = parse_exporter_json(_json(messages=messages))
    sections = ["# Social training"]
    for message in messages:
        sections.extend(
            [
                "",
                f"## {message['role']}:",
                message["time"],
                "",
                message["say"],
            ]
        )

    started = time.monotonic()
    result = align_exporter_sources(json_result, parse_exporter_markdown("\n".join(sections), json_result.messages))
    elapsed = time.monotonic() - started

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.message_count == 398
    assert elapsed < 3.0


def test_unique_timestamp_does_not_pair_unrelated_plain_text() -> None:
    json_result = parse_exporter_json(
        _json(messages=[{"role": "Response", "say": "canonical JSON body", "time": "2026-07-01 10:00:00"}])
    )
    markdown = """# Social training

## Response:
2026-07-01 10:00:00

completely unrelated Markdown body
"""

    result = align_exporter_sources(json_result, parse_exporter_markdown(markdown))

    assert result.alignment_status == "conflict_detected"
    assert result.conversation is not None
    assert result.conversation.messages[0].alignment_status == "json_only"
    assert {issue["reason"] for issue in result.conversation.alignment_issues} == {"content_mismatch"}


def test_missing_timestamps_use_unique_normalized_content_match() -> None:
    json_result = parse_exporter_json(
        _json(messages=[{"role": "Response", "say": "  Same   response  ", "time": None}])
    )
    markdown_result = parse_exporter_markdown("""# Social training

## Response

Same response
""")

    result = align_exporter_sources(json_result, markdown_result)

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.messages[0].alignment_status == "normalized"


def test_empty_markdown_section_is_counted_and_does_not_pollute_previous_body() -> None:
    json_result = parse_exporter_json(
        _json(messages=[{"role": "Prompt", "say": "Can you help?", "time": "2026-07-01 10:00:00"}])
    )
    markdown = """# Social training

## Prompt
2026-07-01 10:00:00

Can you help?

## Response
2026-07-01 10:01:00
"""

    result = align_exporter_sources(json_result, parse_exporter_markdown(markdown, json_result.messages))

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.messages[0].display_text == "Can you help?"
    assert result.conversation.ignored_markdown_empty_count == 1


def test_missing_timestamp_duplicate_content_is_ambiguous() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {"role": "Response", "say": "Repeated", "time": None},
                {"role": "Response", "say": "Repeated", "time": None},
            ]
        )
    )
    markdown_result = parse_exporter_markdown("""# Fixture

## Response

Repeated

## Response

Repeated

## Response

Repeated
""")

    with pytest.raises(ExporterMarkdownPairingError, match="multiple equally reliable") as caught:
        align_exporter_sources(json_result, markdown_result)

    assert caught.value.code == "pairing_ambiguous"


def test_timestamp_mismatch_remains_ambiguous() -> None:
    json_result = parse_exporter_json(
        _json(messages=[{"role": "Prompt", "say": "JSON is canonical", "time": "2026-07-01 10:00:00"}])
    )
    markdown = """# Social training

## Prompt:
2026-07-01 10:02:00

Different Markdown validation text
"""

    result = align_exporter_sources(json_result, parse_exporter_markdown(markdown))

    assert result.alignment_status == "conflict_detected"
    assert result.conversation is not None
    assert result.conversation.messages[0].alignment_status == "json_only"
    assert {issue["reason"] for issue in result.conversation.alignment_issues} == {"unmatched"}


def test_trailing_empty_json_messages_do_not_block_structural_pairing() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {"role": "Prompt", "say": "Can you help?", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "Yes, I can.", "time": "2026-07-01 10:01:00"},
                {"role": "Prompt", "say": "", "time": "2026-07-01 10:02:00"},
            ]
        )
    )

    result = align_exporter_sources(json_result, parse_exporter_markdown(_markdown()))

    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert result.conversation.message_count == 2
    assert result.conversation.empty_message_count == 1
    assert {message.alignment_status for message in result.conversation.messages} == {"exact"}


def test_title_or_link_conflict_detected() -> None:
    result = align_exporter_sources(
        parse_exporter_json(_json(title="A", link="https://chatgpt.com/c/a")),
        parse_exporter_markdown(_markdown(title="B", link="https://chatgpt.com/c/b")),
    )

    assert result.alignment_status == "conflict_detected"


def test_markdown_v2_markers_preserve_body_and_ignore_fenced_fake_markers() -> None:
    markdown = '''---
format: "chat-reader-markdown-export"
version: 2
---

# Marker fixture

<!-- chat-reader-message
id: "message-1"
role: "user"
order_key: "000001"
created_at: "2026-07-01T10:00:00Z"
-->

## User · 000001

Keep this body.

```markdown
<!-- chat-reader-message
role: "assistant"
-->
## Response:
```

<!-- /chat-reader-message -->
'''

    result = parse_exporter_markdown(markdown)

    assert result.section_count == 1
    assert result.sections[0].role == "user"
    assert result.sections[0].time == "2026-07-01T10:00:00Z"
    assert result.sections[0].markdown_text == '''Keep this body.

```markdown
<!-- chat-reader-message
role: "assistant"
-->
## Response:
```'''


def test_exporter_boundaries_survive_an_unclosed_fence_and_ignore_untimed_examples() -> None:
    markdown = """# Fence fixture

## Prompt:
2026-07-01 10:00:00

Opening message.

```markdown
## Prompt:
This heading is an example without an exported timestamp.

## Response:
2026-07-01 10:01:00

The real response follows an intentionally unclosed fence.

## Prompt:
2026-07-01 10:02:00

The next real prompt is still detected.
"""

    result = parse_exporter_markdown(markdown)

    assert result.section_count == 3
    assert [section.role for section in result.sections] == ["user", "assistant", "user"]
    assert [section.time for section in result.sections] == [
        "2026-07-01 10:00:00",
        "2026-07-01 10:01:00",
        "2026-07-01 10:02:00",
    ]


def test_json_context_keeps_timed_prompt_examples_inside_markdown_body() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {
                    "role": "Prompt",
                    "say": "Explain this example.\n\n## Response\n2026-07-01 10:01:00\n\nExample only.",
                    "time": "2026-07-01 10:00:00",
                },
                {
                    "role": "Response",
                    "say": "The actual answer.",
                    "time": "2026-07-01 10:02:00",
                },
            ]
        )
    )
    markdown = """# Social training

## Prompt:
2026-07-01 10:00:00

Explain this example.

```markdown
## Response
2026-07-01 10:01:00

Example only.
```

## Response:
2026-07-01 10:02:00

The actual answer.
"""

    markdown_result = parse_exporter_markdown(markdown, json_result.messages)
    result = align_exporter_sources(json_result, markdown_result)

    assert markdown_result.section_count == 2
    assert "## Response" in markdown_result.sections[0].markdown_text
    assert result.alignment_status == "exact_match"
    assert result.conversation is not None
    assert [message.display_source for message in result.conversation.messages] == ["markdown", "markdown"]
    assert any("Ignored 1 embedded" in warning for warning in result.warnings)


def test_json_context_uses_unique_best_path_for_repeated_role_and_time() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {
                    "role": "Prompt",
                    "say": "Actual opening\n\n## Prompt\n2026-07-01 10:00:00\n\nEmbedded duplicate",
                    "time": "2026-07-01 10:00:00",
                },
                {"role": "Response", "say": "Actual answer", "time": "2026-07-01 10:01:00"},
            ]
        )
    )
    markdown = """# Social training

## Prompt:
2026-07-01 10:00:00

Actual opening

## Prompt:
2026-07-01 10:00:00

Embedded duplicate

## Response:
2026-07-01 10:01:00

Actual answer
"""

    markdown_result = parse_exporter_markdown(markdown, json_result.messages)
    result = align_exporter_sources(json_result, markdown_result)

    assert markdown_result.section_count == 2
    assert markdown_result.sections[0].markdown_text.startswith("Actual opening")
    assert "Embedded duplicate" in markdown_result.sections[0].markdown_text
    assert result.alignment_status == "exact_match"


def test_json_context_does_not_use_an_incomplete_timestamp_sequence() -> None:
    json_result = parse_exporter_json(
        _json(
            messages=[
                {"role": "Prompt", "say": "Opening", "time": "2026-07-01 10:00:00"},
                {"role": "Response", "say": "Missing response", "time": "2026-07-01 10:09:00"},
            ]
        )
    )

    markdown_result = parse_exporter_markdown(_markdown(), json_result.messages)
    result = align_exporter_sources(json_result, markdown_result)

    assert result.alignment_status == "conflict_detected"
    assert result.conversation is not None
    assert any(message.alignment_status == "json_only" for message in result.conversation.messages)
    assert result.conversation.alignment_issues


def test_markdown_preview_preserves_lines_and_closes_a_truncated_fence() -> None:
    preview = preview_markdown("## Heading\n\n```python\n" + ("x" * 400), limit=80)

    assert preview.startswith("## Heading\n\n```python\n")
    assert preview.endswith("```\n\n...")
