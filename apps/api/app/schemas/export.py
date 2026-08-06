from dataclasses import dataclass
from collections.abc import Iterable
from uuid import UUID
from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


@dataclass(frozen=True)
class ExportOptions:
    format: str
    message_ids: list[UUID]
    include_metadata: bool = True
    include_toc: bool = True
    include_versions: bool = False
    include_description: bool = False
    include_annotations: bool = False
    include_notebook: bool = False
    include_source_refs: bool = True
    toc_mode: str = "none"
    compression: str = "none"
    preserve_attachment_uris: bool = False


class ExportRequest(BaseModel):
    format: Literal["markdown_v2", "canjson_v2", "markdown_bundle", "canjson_bundle", "cr_v2", "context_package"]
    message_ids: list[UUID] | None = None
    version_scope: Literal["current", "all"] = "current"
    include_metadata: bool = True
    include_description: bool = False
    annotation_scope: Literal["none", "all"] = "none"
    notebook_scope: Literal["none", "current"] = "none"
    include_source_refs: bool = True
    toc_mode: Literal["none", "message_index", "bounded_headings"] = "none"
    compression: Literal["none", "gzip"] = "none"
    context_scope: Literal["full_conversation", "reading_scope"] = "full_conversation"
    start_message_id: UUID | None = None

    @field_validator("message_ids")
    @classmethod
    def validate_message_ids(cls, value: list[UUID] | None) -> list[UUID] | None:
        if value is None:
            return None
        if len(value) > 100_000:
            raise ValueError("message_ids cannot contain more than 100,000 entries")
        if len(value) != len(set(value)):
            raise ValueError("message_ids cannot contain duplicates")
        return value

    @model_validator(mode="after")
    def validate_format_options(self) -> "ExportRequest":
        if self.format == "markdown_v2" and self.compression != "none":
            raise ValueError("Markdown v2 does not support compression")
        if self.format == "canjson_v2" and self.toc_mode != "none":
            raise ValueError("CanJSON v2 does not contain a TOC")
        if self.format in {"markdown_bundle", "canjson_bundle"}:
            if self.message_ids or self.version_scope != "current":
                raise ValueError("Attachment bundles export the current conversation only")
            if self.toc_mode != "none" or self.compression != "none":
                raise ValueError("Attachment bundles do not accept TOC or compression options")
        if self.format == "cr_v2":
            if self.message_ids:
                raise ValueError(".cr archives cannot be limited to selected messages")
            if self.toc_mode != "none" or self.compression != "none":
                raise ValueError(".cr archives do not accept TOC or compression options")
        if self.format == "context_package":
            if self.message_ids or self.version_scope != "current":
                raise ValueError("Context packages export current versions in a contiguous scope")
            if self.context_scope == "reading_scope" and self.start_message_id is None:
                raise ValueError("Reading scope requires start_message_id")
            if self.toc_mode != "none" or self.compression != "none":
                raise ValueError("Context packages do not accept TOC or compression options")
        return self

    def to_options(self) -> ExportOptions:
        return ExportOptions(
            format=self.format,
            message_ids=self.message_ids or [],
            include_metadata=self.include_metadata,
            include_toc=self.toc_mode != "none",
            include_versions=self.version_scope == "all",
            include_description=self.include_description,
            include_annotations=self.annotation_scope == "all",
            include_notebook=self.notebook_scope == "current",
            include_source_refs=self.include_source_refs,
            toc_mode=self.toc_mode,
            compression=self.compression,
        )


@dataclass(frozen=True)
class ExportResult:
    content: str
    media_type: str
    filename: str
    message_count: int


@dataclass(frozen=True)
class StreamingExportResult:
    content: Iterable[bytes]
    media_type: str
    filename: str
    message_count: int
