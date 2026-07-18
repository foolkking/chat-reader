from datetime import datetime
from typing import Literal

from pydantic import BaseModel


ThemeMode = Literal["light", "dark", "system"]
LocaleMode = Literal["auto", "zh-CN", "en-US"]
ResolvedTheme = Literal["light", "dark"]
ResolvedLocale = Literal["zh-CN", "en-US"]
ReaderWidthMode = Literal["compact", "standard", "wide"]


class UserPreferenceRead(BaseModel):
    theme_mode: ThemeMode
    locale_mode: LocaleMode
    reader_width_mode: ReaderWidthMode
    created_at: datetime
    updated_at: datetime


class UserPreferenceUpdate(BaseModel):
    theme_mode: ThemeMode | None = None
    locale_mode: LocaleMode | None = None
    reader_width_mode: ReaderWidthMode | None = None
