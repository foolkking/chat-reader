from datetime import datetime
from uuid import UUID
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.preferences import ResolvedLocale, ResolvedTheme
from app.schemas.conversation import ConversationListItem
from app.schemas.message import DialogueIndexResponse
from app.schemas.search import MessageWindowResponse
from app.schemas.toc import TocResponse


class ShareCreate(BaseModel):
    title: str | None = None
    description: str | None = None
    scope: str = "conversation"
    selected_message_ids: list[UUID] = Field(default_factory=list)
    include_toc: bool = True
    include_metadata: bool = True
    include_description: bool = False
    include_annotations: bool = False
    include_notebook: bool = False
    allow_export: bool = False
    expires_at: datetime | None = None
    theme: ResolvedTheme | None = None
    locale: ResolvedLocale | None = None
    share_password: str | None = Field(default=None, min_length=12, max_length=1024)


class ShareRead(BaseModel):
    id: UUID
    conversation_id: UUID
    token_prefix: str
    title: str | None
    description: str | None
    scope: str
    selected_message_ids: list[UUID] = Field(default_factory=list)
    include_toc: bool
    include_metadata: bool
    include_description: bool
    include_annotations: bool
    include_notebook: bool
    allow_export: bool
    theme: ResolvedTheme
    locale: ResolvedLocale
    expires_at: datetime | None
    revoked_at: datetime | None
    access_count: int
    last_accessed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    share_url: str | None = None
    password_required: bool = False


class ShareCreateResponse(ShareRead):
    token: str
    share_url: str


class ShareUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    expires_at: datetime | None = None
    theme: ResolvedTheme | None = None
    locale: ResolvedLocale | None = None
    share_password: str | None = Field(default=None, min_length=12, max_length=1024)
    scope: Literal["conversation", "selected_messages"] | None = None
    selected_message_ids: list[UUID] | None = Field(default=None, max_length=10000)
    include_toc: bool | None = None
    include_metadata: bool | None = None
    include_description: bool | None = None
    include_annotations: bool | None = None
    include_notebook: bool | None = None
    allow_export: bool | None = None


class OwnedShareRead(ShareRead):
    conversation_title: str
    conversation_deleted: bool
    status: Literal["active", "expired", "revoked"]


class OwnedSharePage(BaseModel):
    items: list[OwnedShareRead]
    total: int
    offset: int
    limit: int
    has_more: bool


class ShareBatchRevokeInput(BaseModel):
    share_ids: list[UUID] = Field(min_length=1, max_length=100)


class ShareBatchResult(BaseModel):
    share_id: UUID
    status: Literal["revoked", "not_found", "failed"]


class ShareBatchRevokeResponse(BaseModel):
    results: list[ShareBatchResult]


class ShareRevokeResponse(ShareRead):
    pass


class SharedConversationBootstrap(BaseModel):
    share: ShareRead
    conversation: ConversationListItem
    message_count: int
    turn_count: int
    capabilities: dict[str, bool] = Field(default_factory=dict)
    description_markdown: str | None = None


class ShareUnlockInput(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class ShareUnlockResponse(BaseModel):
    unlocked: bool = True


class SharedMessageWindowResponse(MessageWindowResponse):
    pass


class SharedDialogueIndexResponse(DialogueIndexResponse):
    pass


class SharedTocResponse(TocResponse):
    pass
