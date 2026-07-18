from datetime import datetime
from uuid import UUID

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
    allow_export: bool = False
    expires_at: datetime | None = None
    theme: ResolvedTheme | None = None
    locale: ResolvedLocale | None = None


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


class ShareCreateResponse(ShareRead):
    token: str
    share_url: str


class ShareUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    expires_at: datetime | None = None
    theme: ResolvedTheme | None = None
    locale: ResolvedLocale | None = None


class ShareRevokeResponse(ShareRead):
    pass


class SharedConversationBootstrap(BaseModel):
    share: ShareRead
    conversation: ConversationListItem
    message_count: int
    turn_count: int
    capabilities: dict[str, bool] = Field(default_factory=dict)


class SharedMessageWindowResponse(MessageWindowResponse):
    pass


class SharedDialogueIndexResponse(DialogueIndexResponse):
    pass


class SharedTocResponse(TocResponse):
    pass
