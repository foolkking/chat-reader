import json
import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

from app.services.import_pipeline.canonical_draft import content_hash, normalize_text
from app.services.import_pipeline.exporter_json_parser import ExporterJsonMessage, extract_conversation_id
from app.services.import_pipeline.thinking_cleaner import clean_thinking_summary

SECTION_RE = re.compile(r"^##\s*(Prompt|Response)\s*:?\s*$", re.IGNORECASE)
METADATA_RE = re.compile(r"^(Created|Updated|Exported|Link):\s*(.*?)\s*$", re.IGNORECASE | re.MULTILINE)
TIME_RE = re.compile(
    r"^(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?"
    r"|\d{4}/\d{1,2}/\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)$"
)


@dataclass(frozen=True)
class ExporterMarkdownSection:
    role: str
    source_heading: str
    time: str | None
    markdown_text: str
    plain_text: str
    index: int
    content_hash: str
    is_empty: bool


@dataclass(frozen=True)
class ExporterMarkdownParseResult:
    title: str | None
    metadata: dict[str, str]
    created_at: str | None
    updated_at: str | None
    exported_at: str | None
    link: str | None
    external_conversation_id: str | None
    sections: list[ExporterMarkdownSection]
    warnings: list[str] = field(default_factory=list)
    prompt_count: int = 0
    response_count: int = 0
    section_count: int = 0
    empty_message_count: int = 0


@dataclass(frozen=True)
class _SectionBoundary:
    start: int
    end: int
    heading: str


@dataclass(frozen=True)
class _MarkerSection:
    role: str
    heading: str
    time: str | None
    markdown_text: str


@dataclass(frozen=True)
class _HeadingCandidate:
    start: int
    end: int
    body_start: int
    heading: str
    role: str
    time: str | None


def parse_exporter_markdown(
    content: bytes | str,
    expected_messages: list[ExporterJsonMessage] | None = None,
) -> ExporterMarkdownParseResult:
    warnings: list[str] = []
    text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else content
    title = _extract_title(text)
    metadata = _extract_metadata(text)
    matches = _section_boundaries(text)
    marker_sections = _marker_message_sections(text)
    paired_sections: list[_MarkerSection] | None = None
    ignored_candidate_count = 0
    if not marker_sections and expected_messages is not None:
        paired_sections, ignored_candidate_count = _paired_message_sections(text, expected_messages)

    if not matches and not marker_sections and not paired_sections:
        warnings.append("No Prompt/Response sections found.")
    if paired_sections is not None and ignored_candidate_count:
        warnings.append(
            f"Ignored {ignored_candidate_count} embedded Prompt/Response heading candidates while reconstructing paired Markdown."
        )

    sections: list[ExporterMarkdownSection] = []
    prompt_count = 0
    response_count = 0
    empty_count = 0

    raw_sections = marker_sections or paired_sections or [
        _MarkerSection(
            role=_map_heading(match.heading),
            heading=match.heading,
            time=None,
            markdown_text=text[match.end : matches[index + 1].start if index + 1 < len(matches) else len(text)].strip(),
        )
        for index, match in enumerate(matches)
    ]
    for index, raw_section in enumerate(raw_sections):
        source_heading = raw_section.heading
        section_time, markdown_body = (
            (raw_section.time, raw_section.markdown_text)
            if raw_section.time is not None
            else _split_time_from_body(raw_section.markdown_text)
        )
        plain_text = _plain_text(markdown_body)
        role = raw_section.role
        is_empty = normalize_text(plain_text) == ""

        if role == "user":
            prompt_count += 1
        elif role == "assistant":
            response_count += 1
        if is_empty:
            empty_count += 1

        sections.append(
            ExporterMarkdownSection(
                role=role,
                source_heading=source_heading,
                time=section_time,
                markdown_text=markdown_body,
                plain_text=plain_text,
                index=index,
                content_hash=content_hash(markdown_body, role),
                is_empty=is_empty,
            )
        )

    link = metadata.get("link")
    return ExporterMarkdownParseResult(
        title=title,
        metadata=metadata,
        created_at=metadata.get("created"),
        updated_at=metadata.get("updated"),
        exported_at=metadata.get("exported"),
        link=link,
        external_conversation_id=extract_conversation_id(link),
        sections=sections,
        warnings=warnings,
        prompt_count=prompt_count,
        response_count=response_count,
        section_count=len(sections),
        empty_message_count=empty_count,
    )


