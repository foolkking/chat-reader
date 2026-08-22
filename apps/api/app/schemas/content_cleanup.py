from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CleanupRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    match_value: str = Field(min_length=1, max_length=500)
    case_sensitive: bool = True
    role_filter: Literal["user", "assistant", "system", "tool"] | None = None
    matcher_mode: Literal["EXACT", "NORMALIZED", "APPROXIMATE"] = "EXACT"
    boundary_mode: Literal["ANYWHERE", "WHOLE_LINE", "BLOCK_END"] = "ANYWHERE"


class CleanupRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    status: Literal["ACTIVE", "DISABLED"] | None = None
    match_value: str | None = Field(default=None, min_length=1, max_length=500)
    case_sensitive: bool | None = None
    role_filter: Literal["user", "assistant", "system", "tool"] | None = None
    matcher_mode: Literal["EXACT", "NORMALIZED", "APPROXIMATE"] | None = None
    boundary_mode: Literal["ANYWHERE", "WHOLE_LINE", "BLOCK_END"] | None = None


class CleanupRuleRead(BaseModel):
    id: UUID
    name: str
    kind: str
    status: str
    scope: str
    detector_id: str | None
    revision: int
    match_value: str | None
    case_sensitive: bool
    role_filter: str | None
    matcher_mode: str
    normalization_profile: str
    boundary_mode: str
    last_used_at: datetime | None


class CleanupScanCreate(BaseModel):
    source: Literal["READER", "BATCH"] = "READER"
    scope_type: Literal["CURRENT_CONVERSATION", "SELECTED_CONVERSATIONS", "ALL_ACTIVE"]
    conversation_ids: list[UUID] = Field(default_factory=list, max_length=5000)
    message_id: UUID | None = None
    selection_start_offset: int | None = Field(default=None, ge=0)
    selection_end_offset: int | None = Field(default=None, ge=0)


class CleanupScanRead(BaseModel):
    id: UUID
    source: str
    status: str
    scope_type: str
    background_job_id: UUID | None
    progress: int
    processed_messages: int
    total_messages: int
    occurrence_count: int
    delete_count: int
    keep_count: int
    protected_count: int
    created_at: datetime
    completed_at: datetime | None
    error_message: str | None


class CleanupOccurrenceRead(BaseModel):
    id: UUID
    conversation_id: UUID
    conversation_title: str
    message_id: UUID
    message_version_id: UUID
    role: str
    rule_id: UUID
    rule_name: str
    detector_id: str | None
    kind: str
    reason_code: str
    confidence: str
    decision: str
    start_offset: int
    end_offset: int
    line_start: int
    column_start: int
    match_text: str
    context_before: str
    context_after: str
    stale: bool
    match_mode: str
    similarity_score: float | None
    evidence_codes: list[str] | None


class CleanupDecisionInput(BaseModel):
    occurrence_id: UUID
    decision: Literal["DELETE", "KEEP"]


class CleanupDecisionBatch(BaseModel):
    decisions: list[CleanupDecisionInput] = Field(min_length=1, max_length=10000)


class CleanupApplyRead(BaseModel):
    applied: int
    conflicts: int
