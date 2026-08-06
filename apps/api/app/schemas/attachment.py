from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class AssetObjectRead(BaseModel):
    id: UUID
    sha256: str
    byte_size: int
    detected_mime_type: str
    detected_extension: str | None
    scan_status: str
    status: str


class AttachmentRead(BaseModel):
    id: UUID
    conversation_id: UUID
    asset_object: AssetObjectRead | None
    original_filename: str
    display_name: str
    declared_mime_type: str | None
    detected_mime_type: str | None
    status: str
    scan_status: str
    source_type: str
    source_attachment_id: str | None
    metadata: dict
    resolution_status: str
    created_at: datetime
    content_url: str | None
    download_url: str | None
    occurrence_count: int = 0
    message_count: int = 0
    is_used: bool = False
    occurrences: list["AttachmentOccurrenceLocationRead"] = Field(default_factory=list)


class AttachmentOccurrenceLocationRead(BaseModel):
    message_id: UUID
    message_version_id: UUID
    is_current_version: bool
    occurrence_key: str
    placement: str
    block_index: int | None


class MessageVersionAttachmentRead(BaseModel):
    id: UUID
    message_version_id: UUID
    attachment: AttachmentRead
    occurrence_key: str
    placement: str
    relation_type: str
    display_order: int
    block_index: int | None
    display_mode: str
    alt_text: str | None
    caption: str | None


class AttachmentUploadSessionCreate(BaseModel):
    target_message_id: UUID | None = None
    base_message_version_id: UUID | None = None


class AttachmentUploadItemRead(BaseModel):
    id: UUID
    client_filename: str
    declared_mime_type: str | None
    detected_mime_type: str | None
    byte_size: int
    sha256: str | None
    validation_status: str
    scan_status: str
    error_code: str | None
    created_at: datetime


class AttachmentUploadSessionRead(BaseModel):
    id: UUID
    conversation_id: UUID
    target_message_id: UUID | None
    base_message_version_id: UUID | None
    status: str
    expires_at: datetime
    created_at: datetime
    items: list[AttachmentUploadItemRead]


class AttachmentFinalizeRequest(BaseModel):
    upload_item_ids: list[UUID]


class AttachmentUpdateRequest(BaseModel):
    display_name: str


class AttachmentListRead(BaseModel):
    items: list[AttachmentRead]
