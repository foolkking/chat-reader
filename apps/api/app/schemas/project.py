from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.conversation import ConversationListItem


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    color: str | None = None
    icon: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    color: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    is_archived: bool | None = None


class ProjectRead(BaseModel):
    id: UUID
    name: str
    description: str | None
    color: str | None
    icon: str | None
    sort_order: int
    is_default: bool
    is_archived: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
    last_read_at: datetime | None = None
    conversation_count: int = 0
    pinned_count: int = 0


class ProjectConversationRelationRead(BaseModel):
    is_pinned: bool
    pinned_at: datetime | None
    added_at: datetime
    sort_order: int


class ProjectConversationRead(ConversationListItem):
    project_relation: ProjectConversationRelationRead


class ProjectConversationPinUpdate(BaseModel):
    is_pinned: bool


class ConversationPinUpdate(BaseModel):
    is_pinned: bool


class ProjectOrderUpdate(BaseModel):
    project_ids: list[UUID] = Field(min_length=1, max_length=500)


class ProjectConversationOrderUpdate(BaseModel):
    conversation_ids: list[UUID] = Field(min_length=1, max_length=500)
