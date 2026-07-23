from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class OfflineCatalogConversation(BaseModel):
    id: UUID
    display_title: str
    project_id: UUID | None
    project_name: str | None
    revision: int
    estimated_bytes: int
    updated_at: datetime | None


class OfflineCatalogProject(BaseModel):
    id: UUID
    name: str
    conversation_ids: list[UUID]
    revision: str
    estimated_bytes: int


class OfflineCatalogResponse(BaseModel):
    revision: str
    generated_at: datetime
    estimated_bytes: int
    conversations: list[OfflineCatalogConversation]
    projects: list[OfflineCatalogProject]


class OfflinePackageCreate(BaseModel):
    scope: Literal["conversation", "project", "all"]
    conversation_id: UUID | None = None
    project_id: UUID | None = None

    @model_validator(mode="after")
    def validate_scope_id(self) -> "OfflinePackageCreate":
        if self.scope == "conversation" and self.conversation_id is None:
            raise ValueError("conversation_id is required for conversation scope.")
        if self.scope == "project" and self.project_id is None:
            raise ValueError("project_id is required for project scope.")
        return self


class OfflinePackageQueued(BaseModel):
    package_id: UUID
    job_id: UUID
    status: str
    scope: Literal["conversation", "project", "all"]
    estimated_bytes: int = Field(ge=0)
    catalog_revision: str


class OfflinePackageRead(BaseModel):
    id: UUID
    job_id: UUID
    scope: str
    scope_id: UUID | None
    catalog_revision: str
    filename: str
    sha256: str
    byte_size: int
    conversation_count: int
    created_at: datetime
