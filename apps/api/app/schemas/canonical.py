from uuid import UUID

from datetime import datetime

from pydantic import BaseModel, Field


class CommitImportResponse(BaseModel):
    import_id: UUID
    status: str
    conversation_ids: list[UUID]
    conversation_count: int
    message_count: int
    warnings: list[str] = Field(default_factory=list)
    phase: str = "queued"
    progress: int = 0
    processed_messages: int = 0
    total_messages: int = 0
    filename: str | None = None
    error_message: str | None = None
    queued_at: datetime | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    completed_at: datetime | None = None
