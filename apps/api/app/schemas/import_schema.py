from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class SourceProfile(StrEnum):
    chatgpt_exporter_json = "chatgpt_exporter_json"
    chatgpt_exporter_markdown = "chatgpt_exporter_markdown"
    chatgpt_exporter_combo = "chatgpt_exporter_combo"
    official_conversations_json = "official_conversations_json"
    official_conversation_json = "official_conversation_json"
    third_party_splitter_json = "third_party_splitter_json"
    plain_text = "plain_text"
    csv = "csv"
    unknown = "unknown"


class SourceDetectionResult(BaseModel):
    source_profile: SourceProfile
    confidence: float = Field(ge=0, le=1)
    reason: str
    file_extension: str
    mime_guess: str | None
    size_bytes: int
    sha256: str
    warnings: list[str] = Field(default_factory=list)


class ImportPreviewFile(BaseModel):
    artifact_id: UUID
    filename: str
    source_profile: SourceProfile
    confidence: float
    sha256: str
    byte_size: int
    mime_guess: str | None
    file_extension: str
    raw_storage_uri: str
    warnings: list[str] = Field(default_factory=list)


class MessagePreview(BaseModel):
    role: str
    order_key: str
    plain_text_preview: str
    display_text_preview: str
    source_json_index: int | None
    source_markdown_index: int | None
    warnings: list[str] = Field(default_factory=list)


class ConversationPreview(BaseModel):
    title: str
    source_type: str
    source_profile: str
    alignment_status: str
    message_count: int
    prompt_count: int
    response_count: int
    empty_message_count: int
    cleaned_thinking_summary_count: int
    first_user_message: str | None
    warnings: list[str] = Field(default_factory=list)
    messages: list[MessagePreview] = Field(default_factory=list)


class ImportPreviewResponse(BaseModel):
    import_id: UUID
    status: str
    files: list[ImportPreviewFile]
    warnings: list[str] = Field(default_factory=list)
    conversation_preview: ConversationPreview | None = None


class SourceArtifactRead(BaseModel):
    artifact_id: UUID
    import_id: UUID
    filename: str
    safe_filename: str
    source_profile: SourceProfile
    source_type: str
    sha256: str
    byte_size: int
    mime_guess: str | None
    file_extension: str | None
    raw_storage_uri: str


class ImportWarningsResponse(BaseModel):
    import_id: UUID
    warnings: list[str]
