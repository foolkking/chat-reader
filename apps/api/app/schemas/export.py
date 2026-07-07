from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class ExportOptions:
    format: str
    message_ids: list[UUID]
    include_metadata: bool = True
    include_toc: bool = True
    include_versions: bool = False


@dataclass(frozen=True)
class ExportResult:
    content: str
    media_type: str
    filename: str
    message_count: int
