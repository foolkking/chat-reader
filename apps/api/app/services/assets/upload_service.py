from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import BinaryIO

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.attachment import (
    AssetObject,
    Attachment,
    AttachmentUploadItem,
    AttachmentUploadSession,
    MessageVersionAttachment,
)
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import AssetScanError, detect_mime_type, scan_attachment, scan_status_allows_use


class AttachmentUploadError(ValueError):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class FinalizeResult:
    attachments: list[Attachment]
    promoted_storage_keys: list[str]


def create_upload_session(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    target_message_id: uuid.UUID | None,
    base_message_version_id: uuid.UUID | None,
) -> AttachmentUploadSession:
    settings = get_settings()
    if not settings.attachment_upload_enabled:
        raise AttachmentUploadError("Attachment uploads are disabled.", 503)
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None or conversation.status != "active":
        raise AttachmentUploadError("Conversation not found.", 404)
    if target_message_id is not None:
        message = db.get(Message, target_message_id)
        if message is None or message.conversation_id != conversation_id or message.is_deleted:
            raise AttachmentUploadError("Target message does not belong to the conversation.", 422)
        if base_message_version_id is not None and message.current_version_id != base_message_version_id:
            raise AttachmentUploadError("Base message version does not match the current version.", 409)
    session = AttachmentUploadSession(
        id=uuid.uuid4(),
        conversation_id=conversation_id,
        target_message_id=target_message_id,
        base_message_version_id=base_message_version_id,
        status="open",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.attachment_upload_ttl_hours),
    )
    db.add(session)
    db.flush()
    return session


def get_upload_session(db: Session, session_id: uuid.UUID, *, lock: bool = False) -> AttachmentUploadSession:
    query = db.query(AttachmentUploadSession).filter(AttachmentUploadSession.id == session_id)
    if lock:
        query = query.with_for_update()
    session = query.one_or_none()
    if session is None:
        raise AttachmentUploadError("Attachment upload session not found.", 404)
    expires_at = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc) and session.status == "open":
        session.status = "expired"
    return session


def add_upload_item(
    db: Session,
    *,
    session_id: uuid.UUID,
    filename: str,
    declared_mime_type: str | None,
    source: BinaryIO,
) -> AttachmentUploadItem:
    session = get_upload_session(db, session_id, lock=True)
    if session.status != "open":
        raise AttachmentUploadError("Attachment upload session is not open.", 409)
    safe_name = Path(filename).name.replace("\r", "_").replace("\n", "_")[:500] or "attachment.bin"
    store = get_asset_store()
    try:
        staged = store.stage(source, max_bytes=get_settings().bundle_max_object_bytes, quarantine=True)
    except ValueError as exc:
        raise AttachmentUploadError(str(exc), 413) from exc
    try:
        detected_mime, _ = detect_mime_type(staged.path, safe_name)
        scan = scan_attachment(staged.path)
    except AssetScanError as exc:
        staged.path.unlink(missing_ok=True)
        raise AttachmentUploadError(str(exc), 503) from exc
    validation_status = "ready" if scan.allowed_by_policy else "rejected"
    item = AttachmentUploadItem(
        id=uuid.uuid4(),
        session_id=session.id,
        client_filename=safe_name,
        declared_mime_type=declared_mime_type,
        detected_mime_type=detected_mime,
        byte_size=staged.byte_size,
        temporary_storage_key=store.temporary_key(staged.path),
        sha256=staged.sha256,
        validation_status=validation_status,
        scan_status=scan.status,
        error_code=None if scan.allowed_by_policy else scan.status,
    )
    db.add(item)
    db.flush()
    return item


def delete_upload_item(db: Session, *, session_id: uuid.UUID, item_id: uuid.UUID) -> None:
    session = get_upload_session(db, session_id, lock=True)
    item = db.get(AttachmentUploadItem, item_id)
    if item is None or item.session_id != session.id:
        raise AttachmentUploadError("Attachment upload item not found.", 404)
    if session.status != "open":
        raise AttachmentUploadError("Committed upload items cannot be removed.", 409)
    if item.temporary_storage_key:
        get_asset_store().delete_key(item.temporary_storage_key)
    db.delete(item)
    db.flush()


