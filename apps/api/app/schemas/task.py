from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_serializer


class OfflineDownloadTarget(BaseModel):
    scope: Literal["conversation", "project", "all"]
    conversation_id: UUID | None = None
    project_id: UUID | None = None
    include_assets: Literal["none", "small", "all"] = "all"


class ImportFailureRead(BaseModel):
    code: str
    stage: str
    retryable: bool
    details: dict[str, str | int] | None = None

    @model_serializer(mode="wrap")
    def omit_absent_details(self, handler):
        result = handler(self)
        if self.details is None:
            result.pop("details", None)
        return result


class ImportResourceWaitRead(BaseModel):
    reason: str
    next_retry_at: datetime | None = None
    remaining_seconds: float = Field(ge=0, le=1800)


class TaskCancellationRequest(BaseModel):
    # Legacy calls without a body keep their disposal semantics.
    source_disposition: Literal["retain", "discard"] = "discard"


class BackgroundTaskRead(BaseModel):
    execution_state: Literal["running", "stopping"] | None = None
    business_progress_at: datetime | None = None
    stop_requested_at: datetime | None = None
    job_id: UUID
    job_type: str
    status: str
    phase: str
    progress: int = Field(ge=0, le=100)
    processed_items: int
    total_items: int
    label: str | None = None
    source_label: str | None = None
    export_format: str | None = None
    offline_target: OfflineDownloadTarget | None = None
    result: dict = Field(default_factory=dict)
    error_message: str | None = None
    failure: ImportFailureRead | None = None
    resource_wait: ImportResourceWaitRead | None = None
    queued_at: datetime | None = None
    started_at: datetime | None = None
    heartbeat_at: datetime | None = None
    completed_at: datetime | None = None
    updated_at: datetime | None = None
    cancellation_requested_at: datetime | None = None
    progress_updated_at: datetime | None = None
    cancellable: bool = False
    attempt_count: int = 0


class ConversationProjectMoveRequest(BaseModel):
    project_id: UUID | None = None


class ConversationMergeRequestRead(BaseModel):
    found: bool
    task: BackgroundTaskRead | None = None


class ConversationBatchDeleteRequest(BaseModel):
    conversation_ids: list[UUID] = Field(min_length=1, max_length=5000)


class ConversationBatchDeleteRequestRead(BaseModel):
    found: bool
    task: BackgroundTaskRead | None = None
