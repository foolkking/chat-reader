from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.message import MessageDetail


class MessageEditRequest(BaseModel):
    display_text: str
    edit_reason: str | None = None
    base_version_id: UUID | None = None


class MessageEditResponse(BaseModel):
    message_id: UUID
    conversation_id: UUID
    previous_version_id: UUID | None
    current_version_id: UUID
    version_number: int
    message: MessageDetail
    warnings: list[str] = Field(default_factory=list)


class MessageVersionHistoryItem(BaseModel):
    id: UUID
    version_number: int
    plain_text: str
    display_text: str
    edit_type: str
    edit_reason: str | None
    created_at: datetime
    created_by: str
    based_on_version_id: UUID | None
    content_hash: str
    is_current: bool


class MessageVersionHistoryResponse(BaseModel):
    message_id: UUID
    current_version_id: UUID | None
    items: list[MessageVersionHistoryItem]


class MessageVersionRestoreRequest(BaseModel):
    edit_reason: str | None = None


class MessageSplitRequest(BaseModel):
    split_offset: int = Field(gt=0)
    edit_reason: str | None = None


class MessageSplitResponse(BaseModel):
    conversation_id: UUID
    original_message_id: UUID
    new_message_id: UUID
    original_version_id: UUID
    new_version_id: UUID


class MessageMergeRequest(BaseModel):
    message_ids: list[UUID] = Field(min_length=2)
    separator: str = "\n\n"
    edit_reason: str | None = None


class MessageMergeResponse(BaseModel):
    conversation_id: UUID
    survivor_message_id: UUID
    merged_message_ids: list[UUID]
    current_version_id: UUID
    version_number: int


class ConversationMergeRequest(BaseModel):
    conversation_ids: list[UUID] = Field(min_length=2)
    title: str | None = None
    project_id: UUID | None = None


class ConversationSplitRequest(BaseModel):
    start_message_id: UUID
    end_message_id: UUID | None = None
    title: str | None = None
    project_id: UUID | None = None


class ConversationTransformResponse(BaseModel):
    conversation_id: UUID
    title: str
    display_title: str
    message_count: int


class ConversationEventRead(BaseModel):
    id: UUID
    event_type: str
    target_message_id: UUID | None
    target_version_id: UUID | None
    payload: dict
    created_at: datetime
    created_by: str


class ConversationEventListResponse(BaseModel):
    items: list[ConversationEventRead]
    limit: int
    offset: int
    total: int
