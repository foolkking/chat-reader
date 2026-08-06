from __future__ import annotations

import io
import uuid

from sqlalchemy.orm import Session

from app.models.attachment import AssetDerivative, AssetObject, Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import scan_status_allows_use


class AssetDerivativeError(ValueError):
    pass


TEXT_TYPES = {"text/plain", "text/markdown", "text/csv", "application/json", "application/xml"}
GENERATOR_VERSION = "attachment-derivative-v1"


def build_asset_derivative(db: Session, *, attachment_id: uuid.UUID, derivative_type: str) -> AssetDerivative:
    if derivative_type != "text_extract":
        raise AssetDerivativeError("Only text_extract derivatives are enabled.")
    source = db.query(AssetObject).join(Attachment, Attachment.asset_object_id == AssetObject.id).filter(Attachment.id == attachment_id).first()
    if source is None or source.status != "available" or not scan_status_allows_use(source.scan_status):
        raise AssetDerivativeError("Attachment object is not available for derivative generation.")
    existing = db.query(AssetDerivative).filter(
        AssetDerivative.source_asset_object_id == source.id,
        AssetDerivative.derivative_type == derivative_type,
        AssetDerivative.generator_version == GENERATOR_VERSION,
        AssetDerivative.status == "ready",
    ).first()
    if existing is not None:
        _reindex_attachment_conversations(db, attachment_id)
        return existing
    if source.detected_mime_type not in TEXT_TYPES and not source.detected_mime_type.startswith("text/"):
        raise AssetDerivativeError("Text extraction is not supported for this MIME type.")
    source_path = get_asset_store().resolve_key(source.storage_key)
    with source_path.open("rb") as source_file:
        content = source_file.read(2 * 1024 * 1024)
    truncated = source.byte_size > len(content)
    if truncated:
        content += b"\n[truncated by preview limit]\n"
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("utf-8", errors="replace")
    payload = text.encode("utf-8")
    store = get_asset_store()
    staged = store.stage(io.BytesIO(payload), max_bytes=4 * 1024 * 1024, quarantine=False)
    derivative_asset = db.query(AssetObject).filter(
        AssetObject.sha256 == staged.sha256,
        AssetObject.byte_size == staged.byte_size,
        AssetObject.status == "available",
    ).first()
    if derivative_asset is not None and not scan_status_allows_use(derivative_asset.scan_status):
        derivative_asset = None
    if derivative_asset is not None:
        staged.path.unlink(missing_ok=True)
    else:
        storage_key = store.object_key()
        store.promote(staged.path, storage_key)
        derivative_asset = AssetObject(
            id=uuid.uuid4(),
            sha256=staged.sha256,
            byte_size=staged.byte_size,
            detected_mime_type="text/plain",
            detected_extension=".txt",
            storage_key=storage_key,
            scan_status=source.scan_status,
            status="available",
        )
        db.add(derivative_asset)
        db.flush()
    derivative = AssetDerivative(
        id=uuid.uuid4(),
        source_asset_object_id=source.id,
        derivative_asset_object_id=derivative_asset.id,
        derivative_type=derivative_type,
        generator="chat-reader",
        generator_version=GENERATOR_VERSION,
        status="ready",
        metadata_={"byte_size": len(payload), "truncated": truncated},
    )
    db.add(derivative)
    db.flush()
    _reindex_attachment_conversations(db, attachment_id)
    return derivative


def derivative_asset(db: Session, derivative_id: uuid.UUID) -> AssetObject | None:
    derivative = db.get(AssetDerivative, derivative_id)
    return db.get(AssetObject, derivative.derivative_asset_object_id) if derivative else None


def _reindex_attachment_conversations(db: Session, attachment_id: uuid.UUID) -> None:
    from app.services.search.search_indexer import rebuild_search_documents_for_conversation

    conversation_ids = {
        row[0]
        for row in (
            db.query(Message.conversation_id)
            .join(MessageVersion, MessageVersion.message_id == Message.id)
            .join(MessageVersionAttachment, MessageVersionAttachment.message_version_id == MessageVersion.id)
            .filter(MessageVersionAttachment.attachment_id == attachment_id)
            .all()
        )
    }
    for conversation_id in conversation_ids:
        rebuild_search_documents_for_conversation(db, conversation_id)
