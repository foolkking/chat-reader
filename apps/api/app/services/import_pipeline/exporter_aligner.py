from dataclasses import dataclass, field

from app.services.import_pipeline.canonical_draft import (
    PARSER_VERSION,
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    content_hash,
    normalize_text,
)
from app.services.import_pipeline.exporter_json_parser import ExporterJsonMessage, ExporterJsonParseResult
from app.services.import_pipeline.exporter_markdown_parser import ExporterMarkdownParseResult, ExporterMarkdownSection
from app.services.import_pipeline.thinking_cleaner import clean_thinking_summary


@dataclass(frozen=True)
class ExporterAlignmentResult:
    mode: str
    alignment_status: str
    conversation: CanonicalDraftConversation | None
    warnings: list[str] = field(default_factory=list)


def align_exporter_sources(
    json_result: ExporterJsonParseResult | None,
    markdown_result: ExporterMarkdownParseResult | None,
) -> ExporterAlignmentResult:
    if json_result is None and markdown_result is None:
        return ExporterAlignmentResult(
            mode="failed",
            alignment_status="failed",
            conversation=None,
            warnings=["No ChatGPT Exporter JSON or Markdown source was provided."],
        )

    if json_result is not None and markdown_result is None:
        messages, cleaned_count, empty_count, warnings = _messages_from_json(json_result)
        return _result("json_only", "json_only", json_result, None, messages, cleaned_count, empty_count, warnings)

    if markdown_result is not None and json_result is None:
        messages, cleaned_count, empty_count, warnings = _messages_from_markdown(markdown_result)
        return _result("markdown_only", "markdown_only", None, markdown_result, messages, cleaned_count, empty_count, warnings)

    assert json_result is not None
    assert markdown_result is not None

    conflict_warnings = _conflict_warnings(json_result, markdown_result)
    if conflict_warnings:
        status = "conflict_detected"
    elif _is_exact_match(json_result, markdown_result):
        status = "exact_match"
    elif _has_partial_role_match(json_result, markdown_result):
        status = "partial_match"
    else:
        status = "failed"

    messages, cleaned_count, empty_count, warnings = _messages_from_combo(json_result, markdown_result)
    warnings = conflict_warnings + warnings
    return _result(
        "json_markdown_combo",
        status,
        json_result,
        markdown_result,
        messages,
        cleaned_count,
        empty_count,
        warnings,
    )


def _messages_from_json(
    json_result: ExporterJsonParseResult,
) -> tuple[list[CanonicalDraftMessage], int, int, list[str]]:
    messages: list[CanonicalDraftMessage] = []
    warnings: list[str] = list(json_result.warnings)
    cleaned_count = 0
    empty_count = json_result.empty_message_count

    for message in json_result.messages:
        if message.is_empty:
            warnings.append(f"Filtered empty JSON message at index {message.index}.")
            continue

        cleaned = clean_thinking_summary(message.role, message.text)
        if cleaned.removed:
            cleaned_count += 1
        text = cleaned.text
        messages.append(_draft_message(message, None, text, text, "json", cleaned.warnings))

    return messages, cleaned_count, empty_count, warnings


def _messages_from_markdown(
    markdown_result: ExporterMarkdownParseResult,
) -> tuple[list[CanonicalDraftMessage], int, int, list[str]]:
    messages: list[CanonicalDraftMessage] = []
    warnings: list[str] = list(markdown_result.warnings)
    cleaned_count = 0
    empty_count = markdown_result.empty_message_count

    for section in markdown_result.sections:
        if section.is_empty:
            warnings.append(f"Filtered empty Markdown section at index {section.index}.")
            continue

        cleaned = clean_thinking_summary(section.role, section.markdown_text)
        if cleaned.removed:
            cleaned_count += 1
        display_text = cleaned.text
        plain_text = normalize_text(_strip_markdown_quotes(display_text))
        messages.append(_draft_message(None, section, plain_text, display_text, "markdown", cleaned.warnings))

    return messages, cleaned_count, empty_count, warnings


