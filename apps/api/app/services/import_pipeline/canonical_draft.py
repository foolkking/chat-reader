import hashlib
import re
from dataclasses import dataclass, field

PARSER_VERSION = "stage-02-exporter-preview"


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


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def content_hash(text: str) -> str:
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


def preview_text(text: str, limit: int = 240) -> str:
    normalized = normalize_text(text)
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[: limit - 1]}…"
