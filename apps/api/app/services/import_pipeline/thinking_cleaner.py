import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CleanedText:
    text: str
    removed: bool
    removed_text: str | None
    warnings: list[str] = field(default_factory=list)


MAX_SCAN_LINES = 80
MAX_SCAN_CHARS = 4000

_DURATION_RE = re.compile(
    r"^(?:(?:\u5df2\s*)?\u601d\u8003(?:\u4e86)?|thinking|reasoning)\s*[:\uff1a]?\s*"
    r"((?:\d+\s*(?:h|hr|hour|\u5c0f\u65f6)\s*)?"
    r"(?:\d+\s*(?:m|min|\u5206\u949f|\u5206)\s*)?"
    r"\d+\s*(?:s|sec|\u79d2))$",
    re.IGNORECASE,
)
_INLINE_DURATION_RE = re.compile(
    r"^(?:(?:\u5df2\s*)?\u601d\u8003(?:\u4e86)?|thinking|reasoning)\s*[:\uff1a]?\s*"
    r"(?P<duration>(?:\d+\s*(?:h|hr|hour|\u5c0f\u65f6)\s*)?"
    r"(?:\d+\s*(?:m|min|\u5206\u949f|\u5206)\s*)?"
    r"\d+\s*(?:s|sec|\u79d2))\s+(?P<answer>\S.*)$",
    re.IGNORECASE,
)
_LABEL_RE = re.compile(
    r"^(?:\u601d\u8003|\u601d\u8003\u8fc7\u7a0b|thinking|reasoning)\s*[:\uff1a]?\s*$",
    re.IGNORECASE,
)
_ANSWER_START_RE = re.compile(
    r"^(?:#{1,6}\s+\S+|(?:\u7b54\u6848|\u56de\u7b54|\u7ed3\u8bba|\u6700\u7ec8\u56de\u7b54|"
    r"\u6b63\u5f0f\u56de\u7b54|final answer|answer)\s*[:\uff1a])",
    re.IGNORECASE,
)
_TIMESTAMP_RE = re.compile(
    r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$"
)

_TOPIC_PREFIXES = (
    "\u8003\u8651",
    "\u5206\u6790",
    "\u6574\u7406",
    "\u641c\u7d22",
    "\u68c0\u7d22",
    "\u6d4f\u89c8",
    "\u67e5\u627e",
    "\u63d0\u70bc",
    "\u89c4\u5212",
    "\u603b\u7ed3",
)


def clean_thinking_summary(role: str, text: str) -> CleanedText:
    if role != "assistant" or not text.strip():
        return CleanedText(text=text, removed=False, removed_text=None)

    lines = text.replace("\r\n", "\n").split("\n")
    inline_marker = _find_inline_duration_marker_near_start(lines)
    if inline_marker is not None:
        marker_index, marker_text, answer = inline_marker
        removed_text = "\n".join([*lines[:marker_index], marker_text]).strip()
        cleaned = "\n".join([answer, *lines[marker_index + 1 :]]).lstrip()
        return CleanedText(
            text=cleaned,
            removed=True,
            removed_text=removed_text,
            warnings=["Removed leading exported thinking summary."],
        )

    marker_index = _find_opening_marker_index(lines)
    if marker_index is None:
        return CleanedText(text=text, removed=False, removed_text=None)

    removed_lines = lines[: marker_index + 1]
    kept_lines = lines[marker_index + 1 :]
    removed_text = "\n".join(removed_lines).strip()
    cleaned = "\n".join(kept_lines).lstrip()
    if not cleaned:
        return CleanedText(text=text, removed=False, removed_text=None)

    return CleanedText(
        text=cleaned,
        removed=True,
        removed_text=removed_text,
        warnings=["Removed leading exported thinking summary."],
    )


def _find_inline_duration_marker_near_start(lines: list[str]) -> tuple[int, str, str] | None:
    scanned_chars = 0
    for index, line in enumerate(lines[:MAX_SCAN_LINES]):
        normalized = _strip_quote(line).strip()
        scanned_chars += len(normalized)
        if scanned_chars > MAX_SCAN_CHARS:
            return None
        match = _INLINE_DURATION_RE.match(normalized)
        if match is None:
            continue
        meaningful = [_strip_quote(value).strip() for value in lines[:index] if _strip_quote(value).strip()]
        if len(meaningful) <= 1 and meaningful and not _looks_like_thinking_trace_line(meaningful[0]):
            return None
        marker_text = normalized[: match.start("answer")].strip()
        return index, marker_text, match.group("answer").strip()
    return None


def _find_opening_marker_index(lines: list[str]) -> int | None:
    duration_index = _find_duration_marker_near_start(lines)
    if duration_index is not None:
        return duration_index

    scanned_chars = 0
    prefix_line_count = 0
    for index, line in enumerate(lines[:MAX_SCAN_LINES]):
        raw = line.strip()
        normalized = _strip_quote(line).strip()
        scanned_chars += len(normalized)
        if scanned_chars > MAX_SCAN_CHARS:
            return None
        if not normalized:
            continue
        if _ANSWER_START_RE.match(normalized):
            return None
        if _DURATION_RE.match(normalized):
            return index if _prefix_lines_are_thinking_trace(lines[:index]) else None
        if _LABEL_RE.match(normalized):
            prefix_line_count += 1
            continue
        if _looks_like_thinking_trace_line(normalized) or (raw.startswith(">") and len(normalized) <= 180):
            prefix_line_count += 1
            continue
        if prefix_line_count == 0:
            return None
        return None
    return None


def _find_duration_marker_near_start(lines: list[str]) -> int | None:
    scanned_chars = 0
    for index, line in enumerate(lines[:MAX_SCAN_LINES]):
        normalized = _strip_quote(line).strip()
        scanned_chars += len(normalized)
        if scanned_chars > MAX_SCAN_CHARS:
            return None
        if _DURATION_RE.match(normalized):
            meaningful = [_strip_quote(value).strip() for value in lines[:index] if _strip_quote(value).strip()]
            if len(meaningful) <= 1 and meaningful and not _looks_like_thinking_trace_line(meaningful[0]):
                return None
            return index
    return None


def _prefix_lines_are_thinking_trace(lines: list[str]) -> bool:
    meaningful = [(line.strip(), _strip_quote(line).strip()) for line in lines if _strip_quote(line).strip()]
    if not meaningful:
        return True
    return all(
        _LABEL_RE.match(normalized)
        or _looks_like_thinking_trace_line(normalized)
        or (raw.startswith(">") and len(normalized) <= 180)
        for raw, normalized in meaningful
    )


def _looks_like_thinking_trace_line(line: str) -> bool:
    if _TIMESTAMP_RE.match(line):
        return True
    if any(line.startswith(prefix) for prefix in _TOPIC_PREFIXES) and len(line) <= 120:
        return True
    if line.startswith(("[", "- ", "* ")):
        return True
    if re.match(r"^\d+[.)]\s+", line):
        return True
    if "http://" in line or "https://" in line:
        return True
    if "](" in line:
        return True
    return False


def _strip_quote(line: str) -> str:
    stripped = line.strip()
    while stripped.startswith(">"):
        stripped = stripped[1:].strip()
    return stripped
