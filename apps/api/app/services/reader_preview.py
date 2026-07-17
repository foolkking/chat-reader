import re


_LEADING_TIMESTAMP_RE = re.compile(
    r"^\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\s*$"
)
_THINKING_DURATION_RE = re.compile(
    r"^(?:已?\s*思考(?:了|过)?|thinking|reasoning)\s*[:：]?\s*"
    r"(?:\d+\s*(?:h|hr|hour|小时)\s*)?(?:\d+\s*(?:m|min|分钟|分)\s*)?\d+\s*(?:s|sec|秒)$",
    re.IGNORECASE,
)
_MARKDOWN_FENCE_RE = re.compile(r"^\s*(?:`{3,}|~{3,})")
_MARKDOWN_BLOCK_PREFIX_RE = re.compile(r"^\s*(?:#{1,6}\s+|>+\s*|[-+*]\s+|\d+[.)]\s+)")
_MARKDOWN_TASK_RE = re.compile(r"^\s*\[[ xX]\]\s+")
_MARKDOWN_LINKED_IMAGE_RE = re.compile(r"\[!\[([^\]]*)\]\([^)]*\)\]\([^)]*\)")
_MARKDOWN_LINK_RE = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MARKDOWN_STRONG_RE = re.compile(r"(\*\*|__|~~)(.+?)\1")
_MARKDOWN_EMPHASIS_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
_MARKDOWN_INLINE_CODE_RE = re.compile(r"`+([^`\n]+)`+")


def dialogue_preview(text: str) -> str:
    lines = text.replace("\r\n", "\n").split("\n")
    while lines and not lines[0].strip():
        lines.pop(0)
    if lines and _LEADING_TIMESTAMP_RE.match(lines[0].strip().lstrip(">").strip()):
        lines.pop(0)
    for index, line in enumerate(lines[:80]):
        if _THINKING_DURATION_RE.match(line.strip().lstrip(">").strip()):
            lines = lines[index + 1 :]
            break
    plain_lines: list[str] = []
    for line in lines:
        value = line.strip()
        if not value or _MARKDOWN_FENCE_RE.match(value) or re.fullmatch(r"[-*_]{3,}", value):
            continue
        while True:
            cleaned = _MARKDOWN_BLOCK_PREFIX_RE.sub("", value, count=1)
            if cleaned == value:
                break
            value = cleaned.strip()
        value = _MARKDOWN_TASK_RE.sub("", value)
        value = _MARKDOWN_LINKED_IMAGE_RE.sub(lambda match: match.group(1), value)
        value = _MARKDOWN_LINK_RE.sub(lambda match: match.group(1), value)
        value = _MARKDOWN_INLINE_CODE_RE.sub(lambda match: match.group(1), value)
        value = _MARKDOWN_STRONG_RE.sub(lambda match: match.group(2), value)
        value = _MARKDOWN_EMPHASIS_RE.sub(lambda match: match.group(1), value)
        value = value.strip().strip("|").strip()
        if value:
            plain_lines.append(value)
    preview = " ".join("\n".join(plain_lines).split())[:160]
    return preview or "打开消息查看正文"
