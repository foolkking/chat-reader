from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import uuid

from sqlalchemy.orm import Session

from app.models.attachment import Attachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.canonical.block_builder import build_basic_render_blocks
from app.services.editing.attachment_reference_rewriter import ASSET_REFERENCE_RE, rewrite_attachment_text
from app.services.editing.message_edit_service import create_system_message_version, refresh_conversation_stats
from app.services.search.search_indexer import rebuild_search_and_toc_for_conversation


class AttachmentReferenceRepairError(RuntimeError):
    pass


@dataclass(frozen=True)
class AttachmentReferenceRepairPlan:
    conversation_id: uuid.UUID
    confirmation_token: str
    scanned_message_count: int
    repairable_message_count: int
    repairable_reference_count: int
    unresolved_reference_ids: tuple[uuid.UUID, ...]
    ambiguous_reference_ids: tuple[uuid.UUID, ...]

    @property
    def applicable(self) -> bool:
        return (
            self.repairable_reference_count > 0
            and not self.unresolved_reference_ids
            and not self.ambiguous_reference_ids
        )


def plan_unique_attachment_reference_repair(
    db: Session,
    conversation_id: uuid.UUID,
) -> AttachmentReferenceRepairPlan:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise AttachmentReferenceRepairError("Conversation not found.")

    messages = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation_id,
            Message.deleted_at.is_(None),
            Message.current_version_id.is_not(None),
        )
        .order_by(Message.order_key, Message.id)
        .all()
    )
    version_ids = [message.current_version_id for message in messages if message.current_version_id is not None]
    versions = {
        version.id: version
        for version in db.query(MessageVersion).filter(MessageVersion.id.in_(version_ids)).all()
    } if version_ids else {}
    attachments = (
        db.query(Attachment)
        .filter(Attachment.conversation_id == conversation_id, Attachment.deleted_at.is_(None))
        .order_by(Attachment.id)
        .all()
    )
    current_attachment_ids = {attachment.id for attachment in attachments}
    provenance: dict[uuid.UUID, list[uuid.UUID]] = {}
    for attachment in attachments:
        try:
            source_id = uuid.UUID(str(attachment.source_attachment_id))
        except (TypeError, ValueError):
            continue
        provenance.setdefault(source_id, []).append(attachment.id)

    repair_pairs: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID]] = []
    unresolved: set[uuid.UUID] = set()
    ambiguous: set[uuid.UUID] = set()
    repairable_messages: set[uuid.UUID] = set()
    for message in messages:
        version = versions.get(message.current_version_id)
        if version is None:
            continue
        stale_ids = _attachment_reference_ids_outside_code(version.display_text) - current_attachment_ids
        for stale_id in sorted(stale_ids, key=str):
            candidates = provenance.get(stale_id, [])
            if len(candidates) == 1:
                repair_pairs.append((version.id, stale_id, candidates[0]))
                repairable_messages.add(message.id)
            elif not candidates:
                unresolved.add(stale_id)
            else:
                ambiguous.add(stale_id)

    token_payload = {
        "conversation_id": str(conversation_id),
        "pairs": [[str(item) for item in pair] for pair in repair_pairs],
        "unresolved": sorted(str(item) for item in unresolved),
        "ambiguous": sorted(str(item) for item in ambiguous),
    }
    token = hashlib.sha256(
        json.dumps(token_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return AttachmentReferenceRepairPlan(
        conversation_id=conversation_id,
        confirmation_token=token,
        scanned_message_count=len(messages),
        repairable_message_count=len(repairable_messages),
        repairable_reference_count=len(repair_pairs),
        unresolved_reference_ids=tuple(sorted(unresolved, key=str)),
        ambiguous_reference_ids=tuple(sorted(ambiguous, key=str)),
    )


def apply_unique_attachment_reference_repair(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    confirmation_token: str,
) -> int:
    # Hold the exact current-message and provenance rows stable between token
    # revalidation and version creation. Normal editor writes update the same
    # Message rows, so a concurrent edit cannot be silently overwritten.
    (
        db.query(Message.id)
        .filter(Message.conversation_id == conversation_id, Message.deleted_at.is_(None))
        .with_for_update()
        .all()
    )
    (
        db.query(Attachment.id)
        .filter(Attachment.conversation_id == conversation_id, Attachment.deleted_at.is_(None))
        .with_for_update()
        .all()
    )
    plan = plan_unique_attachment_reference_repair(db, conversation_id)
    if confirmation_token != plan.confirmation_token:
        raise AttachmentReferenceRepairError("Repair confirmation token is stale or invalid.")
    if plan.unresolved_reference_ids or plan.ambiguous_reference_ids:
        raise AttachmentReferenceRepairError("Repair is not uniquely resolvable; no changes were applied.")
    if not plan.applicable:
        return 0

    attachments = (
        db.query(Attachment)
        .filter(Attachment.conversation_id == conversation_id, Attachment.deleted_at.is_(None))
        .all()
    )
    provenance: dict[uuid.UUID, list[uuid.UUID]] = {}
    for attachment in attachments:
        try:
            source_id = uuid.UUID(str(attachment.source_attachment_id))
        except (TypeError, ValueError):
            continue
        provenance.setdefault(source_id, []).append(attachment.id)
    attachment_id_map = {
        source_id: candidates[0]
        for source_id, candidates in provenance.items()
        if len(candidates) == 1
    }
    current_attachment_ids = {row.id for row in attachments}

    messages = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation_id,
            Message.deleted_at.is_(None),
            Message.current_version_id.is_not(None),
        )
        .order_by(Message.order_key, Message.id)
        .all()
    )
    repaired = 0
    for message in messages:
        current = db.get(MessageVersion, message.current_version_id)
        if current is None:
            continue
        stale_ids = _attachment_reference_ids_outside_code(current.display_text) - current_attachment_ids
        if not stale_ids:
            continue
        mapped_text = rewrite_attachment_text(current.display_text, {
            stale_id: attachment_id_map[stale_id]
            for stale_id in stale_ids
        })
        blocks = build_basic_render_blocks(mapped_text)
        plain_text = "\n\n".join(block.plain_text or "" for block in blocks).strip()
        create_system_message_version(
            db,
            message=message,
            text=mapped_text,
            plain_text=plain_text,
            edit_type="attachment_reference_repair",
            edit_reason="repair uniquely mapped merged attachment references",
        )
        repaired += 1

    if repaired:
        refresh_conversation_stats(db, conversation_id, bump_revision=False)
        rebuild_search_and_toc_for_conversation(db, conversation_id)
    db.flush()
    return repaired


def _attachment_reference_ids_outside_code(source_text: str) -> set[uuid.UUID]:
    found: set[uuid.UUID] = set()
    in_code = False
    fence_character = ""
    fence_length = 0
    for raw_line in source_text.splitlines():
        line = raw_line.strip()
        if in_code:
            if line.startswith(fence_character * fence_length) and not line[fence_length:].strip(fence_character).strip():
                in_code = False
            continue
        if line.startswith("```") or line.startswith("~~~"):
            fence_character = line[0]
            fence_length = len(line) - len(line.lstrip(fence_character))
            in_code = True
            continue
        found.update(uuid.UUID(match.group("id")) for match in ASSET_REFERENCE_RE.finditer(raw_line))
    return found
