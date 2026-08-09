from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from typing import Literal

from app.schemas.message import MessageListItem


class ConversationListItem(BaseModel):
    id: UUID
    title: str
    display_title: str
    source_type: str
    source_profile: str
    message_count: int
    turn_count: int
    created_at: datetime | None
    updated_at: datetime | None
    imported_at: datetime
    first_user_message: str | None
    description_markdown: str | None = None
    project_id: UUID | None = None
    project_name: str | None = None
    offline_revision: int = 1
    status: str
    is_global_pinned: bool
    global_pinned_at: datetime | None
    last_read_at: datetime | None = None
    reading_progress: float | None = None
    manual_sort_order: int = 0


class ConversationDetail(ConversationListItem):
    external_source_id: str | None
    parser_version: str
    render_version: int
    content_hash: str | None
    sort_time: datetime | None


class ConversationCreateMessage(BaseModel):
    role: Literal["user", "assistant"]
    content_markdown: str = Field(min_length=1, max_length=200_000)


class ConversationCreateRequest(BaseModel):
    title: str = Field(default="New conversation", max_length=500)
    project_id: UUID | None = None
    messages: list[ConversationCreateMessage] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def validate_messages(self) -> "ConversationCreateRequest":
        if [message.role for message in self.messages] != ["user", "assistant"]:
            raise ValueError("Initial messages must be user then assistant.")
        return self


class ConversationCreateResponse(BaseModel):
    conversation: ConversationDetail
    messages: list[MessageListItem]


class MessageInsertMessage(BaseModel):
    role: Literal["user", "assistant"] | None = None
    content_markdown: str = Field(min_length=1, max_length=200_000)


class MessageInsertRequest(BaseModel):
    anchor_message_id: UUID
    position: Literal["before", "after"]
    mode: Literal["single", "pair"] = "single"
    messages: list[MessageInsertMessage] = Field(min_length=1, max_length=2)
    expected_offline_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_messages(self) -> "MessageInsertRequest":
        if self.mode == "pair":
            if len(self.messages) != 2 or [message.role for message in self.messages] != ["user", "assistant"]:
                raise ValueError("A message pair must contain user then assistant content.")
        elif len(self.messages) != 1:
            raise ValueError("A single insertion must contain exactly one message.")
        return self


class MessageInsertResponse(BaseModel):
    conversation: ConversationDetail
    messages: list[MessageListItem]



class ConversationUpdate(BaseModel):
    title: str | None = None
    display_title: str | None = None
    status: str | None = None
    description_markdown: str | None = Field(default=None, max_length=500)


class ConversationOrderUpdate(BaseModel):
    conversation_ids: list[UUID] = Field(min_length=1, max_length=500)


class ConversationPlacementRequest(BaseModel):
    target_project_id: UUID | None = None
    target_section: Literal["pinned", "normal"] = "normal"
    before_conversation_id: UUID | None = None
    after_conversation_id: UUID | None = None
    expected_offline_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_anchors(self) -> "ConversationPlacementRequest":
        if (
            self.before_conversation_id is not None
            and self.before_conversation_id == self.after_conversation_id
        ):
            raise ValueError("before_conversation_id and after_conversation_id must differ.")
        return self


class ConversationPlacementRead(BaseModel):
    project_id: UUID | None
    target_section: Literal["pinned", "normal"]
    sort_order: int
    is_pinned: bool
    offline_revision: int


class ConversationPlacementResponse(BaseModel):
    conversation: ConversationListItem
    placement: ConversationPlacementRead
    source_project_count: int
    target_project_count: int
    unclassified_count: int
