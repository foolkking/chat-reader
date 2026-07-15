import re
import shlex
from dataclasses import dataclass


@dataclass(frozen=True)
class RenderBlockDraft:
    block_type: str
    plain_text: str | None
    data: dict
    char_count: int
    collapsed_by_default: bool = False
    render_priority: int = 0


FENCE_OPEN_RE = re.compile(r"^(?P<marker>`{3,}|~{3,})(?P<info>.*)$")
HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
THINKING_RE = re.compile(
    r"^\s*(?:>\s*)?(?:已思考|思考了|思考)\s*"
    r"(?:(?:\d+\s*(?:h|hr|hour|小时)\s*)?"
    r"(?:\d+\s*(?:m|min|分钟|分)\s*)?"
    r"\d+\s*(?:s|sec|秒))\s*$|"
    r"^\s*(?:>\s*)?(?:思考|思考过程|Thinking|Reasoning)\s*[:：]\s*$",
    re.IGNORECASE,
)


def build_basic_render_blocks(display_text: str) -> list[RenderBlockDraft]:
    if not display_text.strip():
        return []

    blocks: list[RenderBlockDraft] = []
    paragraph_lines: list[str] = []
    code_lines: list[str] = []
    in_code = False
    code_language = ""
    code_metadata: dict[str, str] = {}
    fence_character = ""
    fence_length = 0

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        text = "\n".join(paragraph_lines).strip()
        paragraph_lines.clear()
        if text:
            blocks.append(
                RenderBlockDraft(
                    block_type="paragraph",
                    plain_text=text,
                    data={"text": text},
                    char_count=len(text),
                    collapsed_by_default=_looks_like_thinking_block(text),
                )
            )

    for line in display_text.splitlines():
        stripped = line.strip()
        if in_code:
            if _is_closing_fence(stripped, fence_character, fence_length):
                code_text = "\n".join(code_lines)
                data = {"language": code_language, "code": code_text}
                if code_metadata:
                    data["metadata"] = code_metadata
                blocks.append(
                    RenderBlockDraft(
                        block_type="code",
                        plain_text=code_text,
                        data=data,
                        char_count=len(code_text),
                        render_priority=1,
                    )
                )
                code_lines = []
                code_language = ""
                code_metadata = {}
                fence_character = ""
                fence_length = 0
                in_code = False
                continue
            code_lines.append(line)
            continue

        fence = FENCE_OPEN_RE.match(stripped)
        if fence:
            flush_paragraph()
            marker = fence.group("marker")
            code_language, code_metadata = _parse_info_string(fence.group("info"))
            fence_character = marker[0]
            fence_length = len(marker)
            in_code = True
            continue

        heading = HEADING_RE.match(line)
        if heading:
            flush_paragraph()
            title = heading.group(2).strip()
            blocks.append(
                RenderBlockDraft(
                    block_type="heading",
                    plain_text=title,
                    data={"level": len(heading.group(1)), "title": title},
                    char_count=len(title),
                    render_priority=2,
                )
            )
            continue

        if line.strip():
            paragraph_lines.append(line)
        else:
            flush_paragraph()

    if in_code:
        code_text = "\n".join(code_lines)
        data = {"language": code_language, "code": code_text, "closed": False}
        if code_metadata:
            data["metadata"] = code_metadata
        blocks.append(
            RenderBlockDraft(
                block_type="code",
                plain_text=code_text,
                data=data,
                char_count=len(code_text),
                render_priority=1,
            )
        )

    flush_paragraph()
    return blocks


def _looks_like_thinking_block(text: str) -> bool:
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    return bool(THINKING_RE.match(first_line.strip()))


def _is_closing_fence(line: str, character: str, minimum_length: int) -> bool:
    if not line or line[0] != character:
        return False
    marker_length = len(line) - len(line.lstrip(character))
    return marker_length >= minimum_length and not line[marker_length:].strip()


def _parse_info_string(info: str) -> tuple[str, dict[str, str]]:
    raw = info.strip()
    if not raw:
        return "", {}
    try:
        tokens = shlex.split(raw)
    except ValueError:
        tokens = raw.split()
    if not tokens:
        return "", {}

    language = tokens[0].strip().lower()
    metadata: dict[str, str] = {}
    for token in tokens[1:]:
        if "=" not in token:
            continue
        key, value = token.split("=", 1)
        if key and value:
            metadata[key] = value
    return language, metadata
