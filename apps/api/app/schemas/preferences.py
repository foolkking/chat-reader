from datetime import datetime
from typing import Literal

from pydantic import BaseModel


ThemeMode = Literal["light", "dark", "system"]
LocaleMode = Literal["auto", "zh-CN", "en-US"]
ResolvedTheme = Literal["light", "dark"]
ResolvedLocale = Literal["zh-CN", "en-US"]
ReaderWidthMode = Literal["compact", "standard", "wide"]
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
    section_toc_mode: SectionTocMode
    conversation_sort_mode: ConversationSortMode
    conversation_sort_direction: SortDirection
    project_sort_mode: ProjectSortMode
    project_sort_direction: SortDirection
    created_at: datetime
    updated_at: datetime


class UserPreferenceUpdate(BaseModel):
    theme_mode: ThemeMode | None = None
    locale_mode: LocaleMode | None = None
    reader_width_mode: ReaderWidthMode | None = None
    section_toc_mode: SectionTocMode | None = None
    conversation_sort_mode: ConversationSortMode | None = None
    conversation_sort_direction: SortDirection | None = None
    project_sort_mode: ProjectSortMode | None = None
    project_sort_direction: SortDirection | None = None
