from dataclasses import dataclass, field
from difflib import SequenceMatcher

from app.services.import_pipeline.canonical_draft import (
    PARSER_VERSION,
    CanonicalDraftConversation,
    CanonicalDraftMessage,
    content_hash,
    normalize_text,
)
from app.services.import_pipeline.exporter_json_parser import ExporterJsonMessage, ExporterJsonParseResult
from app.services.import_pipeline.exporter_markdown_parser import (
    ExporterMarkdownParseResult,
    ExporterMarkdownSection,
    _has_semantic_markdown_structure,
    _paired_section_is_reliable,
)
from app.services.import_pipeline.thinking_cleaner import clean_thinking_summary


@dataclass(frozen=True)
class ExporterAlignmentResult:
    mode: str
    alignment_status: str
    conversation: CanonicalDraftConversation | None
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class _MessagePair:
    json_message: ExporterJsonMessage
    markdown_section: ExporterMarkdownSection
    alignment_status: str


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

    (
        messages,
        cleaned_count,
        empty_count,
        warnings,
        alignment_issues,
        ignored_json_empty_count,
        ignored_markdown_empty_count,
    ) = _messages_from_combo(json_result, markdown_result)
    conflict_warnings = _conflict_warnings(json_result, markdown_result)
    status = "conflict_detected" if conflict_warnings or alignment_issues else "exact_match"
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
        alignment_issues=alignment_issues,
        ignored_json_empty_count=ignored_json_empty_count,
        ignored_markdown_empty_count=ignored_markdown_empty_count,
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
) -> tuple[list[CanonicalDraftMessage], int, int, list[str], list[dict], int, int]:
    messages: list[CanonicalDraftMessage] = []
    warnings: list[str] = list(json_result.warnings) + list(markdown_result.warnings)
    cleaned_count = 0
    json_messages = [message for message in json_result.messages if not message.is_empty]
    markdown_sections = [section for section in markdown_result.sections if not section.is_empty]
    empty_json_messages = [message for message in json_result.messages if message.is_empty]
    empty_markdown_sections = [section for section in markdown_result.sections if section.is_empty]
    empty_count = json_result.empty_message_count + markdown_result.empty_message_count
    alignment_issues: list[dict] = []
    warnings.extend(f"Filtered empty JSON message at index {message.index}." for message in empty_json_messages)
    warnings.extend(f"Filtered empty Markdown section at index {section.index}." for section in empty_markdown_sections)

    pairs = _align_message_sequences(json_messages, markdown_sections)
    markdown_by_json_index = {pair.json_message.index: pair for pair in pairs}
    used_markdown_indexes = {pair.markdown_section.index for pair in pairs}

    for json_message in json_messages:
        pair = markdown_by_json_index.get(json_message.index)
        markdown_section = pair.markdown_section if pair is not None else None

        alignment_status = pair.alignment_status if pair is not None else "json_only"
        if alignment_status in {"ambiguous", "json_only"}:
            warnings.append(f"JSON message {json_message.index} could not be reliably paired with Markdown.")
            alignment_issues.append(_alignment_issue("json", json_message.index, json_message.role, json_message.time, "unmatched"))
        use_markdown = markdown_section is not None and alignment_status in {"exact", "normalized", "by_order"}
        source_text = markdown_section.markdown_text if use_markdown else json_message.text
        cleaned = clean_thinking_summary(json_message.role, source_text)
        if cleaned.removed:
            cleaned_count += 1
        display_text = cleaned.text
        plain_text = normalize_text(_strip_markdown_quotes(display_text))

        messages.append(
            _draft_message(
                json_message,
                markdown_section,
                plain_text,
                display_text,
                "markdown" if use_markdown else "json",
                cleaned.warnings,
                alignment_status,
            )
        )

    for markdown_section in markdown_sections:
        if markdown_section.index in used_markdown_indexes:
            continue
        warnings.append(f"Markdown section {markdown_section.index} has no JSON message and blocks commit.")
        alignment_issues.append(
            _alignment_issue(
                "markdown",
                markdown_section.index,
                markdown_section.role,
                markdown_section.time,
                "unmatched",
            )
        )

    _mark_content_mismatches(alignment_issues, json_messages, markdown_sections, pairs)

    return (
        messages,
        cleaned_count,
        empty_count,
        warnings,
        alignment_issues,
        json_result.empty_message_count,
        markdown_result.empty_message_count,
    )


def _result(
    mode: str,
    alignment_status: str,
    json_result: ExporterJsonParseResult | None,
    markdown_result: ExporterMarkdownParseResult | None,
    messages: list[CanonicalDraftMessage],
    cleaned_count: int,
    empty_count: int,
    warnings: list[str],
    *,
    alignment_issues: list[dict] | None = None,
    ignored_json_empty_count: int = 0,
    ignored_markdown_empty_count: int = 0,
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
        alignment_issues=alignment_issues or [],
        ignored_json_empty_count=ignored_json_empty_count,
        ignored_markdown_empty_count=ignored_markdown_empty_count,
    )
    return ExporterAlignmentResult(mode=mode, alignment_status=alignment_status, conversation=conversation, warnings=warnings)


