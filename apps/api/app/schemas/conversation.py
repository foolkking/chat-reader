from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class ConversationListItem(BaseModel):
    id: UUID
    title: str
    display_title: str
    source_type: str
    source_profile: str
    message_count: int
    turn_count: int
    created_at: datetime | None
    updated_at: datetime | None
    imported_at: datetime
    first_user_message: str | None
    status: str
    is_global_pinned: bool
    global_pinned_at: datetime | None


class ConversationDetail(ConversationListItem):
    external_source_id: str | None
    parser_version: str
    render_version: int
    content_hash: str | None
    sort_time: datetime | None
