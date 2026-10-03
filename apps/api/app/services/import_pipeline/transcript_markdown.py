"""Fixed reader for the shipped Normalizer's transcript profile; never executes Skills."""
from dataclasses import dataclass
import re


@dataclass(frozen=True)
class TranscriptMessage:
    role: str
    timestamp: str
    model: str | None
    body: str


@dataclass(frozen=True)
class Transcript:
    title: str
    metadata: dict[str, str]
    messages: list[TranscriptMessage]


_TIMESTAMP = re.compile(
    r"^(?:Unknown|\d{4}[/-]\d{1,2}[/-]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?|"
    r"\d{1,2}[/-]\d{1,2}[/-]\d{4}[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM))?)$", re.I)
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def parse_transcript(content: bytes | str) -> Transcript | None:
    text = content.decode("utf-8-sig") if isinstance(content, bytes) else content
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    # Gate by the complete distinctive header, not Prompt/Response keywords.
    if len(lines) < 8 or not lines[0].startswith("# ") or lines[1] != "" or not lines[2].startswith("**User:** "):
        return None
    metadata = {}
    for i, key in enumerate(("User", "Created", "Updated", "Exported", "Link"), 2):
        prefix = f"**{key}:** "
        if not lines[i].startswith(prefix) or not lines[i][len(prefix):].strip():
            raise ValueError("Incomplete transcript metadata header.")
        metadata[key.lower()] = lines[i][len(prefix):].rstrip()
    if lines[7] != "":
        raise ValueError("Transcript metadata requires a separator.")
    link = metadata["link"]
    if link != "N/A":
        match = re.fullmatch(r"\[([^\]]+)\]\(([^)]+)\)", link)
        if not match or match[1] != match[2]:
            raise ValueError("Transcript link label and target must match.")
        metadata["link"] = match[2]
    else:
        metadata.pop("link")
    starts = []
    fence = None
    fence_length = 0
    literal = None
    for i in range(8, len(lines)):
        line = lines[i]
        if literal:
            if re.search(rf"</{literal}\s*>", line, re.I):
                literal = None
            continue
        token = _FENCE.match(line)
        if token:
            if fence is None:
                fence, fence_length = token[1][0], len(token[1])
            elif token[1][0] == fence and len(token[1]) >= fence_length and not token[2].strip():
                fence = None
            continue
        if fence:
            continue
        html = re.match(r"^ {0,3}<(pre|code)(?:\s|>)", line, re.I)
        if html:
            if not re.search(rf"</{html[1]}\s*>", line, re.I):
                literal = html[1]
            continue
        if line not in {"## Prompt:", "## Response:"} or i + 2 >= len(lines):
            continue
        if lines[i - 1] != "" or lines[i + 2] != "":
            continue
        meta = lines[i + 1]
        timestamp, sep, model = meta.partition(" \u00b7 ") if line == "## Response:" else (meta, "", "")
        if not _TIMESTAMP.fullmatch(timestamp) or (line == "## Response:" and (not sep or not model.strip())):
            continue
        starts.append((i, "user" if line == "## Prompt:" else "assistant", timestamp, model or None))
    if not starts or starts[0][0] != 8:
        raise ValueError("Transcript has no valid first message boundary.")
    messages = []
    for pos, (start, role, timestamp, model) in enumerate(starts):
        end = starts[pos + 1][0] - 1 if pos + 1 < len(starts) else len(lines) - (lines[-1] == "")
        body = "\n".join(lines[start + 3:end])
        if not body.strip():
            raise ValueError("Transcript messages must have content.")
        messages.append(TranscriptMessage(role, timestamp, model, body))
    return Transcript(lines[0][2:], metadata, messages)
