"""One ordinary export file, streamed into the existing retained ZIP lifecycle."""
from datetime import datetime, timedelta, timezone
from dataclasses import replace
from pathlib import Path
import time
import uuid
import zipfile

from sqlalchemy import select

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from app.schemas.export import ExportRequest
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path
from app.services.assets.asset_store import LocalAssetStore
from app.services.exporting.archive_transaction import archive_read_snapshot, track_archive_object
from app.services.exporting.export_service import (
    ExportError, _write_export_event, _gzip_chunks, export_conversation_canjson_v2,
    export_conversation_markdown_v2,
)

FORMAT = "chat-reader-plain-export"


def _require_source(db, conversation_id, scope):
    if scope.owner_user_id is not None:
        user = db.get(User, scope.owner_user_id, populate_existing=True)
        if user is None or not user.can_login:
            raise ExportError("PLAIN_EXPORT_ACCOUNT_UNAVAILABLE", 403)
    conversation = db.scalar(select(Conversation).where(Conversation.id == conversation_id,
        scope.predicate(Conversation)).execution_options(populate_existing=True))
    if conversation is None or conversation.deleted_at is not None:
        raise ExportError("PLAIN_EXPORT_SOURCE_UNAVAILABLE", 404)
    return conversation


def create_plain_export(db, *, job, ownership_scope, progress_callback):
    request = ExportRequest.model_validate(job.payload["plain_options"])
    if request.format not in {"markdown_v2", "canjson_v2"}:
        raise ExportError("Unsupported plain export format.", 422)
    options = request.to_options()
    conversation_id = uuid.UUID(job.payload["conversation_id"])
    settings = get_settings()
    root = Path(settings.export_storage_dir).resolve()
    directory = (root / str(job.id)).resolve()
    if not directory.is_relative_to(root):
        raise ExportError("PLAIN_EXPORT_STORAGE_UNAVAILABLE", 503)
    temporary = None
    try:
        with archive_read_snapshot(db) as snapshot:
            _require_source(snapshot, conversation_id, ownership_scope)
            exporter = export_conversation_markdown_v2 if request.format == "markdown_v2" else export_conversation_canjson_v2
            result = exporter(snapshot, conversation_id, replace(options, compression="none"), record_event=False)
            # Serializer filenames are already sanitized; never accept a path
            # or a client-supplied ZIP member name as a publication destination.
            name = result.filename + (".gz" if options.compression == "gzip" else "")
            if Path(name).name != name or "/" in name or "\\" in name:
                raise ExportError("PLAIN_EXPORT_STORAGE_UNAVAILABLE", 503)
            destination = directory / f"{name}.zip"
            source = iter(result.content)
            expanded, last_report = 0, 0.0
            def bounded():
                nonlocal expanded, last_report
                for chunk in source:
                    expanded += len(chunk)
                    if expanded > settings.bundle_max_expanded_bytes:
                        raise ExportError("PLAIN_EXPORT_LIMIT", 413)
                    if time.monotonic() - last_report >= 0.25:
                        # Count before optional gzip, including compressible
                        # content that does not yet produce an output chunk.
                        progress_callback("exporting", 5, 0, result.message_count)
                        last_report = time.monotonic()
                    yield chunk
            chunks = _gzip_chunks(bounded()) if options.compression == "gzip" else bounded()
            try:
                temporary = staging_path(destination)
                progress_callback("exporting", 5, 0, result.message_count)
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                     allowZip64=True, compresslevel=6) as archive:
                    with archive.open(name, "w", force_zip64=True) as entry:
                        for chunk in chunks:
                            entry.write(chunk)
                            if archive.fp.tell() > settings.bundle_max_compressed_bytes:
                                raise ExportError("PLAIN_EXPORT_LIMIT", 413)
            finally:
                close = getattr(chunks, "close", None)
                if close is not None:
                    close()
                source_close = getattr(source, "close", None)
                if source_close is not None:
                    source_close()
        _require_source(db, conversation_id, ownership_scope)
        progress_callback("publishing", 95, result.message_count, result.message_count)
        if temporary.stat().st_size > settings.bundle_max_compressed_bytes:
            raise ExportError("PLAIN_EXPORT_LIMIT", 413)
        artifact_id = uuid.uuid4()
        track_archive_object(db, LocalAssetStore(root), destination.relative_to(root).as_posix())
        published = publish_zip_artifact(temporary, destination, category="export",
            artifact_id=artifact_id, required_entries=(name,))
        artifact = ExportArtifact(id=artifact_id, job_id=job.id, conversation_id=conversation_id,
            format=FORMAT, filename=destination.name, storage_uri=str(destination),
            sha256=published.sha256, byte_size=published.byte_size,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
        db.add(artifact)
        _write_export_event(db, conversation_id, options, result.message_count)
        db.flush()
        return artifact
    except OSError as error:
        raise ExportError("PLAIN_EXPORT_STORAGE_UNAVAILABLE", 503) from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
