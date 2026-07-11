from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.conversation import ConversationListItem
from app.schemas.message import MessageListItem
from app.schemas.toc import TocItem


class ShareCreate(BaseModel):
    title: str | None = None
    description: str | None = None
    scope: str = "conversation"
    selected_message_ids: list[UUID] = Field(default_factory=list)
    include_toc: bool = True
    include_metadata: bool = True
    allow_export: bool = False
    expires_at: datetime | None = None


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


class ShareRevokeResponse(ShareRead):
    pass


class SharedConversationResponse(BaseModel):
    share: ShareRead
    conversation: ConversationListItem
    toc: list[TocItem] = Field(default_factory=list)
    messages: list[MessageListItem] = Field(default_factory=list)