def _messages_from_combo(
    json_result: ExporterJsonParseResult,
    markdown_result: ExporterMarkdownParseResult,
) -> tuple[list[CanonicalDraftMessage], int, int, list[str]]:
    messages: list[CanonicalDraftMessage] = []
    warnings: list[str] = list(json_result.warnings) + list(markdown_result.warnings)
    cleaned_count = 0
    empty_count = 0
    used_markdown: set[int] = set()

    for json_message in json_result.messages:
        markdown_section = _find_section_for_message(json_message, markdown_result.sections, used_markdown)
        if markdown_section is not None:
            used_markdown.add(markdown_section.index)

        json_empty = json_message.is_empty
        markdown_empty = markdown_section.is_empty if markdown_section else False
        if json_empty and (markdown_section is None or markdown_empty):
            empty_count += 1
            warnings.append(f"Filtered empty aligned message at JSON index {json_message.index}.")
            continue

        display_source = "markdown" if markdown_section and not markdown_empty else "json"
        display_text = markdown_section.markdown_text if display_source == "markdown" else json_message.text
        cleaned = clean_thinking_summary(json_message.role, display_text)
        if cleaned.removed:
            cleaned_count += 1
        display_text = cleaned.text
        plain_text = json_message.text if not json_empty else _strip_markdown_quotes(display_text)

        messages.append(
            _draft_message(
                json_message,
                markdown_section,
                plain_text,
                display_text,
                display_source,
                cleaned.warnings,
            )
        )

    for markdown_section in markdown_result.sections:
        if markdown_section.index in used_markdown:
            continue
        if markdown_section.is_empty:
            empty_count += 1
            warnings.append(f"Filtered empty unmatched Markdown section at index {markdown_section.index}.")
            continue
        cleaned = clean_thinking_summary(markdown_section.role, markdown_section.markdown_text)
        if cleaned.removed:
            cleaned_count += 1
        display_text = cleaned.text
        plain_text = normalize_text(_strip_markdown_quotes(display_text))
        messages.append(_draft_message(None, markdown_section, plain_text, display_text, "markdown", cleaned.warnings))

    return messages, cleaned_count, empty_count, warnings


def _result(
    mode: str,
    alignment_status: str,
    json_result: ExporterJsonParseResult | None,
    markdown_result: ExporterMarkdownParseResult | None,
    messages: list[CanonicalDraftMessage],
    cleaned_count: int,
    empty_count: int,
    warnings: list[str],
) -> ExporterAlignmentResult:
    title = _first_present(
        json_result.title if json_result else None,
        markdown_result.title if markdown_result else None,
        "Untitled import preview",
    )
    external_id = _first_present(
        json_result.external_conversation_id if json_result else None,
        markdown_result.external_conversation_id if markdown_result else None,
        None,
    )
    created_at = _first_present(json_result.created_at if json_result else None, markdown_result.created_at if markdown_result else None, None)
    updated_at = _first_present(json_result.updated_at if json_result else None, markdown_result.updated_at if markdown_result else None, None)
    imported_at = _first_present(json_result.exported_at if json_result else None, markdown_result.exported_at if markdown_result else None, None)

    prompt_count = sum(1 for message in messages if message.role == "user")
    response_count = sum(1 for message in messages if message.role == "assistant")
    first_user_message = next((message.plain_text for message in messages if message.role == "user"), None)

    conversation = CanonicalDraftConversation(
        title=title,
        display_title=title,
        source_type="chatgpt_exporter_combo" if mode == "json_markdown_combo" else f"chatgpt_exporter_{'json' if mode == 'json_only' else 'markdown'}",
        source_profile="chatgpt_exporter_combo" if mode == "json_markdown_combo" else f"chatgpt_exporter_{'json' if mode == 'json_only' else 'markdown'}",
        external_source_id=external_id,
        created_at=created_at,
        updated_at=updated_at,
        imported_at=imported_at,
        message_count=len(messages),
        turn_count=prompt_count,
        first_user_message=first_user_message,
        parser_version=PARSER_VERSION,
        render_version=1,
        warnings=warnings,
        alignment_status=alignment_status,
        prompt_count=prompt_count,
        response_count=response_count,
        empty_message_count=empty_count,
        cleaned_thinking_summary_count=cleaned_count,
        messages=_with_order(messages),
    )
    return ExporterAlignmentResult(mode=mode, alignment_status=alignment_status, conversation=conversation, warnings=warnings)


