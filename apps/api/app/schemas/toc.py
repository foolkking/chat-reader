from uuid import UUID
from typing import Literal

from pydantic import BaseModel, model_validator


class TocItem(BaseModel):
    id: UUID
    heading_index: int
    level: int
    text: str
    slug: str
    message_id: UUID
    message_order_key: str
    block_index: int


class TocResponse(BaseModel):
    conversation_id: UUID
    items: list[TocItem]
    limit: int = 200
    offset: int = 0
    total: int = 0
    has_more: bool = False


class TocRefreshRequest(BaseModel):
    refresh_dialogue_index: bool = True
    refresh_section_toc: bool = True
    section_scope: Literal["current_conversation", "all_conversations"] = "current_conversation"

    @model_validator(mode="after")
    def require_refresh_target(self) -> "TocRefreshRequest":
        if not self.refresh_dialogue_index and not self.refresh_section_toc:
            raise ValueError("At least one TOC target must be selected.")
        return self
