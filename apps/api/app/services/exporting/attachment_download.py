from __future__ import annotations

import re
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.attachment import AssetObject, Attachment
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.services.assets.asset_store import get_asset_store
from app.services.artifact_lifecycle import publish_zip_artifact, staging_path

MAX_ATTACHMENTS = 500
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024


class AttachmentDownloadError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


def validate_attachment_download(db: Session, *, conversation_id: uuid.UUID, attachment_ids: list[uuid.UUID]) -> list[tuple[Attachment, AssetObject, Path]]:
    if not attachment_ids or len(attachment_ids) > MAX_ATTACHMENTS or len(set(attachment_ids)) != len(attachment_ids):
        raise AttachmentDownloadError("Select 1-500 distinct attachments.")
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise AttachmentDownloadError("Conversation not found.", 404)
    rows = (
        db.query(Attachment, AssetObject)
        .join(AssetObject, AssetObject.id == Attachment.asset_object_id)
        .filter(
            Attachment.id.in_(attachment_ids),
            Attachment.conversation_id == conversation_id,
            Attachment.status == "available",
            Attachment.deleted_at.is_(None),
            Attachment.resolution_status == "resolved",
            AssetObject.status == "available",
        )
        .all()
    )
    if len(rows) != len(attachment_ids):
        raise AttachmentDownloadError("One or more attachments are unavailable or outside this conversation.")
    by_id = {attachment.id: (attachment, asset) for attachment, asset in rows}
    total = sum(by_id[item][1].byte_size for item in attachment_ids)
    if total > MAX_TOTAL_BYTES:
        raise AttachmentDownloadError("Selected attachments exceed the 2 GiB batch limit.")
    result = []
    for attachment_id in attachment_ids:
        attachment, asset = by_id[attachment_id]
        try:
            path = get_asset_store().resolve_key(asset.storage_key)
        except (ValueError, FileNotFoundError) as exc:
            raise AttachmentDownloadError("An attachment object is missing.") from exc
        result.append((attachment, asset, path))
    return result


def create_attachment_download(db: Session, *, conversation_id: uuid.UUID, attachment_ids: list[uuid.UUID], job_id: uuid.UUID, progress_callback=None) -> ExportArtifact:
    rows = validate_attachment_download(db, conversation_id=conversation_id, attachment_ids=attachment_ids)
    conversation = db.get(Conversation, conversation_id)
    export_root = Path(get_settings().export_storage_dir).resolve()
    export_dir = (export_root / str(job_id)).resolve()
    if not export_dir.is_relative_to(export_root):
        raise AttachmentDownloadError("Invalid export path.")
    export_dir.mkdir(parents=True, exist_ok=True)
    destination = export_dir / f"{_safe_name(conversation.display_title if conversation else 'attachments')}-attachments.zip"
    temporary = staging_path(destination)
    names = _entry_names(rows)
    artifact_id = uuid.uuid4()
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as archive:
            for index, ((attachment, _asset, path), entry_name) in enumerate(zip(rows, names, strict=True), start=1):
                archive.write(path, entry_name)
                if progress_callback:
                    progress_callback("assets", min(98, int(index * 98 / len(rows))), index, len(rows))
        published = publish_zip_artifact(
            temporary, destination, category="export", artifact_id=artifact_id, required_entries=(names[0],)
        )
    finally:
        temporary.unlink(missing_ok=True)
    artifact = ExportArtifact(
        id=artifact_id, job_id=job_id, conversation_id=conversation_id, scope_type="conversation",
        format="attachment-batch-zip", filename=destination.name, storage_uri=str(destination),
        sha256=published.sha256, byte_size=published.byte_size,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(artifact)
    db.flush()
    return artifact


def _entry_names(rows: list[tuple[Attachment, AssetObject, Path]]) -> list[str]:
    used: set[str] = set()
    output: list[str] = []
    for attachment, asset, _path in rows:
        name = _safe_name(attachment.display_name)
        candidate = name
        if candidate.casefold() in used:
            stem, suffix = Path(name).stem, Path(name).suffix
            candidate = f"{stem}--{asset.sha256[:6]}{suffix}"
        counter = 2
        while candidate.casefold() in used:
            stem, suffix = Path(name).stem, Path(name).suffix
            candidate = f"{stem}--{asset.sha256[:6]}-{counter}{suffix}"
            counter += 1
        used.add(candidate.casefold())
        output.append(candidate)
    return output


def _safe_name(value: str) -> str:
    name = Path(value.replace("\\", "/")).name.strip().replace("\r", "_").replace("\n", "_")
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name[:220] or "attachment.bin"
