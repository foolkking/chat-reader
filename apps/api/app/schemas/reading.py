from datetime import datetime
from uuid import UUID
from typing import Literal
import json

from pydantic import BaseModel, Field, model_validator

from app.schemas.conversation import ConversationListItem
from app.schemas.user_feature_entries import UserFeatureEntryRead


class ReadingListProjectSummary(BaseModel):
    id: UUID
    name: str


class ReadingListSummaryItem(BaseModel):
    entry: UserFeatureEntryRead
    title: str | None
    projects: list[ReadingListProjectSummary]
    available: bool
    resume_available: bool
    last_read_at: datetime | None


class ReadingListSummaryResponse(BaseModel):
    items: list[ReadingListSummaryItem]
    counts: dict[Literal["unread", "read", "all"], int]
    total: int
    limit: int
    offset: int
    has_more: bool


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
    revision: int = 1


class ReadingPositionResponse(BaseModel):
    conversation_id: UUID
    position: ReadingPositionRead | None


class NewMessageRead(BaseModel):
    message_id: UUID
    order_key: str
    role: str
    preview: str


class ReadingContentChangesResponse(BaseModel):
    conversation_id: UUID
    baseline_available: bool
    baseline_captured_at: datetime | None = None
    new_message_count: int | None = None
    first_new_message_id: UUID | None = None
    items: list[NewMessageRead] = Field(default_factory=list)
    limit: int
    has_more: bool


class ReadingContentBaselineResponse(BaseModel):
    conversation_id: UUID
    captured_at: datetime
    message_count: int


class ReadingPositionSyncRequest(BaseModel):
    operation_id: UUID
    base_revision: int = Field(ge=0)
    position: ReadingPositionUpsert

    @model_validator(mode="after")
    def bounded_anchor(self):
        if len(json.dumps(self.position.anchor_data).encode()) > 64 * 1024:
            raise ValueError("Reading anchor exceeds 64 KiB.")
        return self


class ReadingPositionSyncResponse(BaseModel):
    operation_id: UUID
    status: Literal["applied", "conflict"]
    position: ReadingPositionRead


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
