"""Conservative, source-coordinate detection; never called by import cleanup."""
import re
from dataclasses import dataclass, field
from itertools import islice


@dataclass(frozen=True)
class CleanedText:
    text: str
    removed: bool
    removed_text: str | None
    start_offset: int | None = None
    end_offset: int | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ThinkingSummary:
    end_offset: int
    duration: str


MAX_SCAN_LINES = 80
MAX_SCAN_CHARS = 8000
_DURATION = (
    r"(?:(?:已\s*)?思考(?:了)?|thinking|reasoning)\s*[:：]?\s*"
    r"(?P<duration>(?:\d+\s*(?:h|hr|hour|小时)\s*)?"
    r"(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒))"
)
_DURATION_RE = re.compile(rf"^{_DURATION}$", re.IGNORECASE)
_INLINE_DURATION_RE = re.compile(rf"^{_DURATION}[ \t]+(?P<answer>\S.*)$", re.IGNORECASE)
_LABEL_RE = re.compile(r"^(?:思考|思考过程|thinking|reasoning)\s*[:：]?\s*$", re.IGNORECASE)
_ANSWER_START_RE = re.compile(
    r"^(?:#{1,6}\s+\S+|(?:答案|回答|结论|最终回答|正式回答|final answer|answer)\s*[:：])",
    re.IGNORECASE,
)
_TIMESTAMP_RE = re.compile(
    r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$"
)
_TOPIC_PREFIXES = ("考虑", "分析", "整理", "搜索", "检索", "浏览", "查找", "提炼", "规划", "总结")


def find_opening_thinking_summary(text: str) -> ThinkingSummary | None:
    """Only an opening trace terminated by a duration qualifies.

    Ordinary prose, headings and code stop the scan immediately. A bare
    "Reasoning:" label is not sufficient. Keep the TypeScript display detector
    in sync via the shared synthetic regression corpus.
    """
    offset = scanned_chars = 0
    for source_match in islice(re.finditer(r"[^\r\n]*(?:\r\n|\r|\n|$)", text), MAX_SCAN_LINES):
        source_line = source_match.group(0)
        raw = source_line.rstrip("\r\n")
        normalized = _strip_quote(raw)
        scanned_chars += len(normalized)
        if scanned_chars > MAX_SCAN_CHARS:
            return None
        if normalized:
            if (
                _ANSWER_START_RE.match(normalized)
                or normalized.startswith(("```", "~~~"))
                or re.match(r"^(?: {4}|\t)", raw)
            ):
                return None
            duration = _DURATION_RE.fullmatch(normalized)
            inline = _INLINE_DURATION_RE.fullmatch(normalized)
            if duration:
                end = offset + len(source_line)
                while end < len(text) and text[end] in "\r\n":
                    end += 1
                return ThinkingSummary(end, duration.group("duration"))
            if inline:
                # The normalized line is an exact suffix without quote
                # prefixes or trailing whitespace; never search by content.
                normalized_start = len(raw.rstrip()) - len(normalized)
                end = offset + normalized_start + inline.start("answer")
                return ThinkingSummary(end, inline.group("duration"))
            if not _looks_like_trace_line(raw, normalized):
                return None
        offset += len(source_line)
    return None


def clean_thinking_summary(role: str, text: str) -> CleanedText:
    """Legacy name retained for explicit noise detection/preview projection.

    Import and automatic-maintenance paths must not use this returned text.
    """
    summary = find_opening_thinking_summary(text) if role == "assistant" else None
    if summary is None or not text[summary.end_offset:].strip():
        return CleanedText(text=text, removed=False, removed_text=None)
    return CleanedText(
        text=text[summary.end_offset:],
        removed=True,
        removed_text=text[:summary.end_offset],
        start_offset=0,
        end_offset=summary.end_offset,
    )


def _looks_like_trace_line(raw: str, line: str) -> bool:
    if _LABEL_RE.fullmatch(line) or _TIMESTAMP_RE.fullmatch(line):
        return True
    if raw.strip().startswith(">") and len(line) <= 180:
        return True
    if any(line.startswith(prefix) for prefix in _TOPIC_PREFIXES) and len(line) <= 120:
        return True
    return bool(
        line.startswith(("[", "- ", "* "))
        or re.match(r"^\d+[.)]\s+", line)
        or "http://" in line or "https://" in line or "](" in line
    )


def _strip_quote(line: str) -> str:
    stripped = line.strip()
    while stripped.startswith(">"):
        stripped = stripped[1:].strip()
    return stripped
