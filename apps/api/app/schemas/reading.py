from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.conversation import ConversationListItem


class ReadingPositionUpsert(BaseModel):
    message_id: UUID | None = None
    block_index: int | None = None
    scroll_offset: int = 0
    anchor_data: dict = Field(default_factory=dict)


class ReadingPositionRead(BaseModel):
    id: UUID
    conversation_id: UUID
    message_id: UUID | None
    block_index: int | None
    scroll_offset: int
    anchor_data: dict
    updated_at: datetime
    created_at: datetime


class ReadingPositionResponse(BaseModel):
    conversation_id: UUID
    position: ReadingPositionRead | None


class RecentItemCreate(BaseModel):
    project_id: UUID | None = None
    last_message_id: UUID | None = None
    context: dict = Field(default_factory=dict)


class RecentItemRead(BaseModel):
    id: UUID
    conversation_id: UUID
    project_id: UUID | None
    last_message_id: UUID | None
    last_opened_at: datetime
    open_count: int
    context: dict
    conversation: ConversationListItem
