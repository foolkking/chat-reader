from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Finding:
    severity: str
    code: str
    detail: str
    location: str | None = None
    expected: Any = None
    observed: Any = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        return {k: v for k, v in data.items() if v is not None}


@dataclass
class CanonicalMessageDescriptor:
    sequence: int
    ordinal: int
    line: int
    role: str
    message_id: str | None = None
    version_id: str | None = None
    version_number: int | None = None
    order_key: str | None = None
    turn_index: int | None = None
    created_at: str | None = None
    body_available: bool = False
    body_empty: bool = False
    body_chars: int = 0
    body_utf8_bytes: int = 0
    exporter_content_hash: str | None = None
    attachment_ref_count: int = 0

    def compact_dict(self) -> dict[str, Any]:
        return {
            "sequence": self.sequence,
            "message_id": self.message_id,
            "version_id": self.version_id,
            "version_number": self.version_number,
            "role": self.role,
            "turn_index": self.turn_index,
            "order_key": self.order_key,
            "body_available": self.body_available,
            "body_empty": self.body_empty,
            "body_chars": self.body_chars,
            "body_utf8_bytes": self.body_utf8_bytes,
            "attachment_ref_count": self.attachment_ref_count,
        }


@dataclass
class CanonicalMessage:
    descriptor: CanonicalMessageDescriptor
    body_text: str | None
    representation: str
    content_parts: list[dict[str, Any]]


@dataclass
class AttachmentDescriptor:
    attachment_id: str
    original_filename: str | None = None
    display_name: str | None = None
    declared_mime_type: str | None = None
    detected_mime_type: str | None = None
    status: str | None = None
    resolution_status: str | None = None
    object_path: str | None = None
    object_sha256: str | None = None
    object_byte_size: int | None = None


@dataclass
class AttachmentRefDescriptor:
    attachment_id: str
    message_id: str | None = None
    message_version_id: str | None = None
    occurrence_key: str | None = None
    placement: str | None = None
    relation_type: str | None = None
    display_order: int | None = None
    block_index: int | None = None
    display_mode: str | None = None
    alt_text: str | None = None
    caption: str | None = None


@dataclass
class SourceRefDescriptor:
    message_id: str | None
    source_type: str | None = None
    source_profile: str | None = None
    source_conversation_id: str | None = None
    source_message_id: str | None = None
    source_index: Any = None


@dataclass
class StreamSnapshot:
    stream_format: str
    stream_version: str | int | None
    supported: bool
    header: dict[str, Any] | None = None
    end: dict[str, Any] | None = None
    messages: list[CanonicalMessageDescriptor] = field(default_factory=list)
    attachments: dict[str, AttachmentDescriptor] = field(default_factory=dict)
    attachment_refs: list[AttachmentRefDescriptor] = field(default_factory=list)
    source_refs: list[SourceRefDescriptor] = field(default_factory=list)
    records_by_type: dict[str, int] = field(default_factory=dict)
    unknown_record_types: dict[str, int] = field(default_factory=dict)
    parse_errors: list[Finding] = field(default_factory=list)
    total_records: int = 0

    @property
    def message_by_sequence(self) -> dict[int, CanonicalMessageDescriptor]:
        return {m.sequence: m for m in self.messages}

    @property
    def message_by_id(self) -> dict[str, CanonicalMessageDescriptor]:
        return {m.message_id: m for m in self.messages if m.message_id}

    @property
    def version_by_id(self) -> dict[str, CanonicalMessageDescriptor]:
        return {m.version_id: m for m in self.messages if m.version_id}

    def ordered_messages(self) -> list[CanonicalMessageDescriptor]:
        return sorted(self.messages, key=lambda m: m.ordinal)


@dataclass
class CurrentEvidenceLocator:
    evidence_id: str
    evidence_type: str | None = None
    sequence: int | None = None
    message_id: str | None = None
    version_id: str | None = None
    attachment_id: str | None = None


@dataclass
class CurrentDocument:
    frontmatter: dict[str, Any]
    body: str
    object_ids: set[str]
    refs: list[tuple[str, str, str]]
    evidence_locators: list[CurrentEvidenceLocator]
    duplicate_ids: list[str]


@dataclass
class PackageManifestInfo:
    raw: dict[str, Any]
    format: str | None
    format_version: str | None
    entrypoint: str
    entrypoint_source: str
    conversation: dict[str, Any]
    conversation_completeness: str | None
    asset_completeness: str | None
    attachments: dict[str, Any]
    included_content: dict[str, Any]
    files: dict[str, Any]
    continuation: dict[str, Any] | None
