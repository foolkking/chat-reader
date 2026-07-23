from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


AnnotationType = Literal["highlight", "bookmark"]
AnnotationColor = Literal["yellow", "green", "blue", "pink"]


class AnnotationCreate(BaseModel):
    id: UUID | None = None
    message_id: UUID | None = None
    message_version_id: UUID | None = None
    annotation_type: AnnotationType = "highlight"
    color: AnnotationColor | None = "yellow"
    start_block_index: int | None = Field(default=None, ge=0)
    start_offset: int | None = Field(default=None, ge=0)
    end_block_index: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, ge=0)
    quote: str | None = Field(default=None, max_length=20_000)
    prefix: str | None = Field(default=None, max_length=500)
    suffix: str | None = Field(default=None, max_length=500)
    comment_markdown: str = Field(default="", max_length=20_000)
    anchor_status: Literal["active", "relocated", "stale"] = "active"
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_anchor(self) -> "AnnotationCreate":
        if self.annotation_type == "highlight":
            required = (self.message_id, self.message_version_id, self.start_block_index, self.end_block_index)
            if any(value is None for value in required) or not (self.quote or "").strip():
                raise ValueError("Highlights require a message, version, block range, and quote.")
        elif self.message_id is None:
            raise ValueError("Bookmarks require a message.")
        return self


class AnnotationUpdate(BaseModel):
    base_revision: int = Field(ge=1)
    color: AnnotationColor | None = None
    comment_markdown: str | None = Field(default=None, max_length=20_000)
    anchor_status: Literal["active", "relocated", "stale"] | None = None
    message_version_id: UUID | None = None
    start_block_index: int | None = Field(default=None, ge=0)
    start_offset: int | None = Field(default=None, ge=0)
    end_block_index: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, ge=0)
    quote: str | None = Field(default=None, max_length=20_000)
    prefix: str | None = Field(default=None, max_length=500)
    suffix: str | None = Field(default=None, max_length=500)
    metadata: dict[str, Any] | None = None


class AnnotationRead(BaseModel):
    id: UUID
    conversation_id: UUID
    message_id: UUID | None
    message_version_id: UUID | None
    annotation_type: AnnotationType
    color: AnnotationColor | None
    start_block_index: int | None
    start_offset: int | None
    end_block_index: int | None
    end_offset: int | None
    quote: str | None
    prefix: str | None
    suffix: str | None
    comment_markdown: str
    anchor_status: Literal["active", "relocated", "stale"]
    revision: int
    is_deleted: bool
    conflict_of_id: UUID | None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class NotebookBlock(BaseModel):
    id: UUID
    type: Literal["markdown", "annotation_reference"]
    markdown: str | None = Field(default=None, max_length=50_000)
    annotation_id: UUID | None = None

    @model_validator(mode="after")
    def validate_content(self) -> "NotebookBlock":
        if self.type == "markdown" and self.markdown is None:
            raise ValueError("Markdown blocks require markdown content.")
        if self.type == "annotation_reference" and self.annotation_id is None:
            raise ValueError("Annotation reference blocks require annotation_id.")
        return self


class NotebookPut(BaseModel):
    id: UUID | None = None
    title: str | None = Field(default=None, max_length=200)
    blocks: list[NotebookBlock] = Field(default_factory=list, max_length=5_000)
    base_revision: int = Field(default=0, ge=0)


class NotebookRead(BaseModel):
    id: UUID
    conversation_id: UUID
    title: str | None
    blocks: list[NotebookBlock]
    revision: int
    is_conflict: bool
    conflict_of_id: UUID | None
    created_at: datetime
    updated_at: datetime


class SyncOperation(BaseModel):
    operation_id: UUID
    entity_type: Literal["annotation", "notebook"]
    entity_id: UUID
    action: Literal["upsert", "delete"]
    conversation_id: UUID
    base_revision: int = Field(default=0, ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)


class AnnotationSyncRequest(BaseModel):
    operations: list[SyncOperation] = Field(min_length=1, max_length=500)


class SyncOperationResult(BaseModel):
    operation_id: UUID
    entity_type: Literal["annotation", "notebook"]
    entity_id: UUID
    status: Literal["applied", "conflict", "duplicate"]
    revision: int
    conflict_copy_id: UUID | None = None


class AnnotationSyncResponse(BaseModel):
    results: list[SyncOperationResult]
