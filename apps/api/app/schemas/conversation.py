from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


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
    manual_sort_order: int = 0


class ConversationDetail(ConversationListItem):
    external_source_id: str | None
    parser_version: str
    render_version: int
    content_hash: str | None
    sort_time: datetime | None


class ConversationUpdate(BaseModel):
    title: str | None = None
    display_title: str | None = None
    status: str | None = None
    description_markdown: str | None = Field(default=None, max_length=500)


class ConversationOrderUpdate(BaseModel):
    conversation_ids: list[UUID] = Field(min_length=1, max_length=500)
