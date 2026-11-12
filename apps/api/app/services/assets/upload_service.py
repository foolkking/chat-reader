from __future__ import annotations

import uuid
import shutil
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import BinaryIO

from sqlalchemy.orm import Session
from sqlalchemy import text

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
from app.services.ownership import OwnershipScope


def _bound_upload_write(db: Session) -> None:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SET LOCAL lock_timeout = '1500ms'"))
        db.execute(text("SET LOCAL statement_timeout = '30000ms'"))


class AttachmentUploadError(ValueError):
    def __init__(self, message: str, status_code: int = 400, *, code: str | None = None, details: dict | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.detail = {"code": code, "message": message, **(details or {})} if code else message


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
    request_id: uuid.UUID | None = None,
) -> AttachmentUploadSession:
    _bound_upload_write(db)
    settings = get_settings()
    if not settings.attachment_upload_enabled:
        raise AttachmentUploadError("Attachment uploads are disabled.", 503)
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None or conversation.status != "active":
        raise AttachmentUploadError("Conversation not found.", 404)
    # Serialize request identities with the owned parent, including two
    # requests whose responses race or are lost.
    db.query(Conversation.id).filter(Conversation.id == conversation_id).with_for_update(key_share=True).one()
    if request_id:
        existing = db.get(AttachmentUploadSession, request_id)
        if existing:
            if (existing.conversation_id, existing.target_message_id, existing.base_message_version_id) != (
                conversation_id, target_message_id, base_message_version_id,
            ):
                raise AttachmentUploadError("Upload request identity conflicts with its original target.", 409)
            return existing
    if target_message_id is not None:
        message = db.get(Message, target_message_id)
        if message is None or message.conversation_id != conversation_id or message.is_deleted:
            raise AttachmentUploadError("Target message does not belong to the conversation.", 422)
        if base_message_version_id is not None and message.current_version_id != base_message_version_id:
            raise AttachmentUploadError("Base message version does not match the current version.", 409)
    session = AttachmentUploadSession(
        id=request_id or uuid.uuid4(),
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
    from app.services.worker_maintenance import bound_worker_transaction
    _bound_upload_write(db) if lock else bound_worker_transaction(db)
    query = db.query(AttachmentUploadSession).filter(AttachmentUploadSession.id == session_id)
    if lock:
        query = query.with_for_update()
    session = query.one_or_none()
    if session is None:
        raise AttachmentUploadError("Attachment upload session not found.", 404)
    expires_at = session.expires_at if session.expires_at.tzinfo else session.expires_at.replace(tzinfo=timezone.utc)
    if lock and expires_at <= datetime.now(timezone.utc) and session.status == "open":
        session.status = "expired"
    return session


def add_upload_item(
    db: Session,
    *,
    session_id: uuid.UUID,
    filename: str,
    declared_mime_type: str | None,
    source: BinaryIO,
    request_id: uuid.UUID | None = None,
) -> AttachmentUploadItem:
    session = get_upload_session(db, session_id, lock=True)
    existing = db.get(AttachmentUploadItem, request_id) if request_id else None
    if existing and existing.session_id != session.id:
        raise AttachmentUploadError("Upload request identity conflicts with its original session.", 409)
    if session.status != "open" and not existing:
        raise AttachmentUploadError("Attachment upload session is not open.", 409)
    safe_name = Path(filename).name.replace("\r", "_").replace("\n", "_")[:500] or "attachment.bin"
    store = get_asset_store()
    try:
        staged = store.stage(
            source,
            max_bytes=get_settings().max_attachment_file_size_mb * 1024 * 1024,
            quarantine=True,
        )
    except ValueError as exc:
        raise AttachmentUploadError(str(exc), 413) from exc
    if existing:
        try:
            if (existing.sha256, existing.byte_size, existing.client_filename, existing.declared_mime_type) != (
                staged.sha256, staged.byte_size, safe_name, declared_mime_type,
            ):
                raise AttachmentUploadError("Upload request identity conflicts with its original file.", 409)
            return existing
        finally:
            from app.services.artifact_lifecycle import discard_owned_temporary
            discard_owned_temporary(staged.path, category="duplicate_upload")
    from app.services.exporting.archive_transaction import track_archive_object
    track_archive_object(db, store, store.temporary_key(staged.path))
    try:
        detected_mime, _ = detect_mime_type(staged.path, safe_name)
        scan = scan_attachment(staged.path)
    except AssetScanError as exc:
        from app.services.artifact_lifecycle import discard_owned_temporary
        discard_owned_temporary(staged.path, category="rejected_upload")
        raise AttachmentUploadError(str(exc), 503) from exc
    validation_status = "ready" if scan.allowed_by_policy else "rejected"
    item = AttachmentUploadItem(
        id=request_id or uuid.uuid4(),
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
        from app.services.exporting.archive_transaction import release_staging_after_commit
        release_staging_after_commit(db, get_asset_store(), item.temporary_storage_key)
    # Keep the cleanup receipt until bytes are actually released. It cannot
    # authorize a later finalize, but failed cleanup remains discoverable.
    item.validation_status = "abandoned"
    db.flush()


def finalize_upload_items(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    item_ids: list[uuid.UUID],
    source_type: str = "upload",
    image_lane_width: int | None = None,
    ownership_scope: OwnershipScope | None = None,
) -> FinalizeResult:
    _bound_upload_write(db)
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
    if all(item.validation_status == "committed" for item in items):
        attachments = (
            db.query(Attachment)
            .filter(
                Attachment.conversation_id == conversation_id,
                Attachment.source_type == source_type,
                Attachment.source_attachment_id.in_([str(item.id) for item in items]),
            )
            .all()
        )
        by_source_id = {attachment.source_attachment_id: attachment for attachment in attachments}
        ordered = [by_source_id.get(str(item_id)) for item_id in item_ids]
        if all(attachment is not None for attachment in ordered):
            return FinalizeResult(
                attachments=[attachment for attachment in ordered if attachment is not None],
                promoted_storage_keys=[],
            )
        raise AttachmentUploadError("Committed upload attachment was not found.", 409)
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
                .with_for_update()
                .one_or_none()
            )
            reusable_deleted = asset is not None and asset.status == "deleted" and asset.storage_deleted_at is not None
            if reusable_deleted:
                from app.services.assets.lifecycle import asset_object_has_live_references
                if asset_object_has_live_references(db, asset.id):
                    raise AttachmentUploadError("Matching asset is protected by existing references.", 423)
            if asset is None or reusable_deleted:
                storage_key = store.object_key()
                # The original staged input belongs to the upload receipt,
                # not this attempt. A rollback must leave it retryable.
                if shutil.disk_usage(staged_path.parent).free < item.byte_size + 16 * 1024 * 1024:
                    raise AttachmentUploadError("Insufficient staging space; the uploaded file is retained.", 507)
                with staged_path.open("rb") as source:
                    prepared = store.stage(source, max_bytes=item.byte_size, quarantine=False)
                if prepared.sha256 != item.sha256 or prepared.byte_size != item.byte_size:
                    try:
                        prepared.path.unlink(missing_ok=True)
                    except OSError:
                        logging.getLogger(__name__).warning("prepared_upload_cleanup_deferred")
                    raise AttachmentUploadError("Uploaded file changed; replace the source file.", 409)
                try:
                    store.promote(prepared.path, storage_key)
                finally:
                    try:
                        prepared.path.unlink(missing_ok=True)
                    except OSError:
                        logging.getLogger(__name__).warning("prepared_upload_cleanup_deferred")
                promoted.append(storage_key)
                from app.services.exporting.archive_transaction import track_archive_object
                track_archive_object(db, store, storage_key)
                _, detected_extension = detect_mime_type(store.resolve_key(storage_key), item.client_filename)
                if asset is None:
                    asset = AssetObject(id=uuid.uuid4(), sha256=item.sha256, byte_size=item.byte_size)
                    db.add(asset)
                asset.detected_mime_type = item.detected_mime_type
                asset.detected_extension = detected_extension
                asset.storage_backend, asset.storage_key = store.backend, storage_key
                asset.scan_status, asset.status = item.scan_status, "available"
                asset.deleted_at = asset.storage_deleted_at = None
                db.flush()
            else:
                if asset.status != "available" or not scan_status_allows_use(asset.scan_status):
                    raise AttachmentUploadError("Matching asset object is unavailable.", 423)
                # Never accept a deduplicated metadata row whose bytes vanished.
                store.resolve_key(asset.storage_key)
            from app.services.assets.image_geometry import ingested_geometry
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
                metadata_=ingested_geometry(asset),
                resolution_status="resolved",
            )
            db.add(attachment)
            from app.services.exporting.archive_transaction import release_staging_after_commit
            release_staging_after_commit(db, store, item.temporary_storage_key)
            item.validation_status = "committed"
            created.append(attachment)
        for session in sessions.values():
            if all(item.validation_status in {"committed", "abandoned"} for item in session.items):
                session.status = "committed"
        db.flush()
        if image_lane_width is not None and ownership_scope is not None:
            from app.services.assets.image_display import initialize_import_display
            for attachment in created:
                warning = initialize_import_display(db, attachment, image_lane_width, ownership_scope, origin="upload_fit")
                if warning:
                    attachment.metadata_ = {**(attachment.metadata_ or {}), "image_fit_warning": warning}
            db.flush()
        return FinalizeResult(attachments=created, promoted_storage_keys=promoted)
    except Exception:
        # Transaction ownership handles only definitely uncommitted new
        # objects. Original upload bytes remain available for the same item.
        raise


