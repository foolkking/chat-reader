from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.attachment import MessageVersionAttachmentRead
from app.schemas.message import MessageDetail, MessageVersionRead, RenderBlockRead


class MessageAttachmentOccurrenceInput(BaseModel):
    occurrence_key: str = Field(min_length=1, max_length=255)
    attachment_id: UUID
    placement: Literal["inline", "after_message"] = "inline"
    display_order: int = Field(default=0, ge=0)
    alt_text: str | None = None


class RemovedAttachmentActionInput(BaseModel):
    attachment_id: UUID
    action: Literal["keep_in_conversation", "detach_from_conversation"]


class MessageEditRequest(BaseModel):
    content_markdown: str | None = None
    display_text: str | None = None
    edit_reason: str | None = None
    base_version_id: UUID | None = None
    save_mode: Literal["create_version", "replace_current"] = "create_version"
    upload_item_ids: list[UUID] = Field(default_factory=list)
    attachment_occurrences: list[MessageAttachmentOccurrenceInput] = Field(default_factory=list)
    removed_attachment_actions: list[RemovedAttachmentActionInput] = Field(default_factory=list)

    def text_value(self) -> str:
        value = self.content_markdown if self.content_markdown is not None else self.display_text
        if value is None:
            raise ValueError("content_markdown is required.")
        return value


class MessageEditResponse(BaseModel):
    message_id: UUID
    conversation_id: UUID
    previous_version_id: UUID | None
    current_version_id: UUID
    version_number: int
    message: MessageDetail
    message_version: MessageVersionRead
    render_blocks: list[RenderBlockRead] = Field(default_factory=list)
    attachment_occurrences: list[MessageVersionAttachmentRead] = Field(default_factory=list)
    conversation_attachment_summary: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class MessageDeleteResponse(BaseModel):
    message_id: UUID
    conversation_id: UUID
    deleted: bool
    message: MessageDetail


class MessageTaskToggleRequest(BaseModel):
    base_version_id: UUID
    checked: bool


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
    is_initial: bool
    can_delete: bool


class MessageVersionSelectRequest(BaseModel):
    version_id: UUID


class MessageVersionDeleteResponse(BaseModel):
    message_id: UUID
    deleted_version_id: UUID
    current_version_id: UUID
    message: MessageDetail
    warnings: list[str] = Field(default_factory=list)


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


class ConversationSplitWorkspaceRequest(BaseModel):
    mode: Literal["range_copy", "boundary_copy", "discrete_copy"]
    start_message_id: UUID | None = None
    end_message_id: UUID | None = None
    boundary_message_id: UUID | None = None
    message_ids: list[UUID] = Field(default_factory=list)
    titles: list[str] = Field(default_factory=list, max_length=2)
    project_id: UUID | None = None


class ConversationSplitGroupPreview(BaseModel):
    message_ids: list[UUID]
    message_count: int
    suggested_title: str


class ConversationSplitWorkspacePreview(BaseModel):
    mode: str
    groups: list[ConversationSplitGroupPreview]


class ConversationSplitWorkspaceResponse(BaseModel):
    mode: str
    conversations: list[ConversationTransformResponse]


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
