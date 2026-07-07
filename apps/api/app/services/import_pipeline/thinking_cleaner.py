import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CleanedText:
    text: str
    removed: bool
    removed_text: str | None
    warnings: list[str] = field(default_factory=list)


THINKING_DURATION_RE = re.compile(r"^(已?思考了?|思考)\s*\d+\s*(s|秒)$", re.IGNORECASE)
TOPIC_RE = re.compile(r"^(考虑|分析|整理).{0,40}$")


def clean_thinking_summary(role: str, text: str) -> CleanedText:
    if role != "assistant" or not text.strip():
        return CleanedText(text=text, removed=False, removed_text=None)

    lines = text.splitlines()
    leading: list[tuple[int, str, str]] = []
    saw_duration = False

    for index, line in enumerate(lines[:6]):
        normalized = _strip_quote(line).strip()
        if not normalized:
            if leading:
                leading.append((index, line, normalized))
            continue
        if THINKING_DURATION_RE.match(normalized):
            saw_duration = True
            leading.append((index, line, normalized))
            continue
        if TOPIC_RE.match(normalized):
            leading.append((index, line, normalized))
            continue
        break

    if not leading or not saw_duration:
        return CleanedText(text=text, removed=False, removed_text=None)

    last_removed_index = leading[-1][0]
    removed_text = "\n".join(line for _, line, _ in leading).strip()
    cleaned = "\n".join(lines[last_removed_index + 1 :]).lstrip()
    return CleanedText(
        text=cleaned,
        removed=True,
        removed_text=removed_text,
        warnings=["Removed leading exported thinking summary."],
    )


def _strip_quote(line: str) -> str:
    stripped = line.strip()
    while stripped.startswith(">"):
        stripped = stripped[1:].strip()
    return stripped
