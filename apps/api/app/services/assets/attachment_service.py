import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.share import Share
from app.schemas.attachment import AssetObjectRead, AttachmentRead
from app.services.assets.asset_store import get_asset_store
from app.services.assets.scanner import scan_status_allows_use


class AttachmentAccessError(ValueError):
    def __init__(self, message: str, status_code: int = 404) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class AttachmentContent:
    attachment: Attachment
    asset_object: AssetObject
    path: Path


def get_owner_attachment(db: Session, attachment_id: uuid.UUID) -> Attachment:
    attachment = (
        db.query(Attachment)
        .join(Conversation, Conversation.id == Attachment.conversation_id)
        .filter(
            Attachment.id == attachment_id,
            Attachment.deleted_at.is_(None),
            Conversation.deleted_at.is_(None),
        )
        .first()
    )
    if attachment is None:
        raise AttachmentAccessError("Attachment not found.")
    return attachment


def get_share_attachment(db: Session, share: Share, attachment_id: uuid.UUID) -> Attachment:
    query = (
        db.query(Attachment)
        .join(MessageVersionAttachment, MessageVersionAttachment.attachment_id == Attachment.id)
        .join(Message, Message.current_version_id == MessageVersionAttachment.message_version_id)
        .filter(
            Attachment.id == attachment_id,
            Attachment.deleted_at.is_(None),
            Message.conversation_id == share.conversation_id,
            Message.is_deleted.is_(False),
        )
    )
    if share.scope == "selected_messages":
        query = query.filter(Message.id.in_([uuid.UUID(str(item)) for item in share.selected_message_ids]))
    attachment = query.first()
    if attachment is None:
        raise AttachmentAccessError("Attachment not found.")
    return attachment


def attachment_content(attachment: Attachment) -> AttachmentContent:
    asset = attachment.asset_object
    if attachment.resolution_status != "resolved" or asset is None:
        raise AttachmentAccessError("Attachment content is unresolved.", 409)
    if asset.status != "available" or not scan_status_allows_use(asset.scan_status) or asset.deleted_at is not None:
        raise AttachmentAccessError("Attachment content is not available.", 423)
    try:
        path = get_asset_store().resolve_key(asset.storage_key)
    except (ValueError, FileNotFoundError) as exc:
        raise AttachmentAccessError("Attachment content is missing.") from exc
    return AttachmentContent(attachment=attachment, asset_object=asset, path=path)


def attachment_read(attachment: Attachment, *, content_prefix: str = "/api/attachments") -> AttachmentRead:
    asset = attachment.asset_object
    content_available = bool(
        attachment.resolution_status == "resolved"
        and asset is not None
        and asset.status == "available"
        and scan_status_allows_use(asset.scan_status)
        and asset.deleted_at is None
    )
    asset_read = AssetObjectRead(
        id=asset.id,
        sha256=asset.sha256,
        byte_size=asset.byte_size,
        detected_mime_type=asset.detected_mime_type,
        detected_extension=asset.detected_extension,
        scan_status=asset.scan_status,
        status=asset.status,
    ) if asset is not None else None
    base = f"{content_prefix}/{attachment.id}/content"
    return AttachmentRead(
        id=attachment.id,
        conversation_id=attachment.conversation_id,
        asset_object=asset_read,
        original_filename=attachment.original_filename,
        display_name=attachment.display_name,
        declared_mime_type=attachment.declared_mime_type,
        detected_mime_type=attachment.detected_mime_type or (asset.detected_mime_type if asset else None),
        status=attachment.status,
        scan_status=attachment.scan_status,
        source_type=attachment.source_type,
        source_attachment_id=attachment.source_attachment_id,
        metadata=attachment.metadata_ or {},
        resolution_status=attachment.resolution_status,
        created_at=attachment.created_at,
        content_url=f"{base}?disposition=inline" if content_available else None,
        download_url=f"{base}?disposition=attachment" if content_available else None,
    )