def cleanup_finished_uploads(session_factory, *, limit=20, should_continue=lambda: True):
    """Only confirmed/explicitly abandoned inputs; never expire failed sources."""
    from app.services.worker_maintenance import bound_worker_transaction
    with session_factory() as db:
        bound_worker_transaction(db)
        ids = [row[0] for row in db.query(AttachmentUploadItem.id).filter(
            AttachmentUploadItem.validation_status.in_(("committed", "abandoned")),
            AttachmentUploadItem.temporary_storage_key.is_not(None),
        ).order_by(AttachmentUploadItem.created_at, AttachmentUploadItem.id).limit(min(limit, 20))]
    for item_id in ids:
        if not should_continue():
            break
        with session_factory() as db:
            bound_worker_transaction(db)
            item = db.query(AttachmentUploadItem).filter_by(id=item_id).with_for_update(skip_locked=True).one_or_none()
            if item is None or item.validation_status not in {"committed", "abandoned"} or not item.temporary_storage_key:
                continue
            store = get_asset_store()
            if item.validation_status == "committed":
                asset = db.query(AssetObject).join(Attachment, Attachment.asset_object_id == AssetObject.id).filter(
                    Attachment.source_attachment_id == str(item.id),
                    AssetObject.sha256 == item.sha256, AssetObject.byte_size == item.byte_size,
                    AssetObject.status == "available",
                ).first()
                if asset is None:
                    continue
                try:
                    store.resolve_key(asset.storage_key)
                except (OSError, ValueError):
                    continue
            try:
                store.delete_key(item.temporary_storage_key)
            except Exception:
                item.error_code = "cleanup_pending"
            else:
                item.temporary_storage_key = None
                item.error_code = None
            db.commit()


def remove_unreferenced_attachment(db: Session, attachment: Attachment) -> str | None:
    _bound_upload_write(db)
    db.query(Attachment).filter_by(id=attachment.id).with_for_update(key_share=True).populate_existing().one()
    from app.models.attachment_public_link import AttachmentPublicLink
    current_reference = (
        db.query(Message.id, MessageVersionAttachment.occurrence_key, MessageVersionAttachment.message_version_id)
        .select_from(MessageVersionAttachment)
        .join(MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id)
        .join(Message, Message.id == MessageVersion.message_id)
        .filter(
            MessageVersionAttachment.attachment_id == attachment.id,
            Message.current_version_id == MessageVersionAttachment.message_version_id,
            Message.is_deleted.is_(False),
        )
        .limit(10).all()
    )
    if current_reference:
        raise AttachmentUploadError("Attachment is still used by a current message version.", 409,
            code="attachment_in_use", details={"recovery_action": "locate_references",
                "references": [{"message_id": str(message_id), "occurrence_key": key, "message_version_id": str(version_id)}
                               for message_id, key, version_id in current_reference]})
    attachment.status = "detached"
    db.query(AttachmentPublicLink).filter_by(attachment_id=attachment.id).delete(synchronize_session=False)
    db.flush()
    return None
