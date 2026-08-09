import os
import time
from pathlib import Path

import pytest

from app.services.import_pipeline.exporter_json_parser import parse_exporter_json
from app.services.import_pipeline.exporter_markdown_parser import parse_exporter_markdown


def test_valid_exporter_markdown_parses_title_metadata_and_sections() -> None:
    result = parse_exporter_markdown(
        """# 社交训练

Created: 2026-07-01 10:00:00
Updated: 2026-07-01 10:10:00
Exported: 2026-07-01 10:20:00
Link: https://chatgpt.com/c/test-conversation-id

## Prompt:
2026-07-01 10:00:00

你可以教我提高社交能力吗？

## Response
2026-07-01 10:01:00

> 考虑提出的生活建议
> 思考了 13s

当然可以。
"""
    )

    assert result.title == "社交训练"
    assert result.created_at == "2026-07-01 10:00:00"
    assert result.external_conversation_id == "test-conversation-id"
    assert result.section_count == 2
    assert result.sections[0].role == "user"
    assert result.sections[1].role == "assistant"
    assert "当然可以。" in result.sections[1].markdown_text
    assert "思考了 13s" in result.sections[1].plain_text


def test_prompt_heading_without_colon_is_supported() -> None:
    result = parse_exporter_markdown(
        """# T

## Prompt
hello

## Response
hi
"""
    )

    assert result.prompt_count == 1
    assert result.response_count == 1


def test_real_paired_fixture_uses_bounded_fast_path() -> None:
    fixture_dir = os.getenv("CHAT_READER_E2E_FIXTURE_DIR")
    if not fixture_dir:
        pytest.skip("CHAT_READER_E2E_FIXTURE_DIR is not configured")
    root = Path(fixture_dir)
    json_files = sorted(root.glob("*.json"))
    markdown_files = sorted(root.glob("*.md"))
    if not json_files or not markdown_files:
        pytest.skip("paired JSON/Markdown fixture is unavailable")

    expected = parse_exporter_json(json_files[0].read_bytes())
    started = time.perf_counter()
    parsed = parse_exporter_markdown(markdown_files[0].read_bytes(), expected.messages)
    elapsed = time.perf_counter() - started

    assert len(expected.messages) == 398
    assert len(parsed.sections) == 398
    assert parsed.empty_message_count == 0
    assert elapsed < 10