def _draft_message(
    json_message: ExporterJsonMessage | None,
    markdown_section: ExporterMarkdownSection | None,
    plain_text: str,
    display_text: str,
    display_source: str,
    warnings: list[str],
) -> CanonicalDraftMessage:
    role = json_message.role if json_message else (markdown_section.role if markdown_section else "unknown")
    created_at = json_message.time if json_message else (markdown_section.time if markdown_section else None)
    return CanonicalDraftMessage(
        role=role,
        order_key="",
        turn_index=None,
        created_at=created_at,
        plain_text=plain_text,
        display_text=display_text,
        content_hash=content_hash(plain_text),
        source_json_index=json_message.index if json_message else None,
        source_markdown_index=markdown_section.index if markdown_section else None,
        display_source=display_source,
        edit_type="auto_clean" if warnings else "imported",
        warnings=warnings,
    )


def _with_order(messages: list[CanonicalDraftMessage]) -> list[CanonicalDraftMessage]:
    ordered: list[CanonicalDraftMessage] = []
    turn_index = 0
    for index, message in enumerate(messages, start=1):
        if message.role == "user":
            turn_index += 1
        ordered.append(
            CanonicalDraftMessage(
                role=message.role,
                order_key=f"{index:06d}",
                turn_index=turn_index if message.role in {"user", "assistant"} else None,
                created_at=message.created_at,
                plain_text=message.plain_text,
                display_text=message.display_text,
                content_hash=message.content_hash,
                source_json_index=message.source_json_index,
                source_markdown_index=message.source_markdown_index,
                display_source=message.display_source,
                edit_type=message.edit_type,
                warnings=message.warnings,
            )
        )
    return ordered


def _conflict_warnings(json_result: ExporterJsonParseResult, markdown_result: ExporterMarkdownParseResult) -> list[str]:
    warnings: list[str] = []
    if json_result.external_conversation_id and markdown_result.external_conversation_id:
        if json_result.external_conversation_id != markdown_result.external_conversation_id:
            warnings.append("JSON and Markdown external conversation ids differ.")
    if json_result.title and markdown_result.title and normalize_text(json_result.title) != normalize_text(markdown_result.title):
        warnings.append("JSON and Markdown titles differ.")
    return warnings


def _is_exact_match(json_result: ExporterJsonParseResult, markdown_result: ExporterMarkdownParseResult) -> bool:
    if len(json_result.messages) != len(markdown_result.sections):
        return False
    json_roles = [message.role for message in json_result.messages]
    markdown_roles = [section.role for section in markdown_result.sections]
    if json_roles != markdown_roles:
        return False
    return all(
        _content_matches(message.text, _comparison_text(section.role, section.plain_text))
        for message, section in zip(json_result.messages, markdown_result.sections)
    )


def _has_partial_role_match(json_result: ExporterJsonParseResult, markdown_result: ExporterMarkdownParseResult) -> bool:
    json_roles = [message.role for message in json_result.messages]
    markdown_roles = [section.role for section in markdown_result.sections]
    return any(role in markdown_roles for role in json_roles)


def _find_section_for_message(
    json_message: ExporterJsonMessage,
    sections: list[ExporterMarkdownSection],
    used_markdown: set[int],
) -> ExporterMarkdownSection | None:
    for section in sections:
        if (
            section.index not in used_markdown
            and section.role == json_message.role
            and _content_matches(json_message.text, _comparison_text(section.role, section.plain_text))
        ):
            return section
    for section in sections:
        if section.index not in used_markdown and section.role == json_message.role:
            return section
    return None


def _content_matches(left: str, right: str) -> bool:
    left_normalized = normalize_text(left)
    right_normalized = normalize_text(right)
    if not left_normalized and not right_normalized:
        return True
    if left_normalized == right_normalized:
        return True
    return left_normalized[:40] == right_normalized[:40]


def _comparison_text(role: str, text: str) -> str:
    return clean_thinking_summary(role, text).text


def _strip_markdown_quotes(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(">"):
            stripped = stripped[1:].strip()
        lines.append(stripped)
    return "\n".join(lines).strip()


def _first_present(*values: str | None) -> str | None:
    for value in values:
        if value:
            return value
    return None
