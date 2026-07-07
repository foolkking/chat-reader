import re
from dataclasses import dataclass


@dataclass(frozen=True)
class RenderBlockDraft:
    block_type: str
    plain_text: str | None
    data: dict
    char_count: int
    collapsed_by_default: bool = False
    render_priority: int = 0


FENCE_RE = re.compile(r"^```(?P<language>[A-Za-z0-9_-]*)\s*$")
HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")


def build_basic_render_blocks(display_text: str) -> list[RenderBlockDraft]:
    if not display_text.strip():
        return []

    blocks: list[RenderBlockDraft] = []
    paragraph_lines: list[str] = []
    code_lines: list[str] = []
    in_code = False
    code_language = ""

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
                )
            )

    for line in display_text.splitlines():
        fence = FENCE_RE.match(line.strip())
        if fence:
            if in_code:
                code_text = "\n".join(code_lines)
                blocks.append(
                    RenderBlockDraft(
                        block_type="code",
                        plain_text=code_text,
                        data={"language": code_language, "code": code_text},
                        char_count=len(code_text),
                        render_priority=1,
                    )
                )
                code_lines = []
                code_language = ""
                in_code = False
            else:
                flush_paragraph()
                in_code = True
                code_language = fence.group("language") or ""
            continue

        if in_code:
            code_lines.append(line)
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
        blocks.append(
            RenderBlockDraft(
                block_type="code",
                plain_text=code_text,
                data={"language": code_language, "code": code_text, "closed": False},
                char_count=len(code_text),
                render_priority=1,
            )
        )

    flush_paragraph()
    return blocks
