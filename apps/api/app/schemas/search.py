from uuid import UUID

from pydantic import BaseModel

from app.schemas.message import MessageListItem


class SearchResultItem(BaseModel):
    document_id: UUID
    document_type: str
    conversation_id: UUID
    conversation_title: str
    message_id: UUID | None
    role: str | None
    order_key: str | None
    block_index: int | None = None
    character_offset: int | None = None
    snippet: str
    rank: float
    source_profile: str | None
    occurrence_count: int = 1
    annotation_id: UUID | None = None
    annotation_type: str | None = None
    annotation_color: str | None = None


class SearchResponse(BaseModel):
    query: str
    items: list[SearchResultItem]
    limit: int
    offset: int
    total: int


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