def _paired_message_sections(
    text: str,
    expected_messages: list[ExporterJsonMessage],
) -> tuple[list[_MarkerSection] | None, int]:
    expected = [message for message in expected_messages if not message.is_empty]
    if not expected or any(message.time is None for message in expected):
        return None, 0

    candidates = _all_heading_candidates(text)
    candidate_indexes: list[list[int]] = []
    for message in expected:
        matches = [
            index
            for index, candidate in enumerate(candidates)
            if candidate.role == message.role
            and candidate.time is not None
            and normalize_text(candidate.time) == normalize_text(message.time or "")
        ]
        if not matches:
            return None, 0
        candidate_indexes.append(matches)

    states: list[dict[int, tuple[int, int | None, int]]] = [{} for _ in expected]
    last_index = len(expected) - 1
    for candidate_index in candidate_indexes[last_index]:
        candidate = candidates[candidate_index]
        states[last_index][candidate_index] = (
            _paired_section_score(expected[last_index], text[candidate.body_start :]),
            None,
            1,
        )
    for message_index in range(last_index - 1, -1, -1):
        for candidate_index in candidate_indexes[message_index]:
            candidate = candidates[candidate_index]
            best_score: int | None = None
            best_next: int | None = None
            best_count = 0
            for next_candidate_index, tail in states[message_index + 1].items():
                if next_candidate_index <= candidate_index:
                    continue
                total_score = _paired_section_score(
                    expected[message_index],
                    text[candidate.body_start : candidates[next_candidate_index].start],
                ) + tail[0]
                if best_score is None or total_score > best_score:
                    best_score = total_score
                    best_next = next_candidate_index
                    best_count = tail[2]
                elif total_score == best_score:
                    best_count = min(2, best_count + tail[2])
            if best_score is not None:
                states[message_index][candidate_index] = (best_score, best_next, best_count)

    overall_score: int | None = None
    first_candidate: int | None = None
    overall_count = 0
    for candidate_index, result in states[0].items():
        if overall_score is None or result[0] > overall_score:
            overall_score = result[0]
            first_candidate = candidate_index
            overall_count = result[2]
        elif result[0] == overall_score:
            overall_count = min(2, overall_count + result[2])

    if overall_score is None or first_candidate is None or overall_count != 1:
        return None, 0

    path: list[int] = []
    candidate_index: int | None = first_candidate
    for message_index in range(len(expected)):
        if candidate_index is None:
            return None, 0
        path.append(candidate_index)
        candidate_index = states[message_index][candidate_index][1]

    sections = []
    for index, candidate_index in enumerate(path):
        candidate = candidates[candidate_index]
        next_start = candidates[path[index + 1]].start if index + 1 < len(path) else len(text)
        markdown_text = text[candidate.body_start : next_start].strip()
        if not _paired_section_is_reliable(expected[index], markdown_text):
            return None, 0
        sections.append(
            _MarkerSection(
                role=candidate.role,
                heading=candidate.heading,
                time=candidate.time,
                markdown_text=markdown_text,
            )
        )
    return sections, len(candidates) - len(path)


