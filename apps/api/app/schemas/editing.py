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
