from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class RenderBlockRead(BaseModel):
    id: UUID
    block_index: int
    block_type: str
    plain_text: str | None
    data: dict
    char_count: int
    collapsed_by_default: bool
    render_priority: int


class MessageVersionRead(BaseModel):
    id: UUID
    version_number: int
    plain_text: str
    display_text: str
    blocks: list[dict] = Field(default_factory=list)
    edit_type: str
    created_at: datetime
    created_by: str
    content_hash: str
    normalizer_version: str = "legacy-v1"
    markdown_parser_version: str = "legacy-v1"
    block_builder_version: str = "legacy-v1"
    search_document_version: str = "legacy-v1"


class MessageListItem(BaseModel):
    id: UUID
    conversation_id: UUID
    role: str
    order_key: str
    turn_index: int | None
    created_at: datetime | None
    current_version: MessageVersionRead | None
    render_blocks: list[RenderBlockRead] = Field(default_factory=list)
    block_count: int = 0
    char_count: int = 0
    is_heavy: bool = False
    ordinal: int | None = None
    content_preview: str | None = None
    content_truncated: bool = False


class ReaderTurnResponse(BaseModel):
    """Complete, stable reader unit; end_offset is exclusive."""

    conversation_id: UUID
    turn_key: str
    start_offset: int
    end_offset: int
    total_messages: int
    items: list[MessageListItem] = Field(default_factory=list)
    previous_anchor_message_id: UUID | None = None
    next_anchor_message_id: UUID | None = None


class LocatorTargetRequest(BaseModel):
    message_id: UUID
    message_version_id: UUID | None = None
    render_block_id: UUID | None = None
    block_index: int | None = Field(default=None, ge=0)
    occurrence_key: str | None = None
    attachment_id: UUID | None = None
    canonical_start: int | None = Field(default=None, ge=0)
    canonical_end: int | None = Field(default=None, ge=0)
    quote: str | None = None
    prefix: str | None = None
    suffix: str | None = None


class ResolvedLocatorResponse(BaseModel):
    conversation_id: UUID
    status: Literal["EXACT", "REMAPPED_VERSION", "MESSAGE_ONLY", "STALE", "AMBIGUOUS", "NOT_FOUND"]
    message_id: UUID | None = None
    message_version_id: UUID | None = None
    render_block_id: UUID | None = None
    block_index: int | None = None
    start_offset: int | None = None
    end_offset: int | None = None
    reason: str | None = None
    fallback_kind: str | None = None


class DialogueIndexItem(BaseModel):
    message_id: UUID
    role: str
    role_number: int
    ordinal: int
    order_key: str
    turn_index: int | None
    preview: str


class DialogueIndexResponse(BaseModel):
    conversation_id: UUID
    items: list[DialogueIndexItem]
    message_count: int
    turn_count: int
    limit: int = 80
    offset: int = 0
    total: int = 0
    has_previous: bool = False
    has_more: bool = False


class MessageDetail(MessageListItem):
    source_refs: list[dict] = Field(default_factory=list)
