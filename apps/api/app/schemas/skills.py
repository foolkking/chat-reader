from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

SkillCategory = Literal["EXPORT_CONTEXT", "CONVERSATION_RESCUE"]
SkillLocale = Literal["zh-CN", "en"]
SkillStatus = Literal["ACTIVE", "DISABLED"]


class SkillRead(BaseModel):
    id: str
    source: Literal["BUILTIN", "SYSTEM", "USER"]
    category: SkillCategory
    locale: SkillLocale
    name: str
    status: SkillStatus
    is_selected: bool = False
    updated_at: datetime | None = None
    byte_size: int | None = None
    content_url: str | None = None
    is_customized: bool = False
    default_enabled: bool = False


class SkillDetail(SkillRead):
    content: str | None = None


class SkillResolve(SkillDetail):
    pass


class SkillSelectionUpdate(BaseModel):
    category: SkillCategory
    locale: SkillLocale
    skill_id: UUID | None = None


class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: SkillStatus | None = None
