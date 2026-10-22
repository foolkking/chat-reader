"""Opt-in image capabilities for a single-message Markdown copy."""
from __future__ import annotations

import hashlib
import io
import secrets
import uuid

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.models.attachment import AssetDerivative, AssetObject, Attachment, MessageVersionAttachment
from app.models.attachment_public_link import AttachmentPublicLink
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.assets.asset_store import get_asset_store
from app.services.assets.attachment_service import AttachmentAccessError, attachment_content, get_owner_attachment
from app.services.assets.scanner import scan_status_allows_use
from app.services.editing.attachment_reference_rewriter import attachment_reference_ids
from app.services.ownership import OwnershipScope

RASTER_TYPES = frozenset({
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon",
})
SVG_TYPE = "image/svg+xml"
PREVIEW_TYPE = "markdown_copy_png"
PREVIEW_VERSION = "browser-png-v1"
MAX_PREVIEW_BYTES = 4 * 1024 * 1024
MAX_SVG_BYTES = 2 * 1024 * 1024
MAX_COPY_BYTES = 4 * 1024 * 1024
MAX_COPY_IMAGES = 100


def message_copy_source(db: Session, message_id: uuid.UUID, scope: OwnershipScope, base_version_id=None):
    message = (
        db.query(Message).join(Conversation, Conversation.id == Message.conversation_id)
        .filter(Message.id == message_id, Message.is_deleted.is_(False),
                Conversation.deleted_at.is_(None), scope.predicate(Conversation))
        .with_for_update(of=Message).first()
    )
    if message is None or message.current_version_id is None:
        raise AttachmentAccessError("Message not found.")
    if base_version_id is not None and message.current_version_id != base_version_id:
        raise AttachmentAccessError("The message version changed. Refresh before copying.", 409)
    version = db.get(MessageVersion, message.current_version_id)
    if version is None:
        raise AttachmentAccessError("Message version not found.")
    if len(version.display_text.encode("utf-8")) > MAX_COPY_BYTES:
        raise AttachmentAccessError("Message exceeds the 4 MiB copy limit. Use export instead.", 413)
    ids = attachment_reference_ids(version.display_text)
    ids.update(row[0] for row in db.query(MessageVersionAttachment.attachment_id).filter(
        MessageVersionAttachment.message_version_id == version.id,
    ))
    if len(ids) > 1000:
        raise AttachmentAccessError("Message exceeds the attachment copy limit. Use export instead.", 413)
    attachments = db.query(Attachment).filter(
        Attachment.id.in_(ids), Attachment.conversation_id == message.conversation_id,
    ).all() if ids else []
    return version, {str(row.id): row for row in attachments}


def copy_plan(db: Session, message_id: uuid.UUID, scope: OwnershipScope):
    version, attachments = message_copy_source(db, message_id, scope)
    return {
        "version_id": str(version.id), "markdown": version.display_text,
        "attachments": [{
            "id": str(row.id),
            "mime_type": row.asset_object.detected_mime_type if row.asset_object else row.detected_mime_type,
            "source_sha256": row.asset_object.sha256 if row.asset_object else None,
            "content_url": f"/api/attachments/{row.id}/content",
            "available": row.deleted_at is None and row.status == "available" and row.resolution_status == "resolved",
        } for row in attachments.values()],
    }


def _usable(attachment: Attachment):
    if attachment.deleted_at is not None or attachment.status != "available":
        raise AttachmentAccessError("Image is no longer available.")
    return attachment_content(attachment)


def _preview_version(attachment_id: uuid.UUID) -> str:
    # Browser-generated pixels are owner-controlled, unlike a server renderer.
    # Never reuse that mapping across deduplicated attachments/accounts.
    return f"{PREVIEW_VERSION}:{attachment_id}"


