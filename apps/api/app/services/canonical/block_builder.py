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


@dataclass(frozen=True)
class MarkdownTaskDraft:
    task_key: str
    checked: bool
    checked_offset: int
    label: str
    ordinal: int


FENCE_OPEN_RE = re.compile(r"^(?P<marker>`{3,}|~{3,})(?P<info>.*)$")
HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
ASSET_LINE_RE = re.compile(
    r'^\s*(?P<image>!)?\[(?P<label>[^\]]*)\]\(cr-asset://(?P<attachment_id>[A-Za-z0-9._:-]+)(?:\s+["\'][^"\']*["\'])?\)\s*$'
)
TASK_LINE_RE = re.compile(r"^(?P<prefix>\s*[-+*]\s+)\[(?P<checked>[ xX])\](?P<label>(?:\s+.*)?)$")
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
    paragraph_lines: list[tuple[str, int]] = []
    code_lines: list[str] = []
    in_code = False
    code_language = ""
    code_metadata: dict[str, str] = {}
    fence_character = ""
    fence_length = 0
    task_items = extract_markdown_tasks(display_text)

    def flush_paragraph() -> None:
        if not paragraph_lines:
            return
        paragraph_start = paragraph_lines[0][1]
        paragraph_end = paragraph_lines[-1][1] + len(paragraph_lines[-1][0])
        text = "\n".join(line for line, _ in paragraph_lines).strip()
        paragraph_lines.clear()
        if text:
            data: dict = {"text": text}
            paragraph_tasks = [
                {
                    "task_key": task.task_key,
                    "checked": task.checked,
                    "checked_offset": task.checked_offset,
                    "local_checked_offset": max(0, task.checked_offset - paragraph_start),
                    "label": task.label,
                    "ordinal": task.ordinal,
                }
                for task in task_items
                if paragraph_start <= task.checked_offset <= paragraph_end
            ]
            if paragraph_tasks:
                data["tasks"] = paragraph_tasks
            blocks.append(
                RenderBlockDraft(
                    block_type="paragraph",
                    plain_text=text,
                    data=data,
                    char_count=len(text),
                    collapsed_by_default=_looks_like_thinking_block(text),
                )
            )

    source_offset = 0
    for source_line in display_text.splitlines(keepends=True):
        line = source_line.rstrip("\r\n")
        line_start = source_offset
        source_offset += len(source_line)
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

        asset = ASSET_LINE_RE.match(line)
        if asset:
            flush_paragraph()
            attachment_id = asset.group("attachment_id")
            label = asset.group("label").strip()
            is_image = bool(asset.group("image"))
            blocks.append(
                RenderBlockDraft(
                    block_type="image" if is_image else "attachment",
                    plain_text=label or None,
                    data={
                        "attachmentId": attachment_id,
                        "displayMode": "inline" if is_image else "card",
                        "relationType": "inline" if is_image else "file",
                        "alt": label if is_image else "",
                        "caption": "" if is_image else label,
                    },
                    char_count=len(label),
                    render_priority=2 if is_image else 1,
                )
            )
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
            paragraph_lines.append((line, line_start))
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


def extract_markdown_tasks(display_text: str) -> list[MarkdownTaskDraft]:
    tasks: list[MarkdownTaskDraft] = []
    duplicate_counts: dict[str, int] = {}
    in_code = False
    fence_character = ""
    fence_length = 0
    source_offset = 0
    for source_line in display_text.splitlines(keepends=True):
        line = source_line.rstrip("\r\n")
        stripped = line.strip()
        if in_code:
            if _is_closing_fence(stripped, fence_character, fence_length):
                in_code = False
                fence_character = ""
                fence_length = 0
            source_offset += len(source_line)
            continue
        fence = FENCE_OPEN_RE.match(stripped)
        if fence:
            marker = fence.group("marker")
            in_code = True
            fence_character = marker[0]
            fence_length = len(marker)
            source_offset += len(source_line)
            continue
        task = TASK_LINE_RE.match(line)
        if task:
            label = task.group("label").strip()
            identity = re.sub(r"\s+", " ", label).strip()
            digest = _stable_task_digest(identity)
            occurrence = duplicate_counts.get(digest, 0) + 1
            duplicate_counts[digest] = occurrence
            tasks.append(
                MarkdownTaskDraft(
                    task_key=f"task-{digest}-{occurrence}",
                    checked=task.group("checked").lower() == "x",
                    checked_offset=source_offset + task.start("checked"),
                    label=label,
                    ordinal=len(tasks),
                )
            )
        source_offset += len(source_line)
    return tasks


def _stable_task_digest(value: str) -> str:
    digest = 2166136261
    for byte in value.encode("utf-8"):
        digest ^= byte
        digest = (digest * 16777619) & 0xFFFFFFFF
    return f"{digest:08x}"


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