def _all_heading_candidates(text: str) -> list[_HeadingCandidate]:
    lines = text.splitlines(keepends=True)
    offsets: list[int] = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)

    candidates: list[_HeadingCandidate] = []
    for index, line in enumerate(lines):
        match = SECTION_RE.match(line.strip())
        if match is None:
            continue
        time: str | None = None
        body_start = offsets[index] + len(line)
        for cursor in range(index + 1, min(index + 5, len(lines))):
            stripped = lines[cursor].strip()
            if not stripped:
                continue
            if TIME_RE.fullmatch(stripped):
                time = stripped
                body_start = offsets[cursor] + len(lines[cursor])
            break
        candidates.append(
            _HeadingCandidate(
                start=offsets[index],
                end=offsets[index] + len(line),
                body_start=body_start,
                heading=match.group(1),
                role=_map_heading(match.group(1)),
                time=time,
            )
        )
    return candidates


def _paired_section_score(message: ExporterJsonMessage, markdown_text: str) -> int:
    json_text, markdown_normalized = _paired_comparison_texts(message, markdown_text)
    if json_text == markdown_normalized:
        return 1_000_000

    prefix = 0
    for size, score in ((160, 300_000), (80, 200_000), (40, 120_000)):
        if len(json_text) >= size and len(markdown_normalized) >= size and json_text[:size] == markdown_normalized[:size]:
            prefix = score
            break
    comparison_length = 4_000
    similarity = SequenceMatcher(
        None,
        json_text[:comparison_length],
        markdown_normalized[:comparison_length],
        autojunk=False,
    ).ratio()
    length_penalty = min(100_000, abs(len(json_text) - len(markdown_normalized)) * 10)
    return prefix + round(similarity * 100_000) - length_penalty


def _paired_section_is_reliable(message: ExporterJsonMessage, markdown_text: str) -> bool:
    json_text, markdown_normalized = _paired_comparison_texts(message, markdown_text)
    if json_text == markdown_normalized:
        return True
    shorter = min(len(json_text), len(markdown_normalized))
    longer = max(len(json_text), len(markdown_normalized))
    if shorter == 0 or longer > shorter * 2.5:
        return False
    prefix_length = min(40, shorter)
    if prefix_length >= 16 and json_text[:prefix_length] == markdown_normalized[:prefix_length]:
        return True
    return SequenceMatcher(None, json_text[:4_000], markdown_normalized[:4_000], autojunk=False).ratio() >= 0.45


def _paired_comparison_texts(message: ExporterJsonMessage, markdown_text: str) -> tuple[str, str]:
    json_text = normalize_text(clean_thinking_summary(message.role, message.text).text)
    markdown_plain = _plain_text(clean_thinking_summary(message.role, markdown_text.strip()).text)
    return json_text, normalize_text(markdown_plain)


