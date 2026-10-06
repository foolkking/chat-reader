"""Prepare direct downloads from one snapshot, without holding it for the client."""
from collections.abc import Iterator
from tempfile import SpooledTemporaryFile
from typing import BinaryIO
from uuid import UUID

from sqlalchemy.orm import Session

from app.schemas.export import ExportOptions, StreamingExportResult
from app.services.exporting.archive_transaction import archive_read_snapshot
from app.services.exporting.export_service import (
    ExportError,
    _write_export_event,
    export_conversation_canjson_v2,
    export_conversation_canonical_json,
    export_conversation_markdown,
    export_conversation_markdown_v2,
)


class PreparedExportContent(Iterator[bytes]):
    def __init__(self, stream: BinaryIO, size: int):
        self.stream = stream
        self.size = size

    def __next__(self) -> bytes:
        if self.stream.closed:
            raise StopIteration
        chunk = self.stream.read(64 * 1024)
        if not chunk:
            self.close()
            raise StopIteration
        return chunk

    def close(self) -> None:
        self.stream.close()


def prepare_direct_export(db: Session, conversation_id: UUID, options: ExportOptions) -> StreamingExportResult:
    exporters = {
        "markdown": export_conversation_markdown,
        "markdown_v2": export_conversation_markdown_v2,
        "canonical_json": export_conversation_canonical_json,
        "canjson_v2": export_conversation_canjson_v2,
    }
    exporter = exporters.get(options.format)
    if exporter is None:
        raise ExportError("Unsupported export format.")
    # Large responses spill to a private, automatically removed temporary file.
    # TEMP/TMP selects the task directory in local tests; no canonical file is used.
    stream = None
    try:
        stream = SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
        with archive_read_snapshot(db) as snapshot:
            result = exporter(snapshot, conversation_id, options, record_event=False)
            chunks = iter([result.content.encode("utf-8")]) if isinstance(result.content, str) else iter(result.content)
            try:
                for chunk in chunks:
                    stream.write(chunk)
            finally:
                close = getattr(chunks, "close", None)
                if close is not None:
                    close()
        size = stream.tell()
        stream.seek(0)
        _write_export_event(db, conversation_id, options, result.message_count)
        return StreamingExportResult(
            content=PreparedExportContent(stream, size),
            media_type=result.media_type,
            filename=result.filename,
            message_count=result.message_count,
        )
    except BaseException as exc:
        if stream is not None:
            stream.close()
        if isinstance(exc, OSError):
            raise ExportError("The download could not be prepared. Please try again.", 503) from exc
        raise
