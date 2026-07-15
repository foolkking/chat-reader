from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class BackgroundTaskRead(BaseModel):
    job_id: UUID
    job_type: str
    status: str
    phase: str
    progress: int = Field(ge=0, le=100)
    processed_items: int
    total_items: int
    label: str | None = None
    result: dict = Field(default_factory=dict)
    error_message: str | None = None
    queued_at: datetime | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    completed_at: datetime | None = None


class ConversationProjectMoveRequest(BaseModel):
    project_id: UUID | None = None