def _extract_title(text: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip() or None
    return None


def _extract_metadata(text: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    boundaries = _section_boundaries(text)
    header = text[: boundaries[0].start] if boundaries else text[:2000]
    for match in METADATA_RE.finditer(header):
        metadata[match.group(1).lower()] = match.group(2).strip()
    return metadata


def _split_time_from_body(markdown_text: str) -> tuple[str | None, str]:
    lines = markdown_text.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if TIME_RE.fullmatch(stripped):
            remaining = "\n".join(lines[index + 1 :]).strip()
            return stripped, remaining
        return None, markdown_text.strip()
    return None, ""


def _plain_text(markdown_text: str) -> str:
    lines = []
    for line in markdown_text.splitlines():
        stripped = line.strip()
        if stripped.startswith(">"):
            stripped = stripped[1:].strip()
        lines.append(stripped)
    return "\n".join(lines).strip()


def _map_heading(source_heading: str) -> str:
    normalized = source_heading.strip().lower()
    if normalized == "prompt":
        return "user"
    if normalized == "response":
        return "assistant"
    return "unknown"


def _section_boundaries(text: str) -> list[_SectionBoundary]:
    lines = text.splitlines(keepends=True)
    offsets: list[int] = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)

    boundaries: list[_SectionBoundary] = []
    fence_character: str | None = None
    fence_length = 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        match = SECTION_RE.match(stripped)
        if match is not None:
            next_content = next(
                (candidate.strip() for candidate in lines[index + 1 : index + 5] if candidate.strip()),
                "",
            )
            has_timestamp = TIME_RE.fullmatch(next_content) is not None
            if fence_character is None or has_timestamp:
                start = offsets[index]
                boundaries.append(_SectionBoundary(start, start + len(line), match.group(1)))
                fence_character = None
                fence_length = 0
                continue
        fence_character, fence_length, changed = _next_fence_state(
            stripped,
            fence_character,
            fence_length,
        )
        if changed:
            continue
    return boundaries


def _marker_message_sections(text: str) -> list[_MarkerSection]:
    lines = text.splitlines(keepends=True)
    offsets: list[int] = []
    offset = 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)
    sections: list[_MarkerSection] = []
    index = 0
    fence_character: str | None = None
    fence_length = 0
    while index < len(lines):
        stripped = lines[index].strip()
        fence_character, fence_length, changed = _next_fence_state(stripped, fence_character, fence_length)
        if changed:
            index += 1
            continue
        if fence_character is not None or stripped != "<!-- chat-reader-message":
            index += 1
            continue
        marker_end = index + 1
        metadata_lines: list[str] = []
        while marker_end < len(lines) and lines[marker_end].strip() != "-->":
            metadata_lines.append(lines[marker_end].strip())
            marker_end += 1
        if marker_end >= len(lines):
            break
        metadata = _marker_metadata(metadata_lines)
        body_start = offsets[marker_end] + len(lines[marker_end])
        cursor = marker_end + 1
        body_fence_character: str | None = None
        body_fence_length = 0
        while cursor < len(lines):
            body_stripped = lines[cursor].strip()
            body_fence_character, body_fence_length, fence_changed = _next_fence_state(
                body_stripped,
                body_fence_character,
                body_fence_length,
            )
            if not fence_changed and body_fence_character is None and body_stripped == "<!-- /chat-reader-message -->":
                break
            cursor += 1
        if cursor >= len(lines):
            break
        role = _marker_role(metadata.get("role"))
        body = _remove_generated_message_heading(
            text[body_start : offsets[cursor]].strip(),
            role,
            metadata.get("order_key"),
        )
        sections.append(
            _MarkerSection(
                role=role,
                heading=role,
                time=metadata.get("created_at"),
                markdown_text=body,
            )
        )
        index = cursor + 1
    return sections


def _next_fence_state(
    stripped: str,
    fence_character: str | None,
    fence_length: int,
) -> tuple[str | None, int, bool]:
    fence = re.match(r"^(`{3,}|~{3,})", stripped)
    if not fence:
        return fence_character, fence_length, False
    marker = fence.group(1)
    if fence_character is None:
        return marker[0], len(marker), True
    if marker[0] == fence_character and len(marker) >= fence_length:
        return None, 0, True
    return fence_character, fence_length, True


def _marker_metadata(lines: list[str]) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for line in lines:
        key, separator, raw_value = line.partition(":")
        if not separator or not key.strip():
            continue
        value = raw_value.strip()
        try:
            decoded = json.loads(value)
            if decoded is not None:
                metadata[key.strip()] = str(decoded)
        except json.JSONDecodeError:
            metadata[key.strip()] = value
    return metadata


def _marker_role(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"user", "prompt"}:
        return "user"
    if normalized in {"assistant", "response"}:
        return "assistant"
    return normalized or "unknown"


def _remove_generated_message_heading(body: str, role: str, order_key: str | None) -> str:
    lines = body.splitlines()
    first_content = next((index for index, line in enumerate(lines) if line.strip()), None)
    if first_content is None:
        return ""
    expected_role = role.title()
    expected_order = re.escape(order_key or "")
    heading_pattern = rf"^##\s+{re.escape(expected_role)}(?:\s*[·-]\s*{expected_order})?\s*$"
    if not re.match(heading_pattern, lines[first_content].strip(), re.IGNORECASE):
        return body
    remaining = lines[first_content + 1 :]
    while remaining and not remaining[0].strip():
        remaining.pop(0)
    return "\n".join(remaining).strip()
