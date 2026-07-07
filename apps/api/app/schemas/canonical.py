from uuid import UUID

from pydantic import BaseModel, Field


class CommitImportResponse(BaseModel):
    import_id: UUID
    status: str
    conversation_ids: list[UUID]
    conversation_count: int
    message_count: int
    warnings: list[str] = Field(default_factory=list)
