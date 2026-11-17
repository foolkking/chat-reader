from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.schemas.conversation import ConversationListItem
from app.schemas.preferences import ScopedSort


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    color: str | None = None
    icon: str | None = None


class ProjectUpdate(BaseModel):
    conversation_sort: ScopedSort | None = None
    expected_sort_revision: int | None = Field(default=None, ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    color: str | None = None
    icon: str | None = None
    sort_order: int | None = None
    is_archived: bool | None = None


class ProjectRead(BaseModel):
    order_version: str | None = None
    conversation_sort: ScopedSort | None = None
    sort_revision: int = 1
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


class ProjectPlacementRequest(BaseModel):
    expected_order_version: str | None = Field(default=None, min_length=64, max_length=64)
    before_project_id: UUID | None = None
    after_project_id: UUID | None = None

    @model_validator(mode="after")
    def validate_anchors(self) -> "ProjectPlacementRequest":
        if self.before_project_id is not None and self.before_project_id == self.after_project_id:
            raise ValueError("before_project_id and after_project_id must differ.")
        return self
