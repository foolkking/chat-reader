from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.message import MessageListItem


class SearchMatch(BaseModel):
    """Half-open Unicode code-point range in canonical RenderBlock.plain_text."""

    block_index: int | None = None
    render_block_id: UUID | None = None
    match_start: int
    match_end: int
    quote: str
    context_before: str = ""
    context_after: str = ""


class SearchResultItem(BaseModel):
    hit_count: int = 1
    project_name: str | None = None
    conversation_status: str = "active"
    document_id: UUID
    document_type: str
    conversation_id: UUID
    conversation_title: str
    message_id: UUID | None
    message_version_id: UUID | None = None
    role: str | None
    order_key: str | None
    block_index: int | None = None
    render_block_id: UUID | None = None
    character_offset: int | None = None
    snippet: str
    rank: float
    source_profile: str | None
    occurrence_count: int = 1
    matches_truncated: bool = False
    matches: list[SearchMatch] = Field(default_factory=list)
    attachment_id: UUID | None = None
    attachment_display_name: str | None = None
    annotation_id: UUID | None = None
    annotation_type: str | None = None
    annotation_color: str | None = None


class SearchResponse(BaseModel):
    query: str
    items: list[SearchResultItem]
    limit: int
    offset: int
    total: int
    has_more: bool = False
    total_is_exact: bool = True
    next_offset: int | None = None
    next_match_offset: int = 0
    next_document_id: UUID | None = None


class SearchReindexRequest(BaseModel):
    conversation_id: UUID | None = None


class SearchReindexResponse(BaseModel):
    conversation_count: int
    indexed_count: int
    heading_count: int


class MessageWindowResponse(BaseModel):
    items: list[MessageListItem]
    limit: int
    offset: int
    total: int
    has_previous: bool = False
    has_more: bool
