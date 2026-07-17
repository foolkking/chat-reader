from uuid import UUID

from pydantic import BaseModel


class TocItem(BaseModel):
    id: UUID
    heading_index: int
    level: int
    text: str
    slug: str
    message_id: UUID
    message_order_key: str
    block_index: int


class TocResponse(BaseModel):
    conversation_id: UUID
    items: list[TocItem]
    limit: int = 200
    offset: int = 0
    total: int = 0
    has_more: bool = False
