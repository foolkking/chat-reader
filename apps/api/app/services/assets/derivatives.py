from __future__ import annotations

import io
import time
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
IMAGE_TYPES = {"image/bmp", "image/gif", "image/jpeg", "image/png", "image/tiff", "image/webp"}
GENERATOR_VERSION = "attachment-derivative-v2"
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_DECODED_PIXELS = 32_000_000
MAX_DECODED_MEMORY = 128 * 1024 * 1024
CPU_DEADLINE_SECONDS = 10.0


def build_asset_derivative(db: Session, *, attachment_id: uuid.UUID, derivative_type: str) -> AssetDerivative:
    if derivative_type not in {"text_extract", "image_thumbnail", "image_preview"}:
        raise AssetDerivativeError("Unsupported attachment derivative type.")
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
    source_path = get_asset_store().resolve_key(source.storage_key)
    if derivative_type == "text_extract":
        payload, output_mime, output_extension, metadata = _text_payload(source, source_path)
    else:
        payload, output_mime, output_extension, metadata = _image_payload(source, source_path, derivative_type)
    store = get_asset_store()
    staged = store.stage(
        io.BytesIO(payload),
        max_bytes=32 * 1024 * 1024 if derivative_type.startswith("image_") else 4 * 1024 * 1024,
        quarantine=False,
    )
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
            detected_mime_type=output_mime,
            detected_extension=output_extension,
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
        metadata_={"byte_size": len(payload), **metadata},
    )
    db.add(derivative)
    db.flush()
    _reindex_attachment_conversations(db, attachment_id)
    return derivative


def _text_payload(source: AssetObject, source_path) -> tuple[bytes, str, str, dict]:
    if source.detected_mime_type not in TEXT_TYPES and not source.detected_mime_type.startswith("text/"):
        raise AssetDerivativeError("Text extraction is not supported for this MIME type.")
    with source_path.open("rb") as source_file:
        content = source_file.read(2 * 1024 * 1024)
    truncated = source.byte_size > len(content)
    if truncated:
        content += b"\n[truncated by preview limit]\n"
    text = content.decode("utf-8", errors="replace")
    return text.encode("utf-8"), "text/plain", ".txt", {"truncated": truncated}


def _image_payload(source: AssetObject, source_path, derivative_type: str) -> tuple[bytes, str, str, dict]:
    if source.byte_size > MAX_SOURCE_BYTES:
        raise AssetDerivativeError("Image source exceeds the 64 MiB derivative limit.")
    if source.detected_mime_type not in IMAGE_TYPES:
        raise AssetDerivativeError("Image derivatives are not supported for this MIME type.")
    started = time.monotonic()
    try:
        from PIL import Image, ImageOps

        with Image.open(source_path) as image:
            width, height = image.size
            pixels = width * height
            if pixels > MAX_DECODED_PIXELS or pixels * 4 > MAX_DECODED_MEMORY:
                raise AssetDerivativeError("Decoded image exceeds the derivative resource limit.")
            image.seek(0)
            rendered = ImageOps.exif_transpose(image).convert("RGBA")
            longest = 320 if derivative_type == "image_thumbnail" else 1600
            rendered.thumbnail((longest, longest), Image.Resampling.LANCZOS)
            if time.monotonic() - started > CPU_DEADLINE_SECONDS:
                raise AssetDerivativeError("Image derivative generation exceeded its deadline.")
            output = io.BytesIO()
            rendered.save(output, format="PNG", optimize=True)
            payload = output.getvalue()
            frame_count = int(getattr(image, "n_frames", 1))
            return payload, "image/png", ".png", {
                "source_width": width,
                "source_height": height,
                "preview_width": rendered.width,
                "preview_height": rendered.height,
                "source_frame_count": frame_count,
                "rendered_frames": 1,
                "first_frame_only": frame_count > 1 or source.detected_mime_type == "image/tiff",
            }
    except AssetDerivativeError:
        raise
    except Exception as exc:
        raise AssetDerivativeError("Image derivative generation failed.") from exc


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
