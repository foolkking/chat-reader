import hashlib
import re
from dataclasses import dataclass, field

PARSER_VERSION = "chat-reader-import-v5"
NORMALIZER_VERSION = "markdown-normalizer-v2"
MARKDOWN_PARSER_VERSION = "markdown-parser-v5"
BLOCK_BUILDER_VERSION = "render-block-builder-v3"
SEARCH_DOCUMENT_VERSION = "search-document-v2"


@dataclass(frozen=True)
class CanonicalDraftVersion:
    source_id: str | None
    version_number: int
    display_text: str
    plain_text: str
    content_hash: str
    edit_type: str = "imported"
    edit_reason: str | None = None
    created_at: str | None = None
    based_on_source_version_id: str | None = None

    @property
    def display_markdown(self) -> str:
        return self.display_text


@dataclass(frozen=True)
class CanonicalDraftMessage:
    role: str
    order_key: str
    turn_index: int | None
    created_at: str | None
    plain_text: str
    display_text: str
    content_hash: str
    source_json_index: int | None
    source_markdown_index: int | None
    display_source: str
    edit_type: str = "imported"
    warnings: list[str] = field(default_factory=list)
    alignment_status: str = "json_only"
    source_message_id: str | None = None
    source_current_version_id: str | None = None
    versions: list[CanonicalDraftVersion] = field(default_factory=list)

    @property
    def display_markdown(self) -> str:
        return self.display_text


@dataclass(frozen=True)
class CanonicalDraftConversation:
    title: str
    display_title: str
    source_type: str
    source_profile: str
    external_source_id: str | None
    created_at: str | None
    updated_at: str | None
    imported_at: str | None
    message_count: int
    turn_count: int
    first_user_message: str | None
    parser_version: str
    render_version: int
    warnings: list[str]
    alignment_status: str
    prompt_count: int
    response_count: int
    empty_message_count: int
    cleaned_thinking_summary_count: int
    messages: list[CanonicalDraftMessage]
    alignment_issues: list[dict] = field(default_factory=list)
    ignored_json_empty_count: int = 0
    ignored_markdown_empty_count: int = 0
    annotations: list[dict] = field(default_factory=list)
    notebooks: list[dict] = field(default_factory=list)
    source_refs: list[dict] = field(default_factory=list)
    attachments: list[dict] = field(default_factory=list)


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def content_hash(text: str, role: str | None = None) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = "\n".join(line.rstrip() for line in normalized.split("\n")).strip()
    payload = f"{NORMALIZER_VERSION}\n{role or ''}\n{normalized}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def preview_text(text: str, limit: int = 240) -> str:
    normalized = normalize_text(text)
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 1]}…"


def preview_markdown(text: str, limit: int = 4_000) -> str:
    """Return a bounded preview without flattening Markdown structure."""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(normalized) <= limit:
        return normalized

    boundary = normalized.rfind("\n\n", 0, limit)
    if boundary < limit // 3:
        boundary = normalized.rfind("\n", 0, limit)
    if boundary < limit // 3:
        boundary = limit
    preview = normalized[:boundary].rstrip()
    fence = _open_fence(preview)
    if fence is not None:
        preview = f"{preview}\n{fence}"
    return f"{preview}\n\n..."


def _open_fence(text: str) -> str | None:
    marker: str | None = None
    for line in text.splitlines():
        stripped = line.lstrip()
        if not stripped.startswith(("```", "~~~")):
            continue
        candidate = stripped[:3]
        if marker is None:
            marker = candidate
        elif candidate == marker:
            marker = None
    return marker