def _preview(db: Session, source_id: uuid.UUID, attachment_id: uuid.UUID) -> AssetObject | None:
    return db.query(AssetObject).join(
        AssetDerivative, AssetDerivative.derivative_asset_object_id == AssetObject.id,
    ).filter(
        AssetDerivative.source_asset_object_id == source_id,
        AssetDerivative.derivative_type == PREVIEW_TYPE,
        AssetDerivative.generator_version == _preview_version(attachment_id),
        AssetDerivative.status == "ready",
        AssetObject.detected_mime_type == "image/png",
        AssetObject.status == "available", AssetObject.deleted_at.is_(None),
    ).first()


def publish_images(db: Session, message_id: uuid.UUID, scope: OwnershipScope, base_version_id, attachment_ids):
    _, attachments = message_copy_source(db, message_id, scope, base_version_id)
    if len(attachment_ids) > MAX_COPY_IMAGES:
        raise AttachmentAccessError("Too many images for one copy.", 413)
    if attachments:
        db.query(Attachment).filter(Attachment.id.in_([row.id for row in attachments.values()])).order_by(
            Attachment.id,
        ).with_for_update().populate_existing().all()
    eligible = []
    for attachment_id in dict.fromkeys(attachment_ids):
        row = attachments.get(str(attachment_id))
        if row is None:
            raise AttachmentAccessError("Image is not part of this message.")
        content = _usable(row)
        mime = content.asset_object.detected_mime_type
        if mime not in RASTER_TYPES and mime != SVG_TYPE:
            raise AttachmentAccessError("Only image attachments can be published.", 422)
        if mime == SVG_TYPE:
            preview = _preview(db, content.asset_object.id, row.id)
            if preview is None or not scan_status_allows_use(preview.scan_status):
                raise AttachmentAccessError("A safe PNG preview is required.", 409)
            get_asset_store().resolve_key(preview.storage_key)
        from app.services.assets.image_display import display_asset
        display_asset(db, row)
        eligible.append((row, content.asset_object))
    # Validate the entire selection before creating any capability.
    urls = {}
    for row, asset in eligible:
        link = db.query(AttachmentPublicLink).filter_by(
            attachment_id=row.id, source_asset_object_id=asset.id,
        ).first()
        if link is None:
            # A native upsert preserves earlier links on concurrent copies and
            # stays inside the outer transaction (including SQLite test runs).
            if db.get_bind().dialect.name == "sqlite":
                from sqlalchemy.dialects.sqlite import insert
            else:
                from sqlalchemy.dialects.postgresql import insert
            db.execute(insert(AttachmentPublicLink).values(
                id=uuid.uuid4(), attachment_id=row.id, source_asset_object_id=asset.id, token=secrets.token_urlsafe(32),
            ).on_conflict_do_nothing(index_elements=["attachment_id", "source_asset_object_id"]))
            link = db.query(AttachmentPublicLink).filter_by(
                attachment_id=row.id, source_asset_object_id=asset.id,
            ).one()
        urls[str(row.id)] = f"/api/public-images/{link.token}"
    return {"urls": urls}


