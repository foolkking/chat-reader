"""Resolve reader navigation targets against canonical persisted identities.

This service deliberately returns a small, content-free DTO.  Rendered DOM
lookup remains a presentation concern; the server decides which message,
version and block are authoritative before the browser mounts anything.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.schemas.message import LocatorTargetRequest, ResolvedLocatorResponse


@dataclass(frozen=True)
class _QuoteMatch:
    start: int
    end: int
    score: int


def resolve_reader_locator(
    db: Session,
    conversation_id: uuid.UUID,
    target: LocatorTargetRequest,
) -> ResolvedLocatorResponse:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        return _not_found(conversation_id, "conversation-not-found")

    message = (
        db.query(Message)
        .filter(
            Message.id == target.message_id,
            Message.conversation_id == conversation_id,
            Message.is_deleted.is_(False),
        )
        .one_or_none()
    )
    if message is None:
        return _not_found(conversation_id, "message-not-found")

    current_version = db.get(MessageVersion, message.current_version_id) if message.current_version_id else None
    requested_version = db.get(MessageVersion, target.message_version_id) if target.message_version_id else None
    if requested_version is not None and requested_version.message_id != message.id:
        requested_version = None
    # Reader surfaces render the message's current canonical version. Historical
    # anchors are still useful for context, but must be remapped instead of
    # resolving against a version that is no longer mounted in the Reader.
    version = current_version if current_version is not None else requested_version
    if version is None:
        return ResolvedLocatorResponse(
            conversation_id=conversation_id,
            status="MESSAGE_ONLY",
            message_id=message.id,
            reason="version-not-found",
            fallback_kind="message",
        )

    version_was_remapped = bool(target.message_version_id and target.message_version_id != version.id)
    block = _resolve_block(db, version.id, target)
    if target.occurrence_key:
        if target.attachment_id is not None:
            attachment = db.get(Attachment, target.attachment_id)
            if attachment is None or attachment.conversation_id != conversation_id:
                return ResolvedLocatorResponse(
                    conversation_id=conversation_id,
                    status="NOT_FOUND",
                    message_id=message.id,
                    message_version_id=version.id,
                    reason="attachment-not-found",
                    fallback_kind="message",
                )
        occurrence = (
            db.query(MessageVersionAttachment)
            .filter(
                MessageVersionAttachment.message_version_id == version.id,
                MessageVersionAttachment.occurrence_key == target.occurrence_key,
                *(
                    [MessageVersionAttachment.attachment_id == target.attachment_id]
                    if target.attachment_id is not None
                    else []
                ),
            )
            .one_or_none()
        )
        if occurrence is None:
            return ResolvedLocatorResponse(
                conversation_id=conversation_id,
                status="STALE" if version_was_remapped else "NOT_FOUND",
                message_id=message.id,
                message_version_id=version.id,
                reason="attachment-not-found",
                fallback_kind="message",
            )
        if block is None and occurrence.block_index is not None:
            block = _block_by_index(db, version.id, occurrence.block_index)

    if block is None:
        return ResolvedLocatorResponse(
            conversation_id=conversation_id,
            status="REMAPPED_VERSION" if version_was_remapped else "MESSAGE_ONLY",
            message_id=message.id,
            message_version_id=version.id,
            reason="block-not-found" if target.render_block_id or target.block_index is not None else None,
            fallback_kind="message",
        )

    offsets = _resolve_offsets(block.plain_text or "", target)
    if offsets == "ambiguous":
        return ResolvedLocatorResponse(
            conversation_id=conversation_id,
            status="AMBIGUOUS",
            message_id=message.id,
            message_version_id=version.id,
            render_block_id=block.id,
            block_index=block.block_index,
            reason="multiple-quote-matches",
            fallback_kind="choose-candidate",
        )

    status = "REMAPPED_VERSION" if version_was_remapped else "EXACT"
    return ResolvedLocatorResponse(
        conversation_id=conversation_id,
        status=status,
        message_id=message.id,
        message_version_id=version.id,
        render_block_id=block.id,
        block_index=block.block_index,
        start_offset=offsets[0] if offsets else None,
        end_offset=offsets[1] if offsets else None,
        reason="version-remapped" if version_was_remapped else None,
        fallback_kind="version" if version_was_remapped else None,
    )


def _resolve_block(db: Session, version_id: uuid.UUID, target: LocatorTargetRequest) -> RenderBlock | None:
    if target.render_block_id is not None:
        block = (
            db.query(RenderBlock)
            .filter(RenderBlock.id == target.render_block_id, RenderBlock.message_version_id == version_id)
            .one_or_none()
        )
        if block is not None:
            return block
    if target.block_index is not None:
        return _block_by_index(db, version_id, target.block_index)
    return None


def _block_by_index(db: Session, version_id: uuid.UUID, block_index: int) -> RenderBlock | None:
    return (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == version_id, RenderBlock.block_index == block_index)
        .one_or_none()
    )


def _resolve_offsets(text: str, target: LocatorTargetRequest) -> tuple[int, int] | str | None:
    quote = (target.quote or "").strip()
    if quote:
        matches: list[_QuoteMatch] = []
        cursor = 0
        while cursor <= len(text) - len(quote):
            start = text.find(quote, cursor)
            if start < 0:
                break
            end = start + len(quote)
            score = _context_score(text[:start], target.prefix, prefix=True) + _context_score(text[end:], target.suffix, prefix=False)
            matches.append(_QuoteMatch(start, end, score))
            cursor = start + max(1, len(quote))
        if not matches:
            return None
        best_score = max(match.score for match in matches)
        best = [match for match in matches if match.score == best_score]
        if len(best) > 1:
            return "ambiguous"
        return best[0].start, best[0].end

    if target.canonical_start is None:
        return None
    start = max(0, min(target.canonical_start, len(text)))
    end = target.canonical_end if target.canonical_end is not None else start + 1
    end = max(start, min(end, len(text)))
    return start, end


def _context_score(value: str, expected: str | None, *, prefix: bool) -> int:
    sample = (expected or "").strip()
    if not sample:
        return 0
    sample = sample[-80:] if prefix else sample[:80]
    return len(sample) if (value.endswith(sample) if prefix else value.startswith(sample)) else 0


def _not_found(conversation_id: uuid.UUID, reason: str) -> ResolvedLocatorResponse:
    return ResolvedLocatorResponse(
        conversation_id=conversation_id,
        status="NOT_FOUND",
        reason=reason,
        fallback_kind="none",
    )
