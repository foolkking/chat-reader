"""Durable multi-conversation CanJSON download, with bounded sequential writes."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import time
import uuid
import zipfile

from sqlalchemy import select

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path
from app.services.assets.asset_store import LocalAssetStore
from app.services.exporting.archive_jobs import _existing
from app.models.user import User
from app.services.exporting.archive_transaction import archive_read_snapshot, track_archive_object
from app.services.exporting.export_service import ExportError, ExportOptions, _write_export_event, export_conversation_canjson_v2
from app.services.ownership import get_owned

JOB_TYPE = "conversation_batch_export"
FORMAT = "chat-reader-conversation-batch"


def _require_sources(db, ids, scope):
    if not ids or len(ids) > 5000 or len(ids) != len(set(ids)):
        raise ExportError("Select between 1 and 5000 distinct conversations.", 422)
    if scope.owner_user_id is not None:
        user = db.get(User, scope.owner_user_id, populate_existing=True)
        if user is None or not user.can_login:
            raise ExportError("BATCH_EXPORT_ACCOUNT_UNAVAILABLE", 403)
    found = set(db.scalars(select(Conversation.id).where(
        Conversation.id.in_(ids), scope.predicate(Conversation), Conversation.deleted_at.is_(None))))
    if found != set(ids):
        raise ExportError("BATCH_EXPORT_SOURCE_UNAVAILABLE", 404)


def queue_conversation_batch_export(db, *, conversation_ids, idempotency_key, ownership_scope):
    _require_sources(db, conversation_ids, ownership_scope)
    existing = _existing(db, ownership_scope.owner_user_id, JOB_TYPE, idempotency_key)
    ids = [str(value) for value in conversation_ids]
    if existing is not None:
        if existing.payload.get("conversation_ids") != ids:
            raise ExportError("This request key was already used for a different selection.", 409)
        return existing
    job = BackgroundJob(id=uuid.uuid4(), owner_user_id=ownership_scope.owner_user_id,
        job_type=JOB_TYPE, status="queued", phase="queued", total_items=len(ids),
        progress=0, processed_items=0, payload={"conversation_ids": ids}, result={},
        idempotency_key=idempotency_key)
    db.add(job)
    db.flush()
    return job


def create_conversation_batch_export(db, *, job, ownership_scope, progress_callback):
    ids = [uuid.UUID(value) for value in job.payload["conversation_ids"]]
    settings = get_settings()
    root = Path(settings.export_storage_dir).resolve()
    directory = (root / str(job.id)).resolve()
    if not directory.is_relative_to(root):
        raise ExportError("BATCH_EXPORT_STORAGE_UNAVAILABLE", 503)
    filename = f"chat-reader-export-{job.queued_at:%Y-%m-%d}.zip"
    destination = directory / filename
    temporary = None
    entries, counts = [], []
    expanded = 0
    last_report = 0.0
    options = ExportOptions(format="canjson_v2", message_ids=[], include_annotations=False, include_notebook=False)
    try:
        temporary = staging_path(destination)
        if len(ids) > settings.bundle_max_entries:
            raise ExportError("BATCH_EXPORT_LIMIT", 413)
        with archive_read_snapshot(db) as snapshot:
            _require_sources(snapshot, ids, ownership_scope)
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED,
                                 allowZip64=True, compresslevel=6) as archive:
                for index, conversation_id in enumerate(ids):
                    progress_callback("exporting", 5 + int(85 * index / len(ids)), index, len(ids))
                    conversation = get_owned(snapshot, Conversation, conversation_id, ownership_scope)
                    name = f"{index + 1:03}-{_safe_name(conversation.display_title)}.canonical.jsonl"
                    entries.append(name)
                    result = export_conversation_canjson_v2(snapshot, conversation_id, options, record_event=False)
                    counts.append(result.message_count)
                    chunks = iter(result.content)
                    try:
                        with archive.open(name, "w", force_zip64=True) as entry:
                            for chunk in chunks:
                                expanded += len(chunk)
                                if expanded > settings.bundle_max_expanded_bytes:
                                    raise ExportError("BATCH_EXPORT_LIMIT", 413)
                                entry.write(chunk)
                                if archive.fp.tell() > settings.bundle_max_compressed_bytes:
                                    raise ExportError("BATCH_EXPORT_LIMIT", 413)
                                if time.monotonic() - last_report >= 0.25:
                                    progress_callback("exporting", 5 + int(85 * index / len(ids)), index, len(ids))
                                    last_report = time.monotonic()
                    finally:
                        close = getattr(chunks, "close", None)
                        if close is not None:
                            close()
        # Recheck current access before publishing; a missing source never becomes
        # an apparently complete download with silently omitted conversations.
        _require_sources(db, ids, ownership_scope)
        progress_callback("publishing", 95, len(ids), len(ids))
        if temporary.stat().st_size > settings.bundle_max_compressed_bytes:
            raise ExportError("BATCH_EXPORT_LIMIT", 413)
        artifact_id = uuid.uuid4()
        # Also cover cancellation/commit failures after rename, not only ZIP errors.
        track_archive_object(db, LocalAssetStore(root), destination.relative_to(root).as_posix())
        published = publish_zip_artifact(temporary, destination, category="export",
            artifact_id=artifact_id, required_entries=tuple(entries))
        artifact = ExportArtifact(id=artifact_id, job_id=job.id, scope_type="conversation_batch",
            format=FORMAT, filename=filename, storage_uri=str(destination),
            sha256=published.sha256, byte_size=published.byte_size,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
        db.add(artifact)
        for conversation_id, count in zip(ids, counts):
            _write_export_event(db, conversation_id, options, count)
        db.flush()
        return artifact
    except OSError as error:
        raise ExportError("BATCH_EXPORT_STORAGE_UNAVAILABLE", 503) from error
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink(missing_ok=True)


def _safe_name(value):
    return re.sub(r"\s+", " ", re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", value)).strip()[:80] or "conversation"