def save_svg_preview(db: Session, attachment_id: uuid.UUID, scope: OwnershipScope, source_sha256: str, payload: bytes):
    attachment = get_owner_attachment(db, attachment_id, scope)
    db.query(Attachment).filter_by(id=attachment.id).with_for_update().populate_existing().one()
    content = _usable(attachment)
    source = content.asset_object
    db.query(AssetObject).filter_by(id=source.id).with_for_update().populate_existing().one()
    if source.sha256 != source_sha256:
        raise AttachmentAccessError("Image source changed. Copy again.", 409)
    if source.detected_mime_type != SVG_TYPE or source.byte_size > MAX_SVG_BYTES:
        raise AttachmentAccessError("SVG exceeds the safe preview limit or has the wrong type.", 422)
    existing = _preview(db, source.id, attachment.id)
    if existing is not None and scan_status_allows_use(existing.scan_status):
        try:
            get_asset_store().resolve_key(existing.storage_key)
            return
        except FileNotFoundError:
            pass
    if len(payload) > MAX_PREVIEW_BYTES:
        raise AttachmentAccessError("PNG preview exceeds the 4 MiB limit.", 413)
    try:
        with Image.open(io.BytesIO(payload)) as image:
            if image.format != "PNG" or not (0 < image.width <= 1600 and 0 < image.height <= 1600):
                raise AttachmentAccessError("A bounded PNG preview is required.", 422)
            if image.width * image.height > 2_560_000 or getattr(image, "n_frames", 1) != 1:
                raise AttachmentAccessError("A single-frame PNG preview is required.", 422)
            image.load()
            output = io.BytesIO()
            # Copy pixels only: no source metadata, SVG XML, EXIF or active payload.
            Image.frombytes("RGBA", image.size, image.convert("RGBA").tobytes()).save(output, format="PNG")
            clean = output.getvalue()
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise AttachmentAccessError("PNG preview is invalid.", 422) from exc
    if len(clean) > MAX_PREVIEW_BYTES:
        raise AttachmentAccessError("PNG preview exceeds the 4 MiB limit.", 413)
    digest = hashlib.sha256(clean).hexdigest()
    asset = db.query(AssetObject).filter_by(sha256=digest, byte_size=len(clean)).first()
    store = get_asset_store()
    needs_storage = asset is None
    if asset is not None:
        if asset.status != "available" or asset.deleted_at or not scan_status_allows_use(asset.scan_status):
            raise AttachmentAccessError("Preview object is unavailable.", 423)
        try:
            store.resolve_key(asset.storage_key)
        except FileNotFoundError:
            needs_storage = True
    if needs_storage:
        staged = store.stage(io.BytesIO(clean), max_bytes=MAX_PREVIEW_BYTES, quarantine=False)
        key = store.object_key()
        store.promote(staged.path, key)
        if asset is None:
            asset = AssetObject(
                sha256=staged.sha256, byte_size=staged.byte_size, detected_mime_type="image/png",
                detected_extension=".png", storage_backend=store.backend, storage_key=key,
                status="available", scan_status=source.scan_status,
            )
            db.add(asset)
        else:
            asset.storage_backend, asset.storage_key = store.backend, key
        try:
            db.flush()
        except BaseException:
            # Only the object promoted by this operation; never another asset.
            store.delete_key(key)
            raise
    derivative = db.query(AssetDerivative).filter_by(
        source_asset_object_id=source.id, derivative_type=PREVIEW_TYPE, generator_version=_preview_version(attachment.id),
    ).first()
    if derivative is None:
        derivative = AssetDerivative(
            source_asset_object_id=source.id, derivative_asset_object_id=asset.id,
            derivative_type=PREVIEW_TYPE, generator="browser-canvas-validated-pillow",
            generator_version=_preview_version(attachment.id), status="ready", metadata_={"public_copy_preview": True},
        )
        db.add(derivative)
    else:
        derivative.derivative_asset_object_id, derivative.status = asset.id, "ready"
    db.flush()


def public_image_content(db: Session, token: str):
    link = db.query(AttachmentPublicLink).filter_by(token=token).first()
    row = db.get(Attachment, link.attachment_id) if link else None
    if row is None or row.asset_object_id != link.source_asset_object_id:
        raise AttachmentAccessError("Image not found.")
    conversation = db.get(Conversation, row.conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise AttachmentAccessError("Image not found.")
    content = _usable(row)
    asset = content.asset_object
    from app.services.assets.image_display import display_asset
    selected = display_asset(db, row)
    if selected is not None:
        asset = selected
    elif asset.detected_mime_type == SVG_TYPE:
        asset = _preview(db, asset.id, row.id)
        if asset is None or not scan_status_allows_use(asset.scan_status):
            raise AttachmentAccessError("Image not found.")
    elif asset.detected_mime_type not in RASTER_TYPES:
        raise AttachmentAccessError("Image not found.")
    return get_asset_store().resolve_key(asset.storage_key), asset.detected_mime_type