def finalize_upload_items(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    item_ids: list[uuid.UUID],
    source_type: str = "upload",
) -> FinalizeResult:
    if not item_ids or len(item_ids) != len(set(item_ids)):
        raise AttachmentUploadError("Upload item ids must be present and unique.", 422)
    items = (
        db.query(AttachmentUploadItem)
        .join(AttachmentUploadSession, AttachmentUploadSession.id == AttachmentUploadItem.session_id)
        .filter(AttachmentUploadItem.id.in_(item_ids))
        .with_for_update()
        .all()
    )
    if len(items) != len(item_ids):
        raise AttachmentUploadError("One or more upload items were not found.", 404)
    sessions = {item.session_id: item.session for item in items}
    if any(session.conversation_id != conversation_id for session in sessions.values()):
        raise AttachmentUploadError("Upload items belong to another conversation.", 422)
    if any(session.status != "open" for session in sessions.values()):
        raise AttachmentUploadError("Upload session is not open.", 409)
    if any(item.validation_status != "ready" or not scan_status_allows_use(item.scan_status) for item in items):
        raise AttachmentUploadError("One or more upload items are not ready.", 422)

    store = get_asset_store()
    promoted: list[str] = []
    created: list[Attachment] = []
    try:
        for item in items:
            if not item.temporary_storage_key or not item.sha256 or not item.detected_mime_type:
                raise AttachmentUploadError("Upload item staging data is incomplete.", 422)
            staged_path = store.resolve_temporary_key(item.temporary_storage_key)
            asset = (
                db.query(AssetObject)
                .filter(AssetObject.sha256 == item.sha256, AssetObject.byte_size == item.byte_size)
                .one_or_none()
            )
            if asset is None:
                storage_key = store.object_key()
                store.promote(staged_path, storage_key)
                promoted.append(storage_key)
                _, detected_extension = detect_mime_type(store.resolve_key(storage_key), item.client_filename)
                asset = AssetObject(
                    id=uuid.uuid4(),
                    sha256=item.sha256,
                    byte_size=item.byte_size,
                    detected_mime_type=item.detected_mime_type,
                    detected_extension=detected_extension,
                    storage_backend=store.backend,
                    storage_key=storage_key,
                    scan_status=item.scan_status,
                    status="available",
                )
                db.add(asset)
                db.flush()
            else:
                staged_path.unlink(missing_ok=True)
                if asset.status != "available" or not scan_status_allows_use(asset.scan_status):
                    raise AttachmentUploadError("Matching asset object is unavailable.", 423)
            attachment = Attachment(
                id=uuid.uuid4(),
                conversation_id=conversation_id,
                asset_object_id=asset.id,
                import_id=None,
                original_filename=item.client_filename,
                display_name=item.client_filename,
                declared_mime_type=item.declared_mime_type,
                detected_mime_type=item.detected_mime_type,
                status="available",
                scan_status=item.scan_status,
                source_type=source_type,
                source_attachment_id=str(item.id),
                metadata_={},
                resolution_status="resolved",
            )
            db.add(attachment)
            item.validation_status = "committed"
            item.temporary_storage_key = None
            created.append(attachment)
        for session in sessions.values():
            if all(item.validation_status == "committed" for item in session.items):
                session.status = "committed"
        db.flush()
        return FinalizeResult(attachments=created, promoted_storage_keys=promoted)
    except Exception:
        for storage_key in promoted:
            store.delete_key(storage_key)
        raise


def remove_unreferenced_attachment(db: Session, attachment: Attachment) -> str | None:
    current_reference = (
        db.query(MessageVersionAttachment.id)
        .join(MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id)
        .join(Message, Message.id == MessageVersion.message_id)
        .filter(
            MessageVersionAttachment.attachment_id == attachment.id,
            Message.current_version_id == MessageVersionAttachment.message_version_id,
            Message.is_deleted.is_(False),
        )
        .first()
    )
    if current_reference is not None:
        raise AttachmentUploadError("Attachment is still used by a current message version.", 409)
    attachment.status = "detached"
    db.flush()
    return None
