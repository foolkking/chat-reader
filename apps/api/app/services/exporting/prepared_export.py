"""Prepare direct downloads from one snapshot, without holding it for the client."""
from collections.abc import Iterator
from tempfile import SpooledTemporaryFile
from typing import BinaryIO
from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.schemas.export import ExportOptions, StreamingExportResult
from app.services.exporting.archive_transaction import archive_read_snapshot
from app.services.exporting.export_service import (
    ExportError,
    _write_export_event,
    export_conversation_canjson_v2,
    export_conversation_canonical_json,
    export_conversation_markdown_streaming,
    export_conversation_markdown_v2,
    _get_conversation, _safe_filename, _subject_key_for_conversation,
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


def prepare_annotation_export(db: Session, conversation_id: UUID) -> StreamingExportResult:
    from app.core.config import get_settings
    from app.services.exporting.annotation_document import annotation_query, iter_document
    stream = SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
    try:
        with archive_read_snapshot(db) as snapshot:
            conversation = _get_conversation(snapshot, conversation_id)
            query = annotation_query(snapshot, conversation_id, _subject_key_for_conversation(conversation))
            count = query.order_by(None).count()
            filename = f"{_safe_filename(conversation.display_title or conversation.title)}--annotations.md"
            for chunk in iter_document(query, title=conversation.display_title or conversation.title,
                exported_at=datetime.now(timezone.utc), scope="all_non_deleted_annotations"):
                if stream.tell() + len(chunk) > get_settings().bundle_max_expanded_bytes:
                    raise ExportError("Annotation export exceeds the download size limit.", 413)
                stream.write(chunk)
        size = stream.tell()
        stream.seek(0)
        return StreamingExportResult(content=PreparedExportContent(stream, size),
            media_type="text/markdown; charset=utf-8", filename=filename, message_count=count)
    except BaseException as exc:
        stream.close()
        if isinstance(exc, OSError):
            raise ExportError("The download could not be prepared. Please try again.", 503) from exc
        raise


def prepare_direct_export(db: Session, conversation_id: UUID, options: ExportOptions) -> StreamingExportResult:
    exporters = {
        "markdown": export_conversation_markdown_streaming,
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
