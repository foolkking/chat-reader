import re
from dataclasses import dataclass, field

from app.services.import_pipeline.canonical_draft import content_hash, normalize_text
from app.services.import_pipeline.exporter_json_parser import extract_conversation_id

SECTION_RE = re.compile(r"^##\s*(Prompt|Response)\s*:?\s*$", re.IGNORECASE | re.MULTILINE)
METADATA_RE = re.compile(r"^(Created|Updated|Exported|Link):\s*(.*?)\s*$", re.IGNORECASE | re.MULTILINE)
TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?")


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


def parse_exporter_markdown(content: bytes | str) -> ExporterMarkdownParseResult:
    warnings: list[str] = []
    text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else content
    title = _extract_title(text)
    metadata = _extract_metadata(text)
    matches = list(SECTION_RE.finditer(text))

    if not matches:
        warnings.append("No Prompt/Response sections found.")

    sections: list[ExporterMarkdownSection] = []
    prompt_count = 0
    response_count = 0
    empty_count = 0

    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        source_heading = match.group(1)
        markdown_text = text[start:end].strip()
        section_time, markdown_body = _split_time_from_body(markdown_text)
        plain_text = _plain_text(markdown_body)
        role = _map_heading(source_heading)
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
                content_hash=content_hash(plain_text),
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


def _extract_title(text: str) -> str | None:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip() or None
    return None


def _extract_metadata(text: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    first_section = SECTION_RE.search(text)
    header = text[: first_section.start()] if first_section else text[:2000]
    for match in METADATA_RE.finditer(header):
        metadata[match.group(1).lower()] = match.group(2).strip()
    return metadata


def _split_time_from_body(markdown_text: str) -> tuple[str | None, str]:
    lines = markdown_text.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if TIME_RE.match(stripped):
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
