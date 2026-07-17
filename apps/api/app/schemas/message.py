from datetime import datetime
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