def _draft_message(
    json_message: ExporterJsonMessage | None,
    markdown_section: ExporterMarkdownSection | None,
    plain_text: str,
    display_text: str,
    display_source: str,
    warnings: list[str],
    alignment_status: str | None = None,
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
        content_hash=content_hash(display_text, role),
        source_json_index=json_message.index if json_message else None,
        source_markdown_index=markdown_section.index if markdown_section else None,
        display_source=display_source,
        edit_type="auto_clean" if warnings else "imported",
        warnings=warnings,
        alignment_status=alignment_status or ("exact" if json_message and markdown_section else "json_only" if json_message else "markdown_only"),
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
                alignment_status=message.alignment_status,
                source_message_id=message.source_message_id,
                source_current_version_id=message.source_current_version_id,
                versions=message.versions,
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


def _alignment_status(
    json_message: ExporterJsonMessage,
    markdown_section: ExporterMarkdownSection | None,
) -> str:
    if markdown_section is None:
        return "json_only"
    if markdown_section.role != json_message.role:
        return "ambiguous"
    if json_message.time and markdown_section.time:
        if normalize_text(json_message.time) != normalize_text(markdown_section.time):
            return "ambiguous"
    markdown_text = _comparison_text(markdown_section.role, markdown_section.markdown_text)
    json_text = _comparison_text(json_message.role, json_message.text)
    if json_text == markdown_text:
        return "exact"
    if normalize_text(json_text) == normalize_text(markdown_text):
        return "normalized"
    if json_message.time and markdown_section.time:
        if _paired_section_is_reliable(
            json_message,
            markdown_section.markdown_text,
        ) or _has_semantic_markdown_structure(markdown_section.markdown_text):
            return "by_order"
    return "ambiguous"


def _align_message_sequences(
    json_messages: list[ExporterJsonMessage],
    markdown_sections: list[ExporterMarkdownSection],
) -> list[_MessagePair]:
    """Return a bounded monotonic best-effort mapping for diagnostics and display."""
    row_count = len(json_messages)
    column_count = len(markdown_sections)
    if not row_count or not column_count:
        return []

    direct_pairs = _unique_timestamp_pairs(json_messages, markdown_sections)
    if direct_pairs is not None:
        return direct_pairs

    # This is a message-level LCS, not a character diff. The established
    # importer budget already caps candidate work; retain the same bound here.
    if row_count * column_count > 250_000:
        from app.services.import_pipeline.exporter_markdown_parser import ExporterMarkdownPairingError

        raise ExporterMarkdownPairingError(
            "pairing_complexity_limit",
            "JSON/Markdown alignment exceeded its bounded comparison budget.",
        )

    scores = [[0] * (column_count + 1) for _ in range(row_count + 1)]
    choices = [[0] * column_count for _ in range(row_count)]
    status_scores = {"exact": 3, "normalized": 2, "by_order": 1}

    for row in range(row_count - 1, -1, -1):
        for column in range(column_count - 1, -1, -1):
            skip_json = scores[row + 1][column]
            skip_markdown = scores[row][column + 1]
            status = _alignment_status(json_messages[row], markdown_sections[column])
            match = -1
            if status in status_scores:
                match = 1_000_000 + status_scores[status] + scores[row + 1][column + 1]
            best = max(match, skip_json, skip_markdown)
            scores[row][column] = best
            # Prefer a reliable match, then advance JSON, for deterministic
            # diagnostics when an invalid input has several incomplete paths.
            choices[row][column] = 1 if match == best else 2 if skip_json == best else 3

    if scores[0][0] > 0 and _has_multiple_optimal_pairings(
        json_messages,
        markdown_sections,
        scores,
        status_scores,
    ):
        from app.services.import_pipeline.exporter_markdown_parser import ExporterMarkdownPairingError

        raise ExporterMarkdownPairingError(
            "pairing_ambiguous",
            "JSON/Markdown pairing has multiple equally reliable solutions.",
        )

    pairs: list[_MessagePair] = []
    row = 0
    column = 0
    while row < row_count and column < column_count:
        choice = choices[row][column]
        if choice == 1:
            status = _alignment_status(json_messages[row], markdown_sections[column])
            pairs.append(_MessagePair(json_messages[row], markdown_sections[column], status))
            row += 1
            column += 1
        elif choice == 2:
            row += 1
        else:
            column += 1
    return pairs


def _unique_timestamp_pairs(
    json_messages: list[ExporterJsonMessage],
    markdown_sections: list[ExporterMarkdownSection],
) -> list[_MessagePair] | None:
    """Pair unique role/timestamp identities in O(n), preserving gaps for diagnostics."""
    if any(not message.time for message in json_messages) or any(not section.time for section in markdown_sections):
        return None

    markdown_positions: dict[tuple[str, str], list[int]] = {}
    for position, section in enumerate(markdown_sections):
        key = (section.role, normalize_text(section.time or ""))
        markdown_positions.setdefault(key, []).append(position)

    pairs: list[_MessagePair] = []
    previous_position = -1
    seen_json_keys: set[tuple[str, str]] = set()
    for message in json_messages:
        key = (message.role, normalize_text(message.time or ""))
        if key in seen_json_keys:
            return None
        seen_json_keys.add(key)
        positions = markdown_positions.get(key, [])
        if len(positions) > 1:
            return None
        if not positions:
            continue
        position = positions[0]
        if position <= previous_position:
            return None
        status = _unique_timestamp_alignment_status(message, markdown_sections[position])
        if status in {"exact", "normalized", "by_order"}:
            pairs.append(_MessagePair(message, markdown_sections[position], status))
            previous_position = position
    return pairs


def _unique_timestamp_alignment_status(
    json_message: ExporterJsonMessage,
    markdown_section: ExporterMarkdownSection,
) -> str:
    """Validate an already unique identity with bounded text work.

    The role/timestamp key establishes the only possible pair. Content still
    guards against an unrelated companion file, but this path must not run the
    full Markdown/thinking cleaner over every multi-megabyte message twice.
    """
    json_text = json_message.text
    markdown_text = markdown_section.plain_text
    if json_text == markdown_text:
        return "exact"

    json_normalized = normalize_text(json_text)
    markdown_normalized = normalize_text(markdown_text)
    if json_normalized == markdown_normalized:
        return "normalized"
    shorter = min(len(json_normalized), len(markdown_normalized))
    longer = max(len(json_normalized), len(markdown_normalized))
    if shorter >= 40 and json_normalized[:40] == markdown_normalized[:40]:
        return "by_order"
    if _has_semantic_markdown_structure(markdown_section.markdown_text):
        return "by_order"
    if shorter and longer <= shorter * 2.5:
        similarity = SequenceMatcher(
            None,
            json_normalized[:1_000],
            markdown_normalized[:1_000],
            autojunk=False,
        ).ratio()
        if similarity >= 0.85:
            return "by_order"
    return "ambiguous"


def _has_multiple_optimal_pairings(
    json_messages: list[ExporterJsonMessage],
    markdown_sections: list[ExporterMarkdownSection],
    suffix_scores: list[list[int]],
    status_scores: dict[str, int],
) -> bool:
    row_count = len(json_messages)
    column_count = len(markdown_sections)
    prefix_scores = [[0] * (column_count + 1) for _ in range(row_count + 1)]
    for row in range(row_count):
        for column in range(column_count):
            best = max(prefix_scores[row][column + 1], prefix_scores[row + 1][column])
            status = _alignment_status(json_messages[row], markdown_sections[column])
            if status in status_scores:
                best = max(best, prefix_scores[row][column] + 1_000_000 + status_scores[status])
            prefix_scores[row + 1][column + 1] = best

    optimum = suffix_scores[0][0]
    optimal_pairs: set[tuple[int, int]] = set()
    for row in range(row_count):
        for column in range(column_count):
            status = _alignment_status(json_messages[row], markdown_sections[column])
            if status not in status_scores:
                continue
            total = (
                prefix_scores[row][column]
                + 1_000_000
                + status_scores[status]
                + suffix_scores[row + 1][column + 1]
            )
            if total == optimum:
                optimal_pairs.add((row, column))

    expected_pair_count = optimum // 1_000_000
    return len(optimal_pairs) > expected_pair_count


def _mark_content_mismatches(
    issues: list[dict],
    json_messages: list[ExporterJsonMessage],
    markdown_sections: list[ExporterMarkdownSection],
    pairs: list[_MessagePair],
) -> None:
    paired_json = {pair.json_message.index for pair in pairs}
    paired_markdown = {pair.markdown_section.index for pair in pairs}
    unmatched_json = [message for message in json_messages if message.index not in paired_json]
    unmatched_markdown = [section for section in markdown_sections if section.index not in paired_markdown]
    for message, section in zip(unmatched_json, unmatched_markdown):
        if message.role != section.role:
            continue
        json_time = normalize_text(message.time or "")
        markdown_time = normalize_text(section.time or "")
        if json_time and markdown_time and json_time != markdown_time:
            continue
        for issue in issues:
            if (
                issue["source"] == "json"
                and issue["source_index"] == message.index
                or issue["source"] == "markdown"
                and issue["source_index"] == section.index
            ):
                issue["reason"] = "content_mismatch"


def _alignment_issue(
    source: str,
    source_index: int,
    role: str,
    timestamp: str | None,
    reason: str,
) -> dict:
    return {
        "source": source,
        "source_index": source_index,
        "role": role,
        "timestamp": timestamp,
        "reason": reason,
    }


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
