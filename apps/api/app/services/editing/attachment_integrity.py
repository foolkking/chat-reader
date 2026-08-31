"""Read-only attachment reference integrity auditing.

The audit deliberately returns identities and issue codes only.  It never
rewrites message content or guesses an attachment from filenames/order.
"""

from dataclasses import dataclass
import uuid

from sqlalchemy.orm import Session

from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.editing.attachment_reference_rewriter import attachment_data_ids, attachment_reference_ids


@dataclass(frozen=True)
class AttachmentIntegrityIssue:
    code: str
    conversation_id: uuid.UUID
    message_id: uuid.UUID | None = None
    message_version_id: uuid.UUID | None = None
    attachment_id: uuid.UUID | None = None
    occurrence_id: uuid.UUID | None = None
    block_index: int | None = None


def audit_conversation_attachment_integrity(
    db: Session,
    conversation_id: uuid.UUID,
) -> list[AttachmentIntegrityIssue]:
    """Audit current and historical versions without returning message bodies.

    A conversation may legitimately contain unreferenced files, so
    ``ATTACHMENT_WITHOUT_CURRENT_OCCURRENCE`` is reported only for an
    attachment that has previously been declared on a message version but no
    longer has a link on the current version.
    """
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        return []

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.deleted_at.is_(None))
        .order_by(Message.order_key, Message.id)
        .all()
    )
    message_ids = [message.id for message in messages]
    versions = (
        db.query(MessageVersion)
        .filter(MessageVersion.message_id.in_(message_ids))
        .order_by(MessageVersion.message_id, MessageVersion.version_number)
        .all()
        if message_ids
        else []
    )
    versions_by_message: dict[uuid.UUID, list[MessageVersion]] = {}
    for version in versions:
        versions_by_message.setdefault(version.message_id, []).append(version)
    version_ids = [version.id for version in versions]
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id.in_(version_ids))
        .all()
        if version_ids
        else []
    )
    blocks_by_version: dict[uuid.UUID, list[RenderBlock]] = {}
    for block in blocks:
        blocks_by_version.setdefault(block.message_version_id, []).append(block)

    links = (
        db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id.in_(version_ids))
        .all()
        if version_ids
        else []
    )
    links_by_version: dict[uuid.UUID, list[MessageVersionAttachment]] = {}
    for link in links:
        links_by_version.setdefault(link.message_version_id, []).append(link)

    conversation_attachments = {
        row[0]
        for row in db.query(Attachment.id).filter(
            Attachment.conversation_id == conversation_id,
            Attachment.deleted_at.is_(None),
        ).all()
    }
    issues: list[AttachmentIntegrityIssue] = []
    for message in messages:
        for version in versions_by_message.get(message.id, []):
            version_blocks = blocks_by_version.get(version.id, [])
            version_links = links_by_version.get(version.id, [])
            block_ids = set()
            for block in version_blocks:
                block_ids.update(attachment_data_ids(block.data))
                block_ids.update(attachment_reference_ids(block.plain_text or ""))
                block_ids.update(attachment_reference_ids(block.sanitized_html or ""))
            text_ids = attachment_reference_ids(version.display_text)
            all_text_ids = text_ids | block_ids
            linked_ids = {link.attachment_id for link in version_links}
            for attachment_id in sorted(all_text_ids - conversation_attachments, key=str):
                issues.append(AttachmentIntegrityIssue(
                    "TEXT_REFERENCE_WITHOUT_ATTACHMENT",
                    conversation_id,
                    message.id,
                    version.id,
                    attachment_id=attachment_id,
                ))
            if message.current_version_id == version.id:
                for attachment_id in sorted(all_text_ids - linked_ids, key=str):
                    issues.append(AttachmentIntegrityIssue(
                        "ATTACHMENT_WITHOUT_CURRENT_OCCURRENCE",
                        conversation_id,
                        message.id,
                        version.id,
                        attachment_id=attachment_id,
                    ))
            block_indexes = {block.block_index for block in version_blocks}
            for link in version_links:
                if link.block_index is not None and link.block_index not in block_indexes:
                    issues.append(AttachmentIntegrityIssue(
                        "OCCURRENCE_WITHOUT_BLOCK",
                        conversation_id,
                        message.id,
                        version.id,
                        attachment_id=link.attachment_id,
                        occurrence_id=link.id,
                        block_index=link.block_index,
                    ))
                if message.current_version_id != version.id:
                    # Historical declarations remain valid history, but they
                    # must not be used as live locator occurrences.
                    issues.append(AttachmentIntegrityIssue(
                        "OCCURRENCE_ON_STALE_VERSION",
                        conversation_id,
                        message.id,
                        version.id,
                        attachment_id=link.attachment_id,
                        occurrence_id=link.id,
                        block_index=link.block_index,
                    ))
    return issues
