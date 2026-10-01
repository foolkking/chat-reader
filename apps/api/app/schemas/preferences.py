from datetime import datetime
from typing import Literal
import uuid

from pydantic import BaseModel, Field, model_validator


ThemeMode = Literal["light", "dark", "system"]
LocaleMode = Literal["auto", "zh-CN", "en-US"]
ResolvedTheme = Literal["light", "dark"]
ResolvedLocale = Literal["zh-CN", "en-US"]
ReaderWidthMode = Literal["compact", "standard", "wide"]
ReaderDensityMode = Literal["compact", "comfortable", "large"]
SectionTocMode = Literal["visible", "rail"]
ConversationSortMode = Literal[
    "recent_read", "updated", "created", "imported", "title", "message_count", "custom"
]
ProjectSortMode = Literal["recent_read", "updated", "created", "title", "conversation_count", "custom"]
SortDirection = Literal["asc", "desc"]


class UserPreferenceRead(BaseModel):
    theme_mode: ThemeMode
    locale_mode: LocaleMode
    reader_width_mode: ReaderWidthMode
    reader_density_mode: ReaderDensityMode
    reader_font_size_px: int = Field(ge=15, le=22)
    section_toc_mode: SectionTocMode
    conversation_sort_mode: ConversationSortMode
    conversation_sort_direction: SortDirection
    project_sort_mode: ProjectSortMode
    project_sort_direction: SortDirection
    reader_default_focus: bool = False
    annotation_default_position: Literal["floating", "docked"] = "floating"
    field_revisions: dict[str, int] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class UserPreferenceUpdate(BaseModel):
    theme_mode: ThemeMode | None = None
    locale_mode: LocaleMode | None = None
    reader_width_mode: ReaderWidthMode | None = None
    reader_density_mode: ReaderDensityMode | None = None
    reader_font_size_px: int | None = Field(default=None, ge=15, le=22)
    section_toc_mode: SectionTocMode | None = None
    conversation_sort_mode: ConversationSortMode | None = None
    conversation_sort_direction: SortDirection | None = None
    project_sort_mode: ProjectSortMode | None = None
    project_sort_direction: SortDirection | None = None
    reader_default_focus: bool | None = None
    annotation_default_position: Literal["floating", "docked"] | None = None


class PreferenceSyncRequest(BaseModel):
    operation_id: uuid.UUID
    changes: UserPreferenceUpdate
    base_revisions: dict[str, int] = Field(max_length=12)

    @model_validator(mode="after")
    def matching_revisions(self):
        values = self.changes.model_dump(exclude_none=True, exclude_unset=True)
        if not values or set(values) != set(self.base_revisions) or any(value < 1 for value in self.base_revisions.values()):
            raise ValueError("Each changed field requires its positive server revision.")
        return self


class PreferenceSyncResponse(BaseModel):
    operation_id: uuid.UUID
    preferences: UserPreferenceRead
    applied: list[str]
    conflicts: list[str]
