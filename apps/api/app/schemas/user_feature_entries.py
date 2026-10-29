from datetime import date, datetime
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


FeatureCollection = Literal["saved-search", "export-preset", "reading-list", "offline-checklist"]
SearchDocumentType = Literal["all", "conversation", "message", "heading", "code", "annotation", "attachment"]
SearchRole = Literal["all", "user", "assistant"]
SearchStatusScope = Literal["active", "archived", "all"]
ExportFormat = Literal["context", "canjson", "markdown"]
OfflineScope = Literal["conversation", "project"]
OfflineAssetMode = Literal["none", "small", "all"]


class SavedSearchValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    q: str = Field(min_length=1, max_length=300)
    document_type: SearchDocumentType = "all"
    role: SearchRole = "all"
    project_id: uuid.UUID | None = None
    status_scope: SearchStatusScope = "active"
    date_from: date | None = None
    date_to: date | None = None

    @field_validator("name", "q", mode="before")
    @classmethod
    def trim_required_text(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def valid_date_range(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be on or before date_to.")
        return self


class ExportPresetValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    format: ExportFormat
    include_continuation: bool = True
    include_attachments: bool = False
    include_description: bool = False
    include_annotations: bool = False
    include_notebook: bool = False
    include_source_refs: bool = True

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class ReadingListValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: uuid.UUID
    state: Literal["unread", "read"] = "unread"


class OfflineChecklistTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scope: OfflineScope
    id: uuid.UUID


class OfflineChecklistValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    targets: list[OfflineChecklistTarget] = Field(min_length=1, max_length=50)
    include_assets: OfflineAssetMode = "small"

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def unique_targets(self):
        keys = [(item.scope, item.id) for item in self.targets]
        if len(keys) != len(set(keys)):
            raise ValueError("targets must be unique.")
        return self


class UserFeatureEntryWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=0)
    value: dict


class UserFeatureEntryRead(BaseModel):
    id: uuid.UUID
    collection: FeatureCollection
    revision: int = Field(ge=1)
    value: dict
    created_at: datetime
    updated_at: datetime
