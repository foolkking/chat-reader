"""Batch loading and grouping for the complete-turn Reader contract."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.attachment import MessageVersionAttachment
from app.models.render_block import RenderBlock
from app.schemas.message import MessageListItem, MessageVersionRead, ReaderTurnResponse, RenderBlockRead


@dataclass(frozen=True)
class _Turn:
    key: str
    start: int
    end: int


class ReaderTurnHydrationError(RuntimeError):
    """Raised when canonical block rows cannot satisfy the complete-turn contract."""


def load_reader_turn(db: Session, conversation_id: uuid.UUID, anchor_message_id: uuid.UUID | None = None) -> ReaderTurnResponse:
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .all()
    )
    return build_reader_turn(db, conversation_id, messages, anchor_message_id)


def build_reader_turn(
    db: Session,
    conversation_id: uuid.UUID,
    messages: list[Message],
    anchor_message_id: uuid.UUID | None = None,
) -> ReaderTurnResponse:
    ordered = sorted(messages, key=lambda message: message.order_key)
    if not ordered:
        return ReaderTurnResponse(conversation_id=conversation_id, turn_key="empty", start_offset=0, end_offset=0, total_messages=0)
    turns = _group_turns(ordered)
    anchor_index = 0
    if anchor_message_id is not None:
        anchor_index = next((i for i, message in enumerate(ordered) if message.id == anchor_message_id), -1)
        if anchor_index < 0:
            raise ValueError("Anchor message not found.")
    selected_index = next(i for i, turn in enumerate(turns) if turn.start <= anchor_index < turn.end)
    selected = turns[selected_index]
    selected_messages = ordered[selected.start:selected.end]
    version_ids = [message.current_version_id for message in selected_messages if message.current_version_id]
    versions = db.query(MessageVersion).filter(MessageVersion.id.in_(version_ids)).all() if version_ids else []
    version_by_id = {version.id: version for version in versions}
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id.in_(version_ids))
        .order_by(RenderBlock.message_version_id.asc(), RenderBlock.block_index.asc())
        .all()
        if version_ids else []
    )
    blocks_by_version: dict[uuid.UUID, list[RenderBlockRead]] = {}
    attachment_links = (
        db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id.in_(version_ids))
        .order_by(
            MessageVersionAttachment.message_version_id.asc(),
            MessageVersionAttachment.block_index.asc().nullslast(),
            MessageVersionAttachment.display_order.asc(),
            MessageVersionAttachment.occurrence_key.asc(),
        )
        .all()
        if version_ids else []
    )
    occurrence_by_block = {
        (link.message_version_id, link.block_index): link
        for link in attachment_links
        if link.block_index is not None
    }
    for block in blocks:
        blocks_by_version.setdefault(block.message_version_id, []).append(
            _block_read(block, occurrence_by_block.get((block.message_version_id, block.block_index)))
        )
    items = []
    for index, message in enumerate(selected_messages):
        version = version_by_id.get(message.current_version_id) if message.current_version_id else None
        message_blocks = blocks_by_version.get(message.current_version_id, []) if message.current_version_id else []
        if len(message_blocks) != message.block_count:
            raise ReaderTurnHydrationError(
                f"Reader turn hydration is incomplete for message {message.id}: "
                f"expected {message.block_count} blocks, received {len(message_blocks)}."
            )
        items.append(_message_item(message, version, message_blocks, selected.start + index + 1))
    return ReaderTurnResponse(
        conversation_id=conversation_id,
        turn_key=selected.key,
        start_offset=selected.start,
        end_offset=selected.end,
        total_messages=len(ordered),
        items=items,
        previous_anchor_message_id=ordered[turns[selected_index - 1].start].id if selected_index > 0 else None,
        next_anchor_message_id=ordered[turns[selected_index + 1].start].id if selected_index + 1 < len(turns) else None,
    )


def _group_turns(messages: list[Message]) -> list[_Turn]:
    user_roles = {"user", "prompt", "human"}
    if any(message.role.lower() in user_roles for message in messages):
        ranges = []
        start = 0
        for index, message in enumerate(messages):
            if index > 0 and message.role.lower() in user_roles:
                ranges.append((start, index))
                start = index
        ranges.append((start, len(messages)))
    elif any(message.turn_index is not None for message in messages):
        ranges = []
        start = 0
        last_key = messages[0].turn_index
        for index, message in enumerate(messages[1:], start=1):
            key = message.turn_index if message.turn_index is not None else ("synthetic", index)
            if key != last_key:
                ranges.append((start, index))
                start = index
            last_key = key
        ranges.append((start, len(messages)))
    else:
        ranges = [(index, index + 1) for index in range(len(messages))]
    return [_Turn(f"turn-{index}", start, end) for index, (start, end) in enumerate(ranges)]


def _message_item(message: Message, version: MessageVersion | None, blocks: list[RenderBlockRead], ordinal: int) -> MessageListItem:
    current_version = MessageVersionRead(
        id=version.id,
        version_number=version.version_number,
        plain_text=version.plain_text,
        display_text=version.display_text,
        blocks=version.blocks,
        edit_type=version.edit_type,
        created_at=version.created_at,
        created_by=version.created_by,
        content_hash=version.content_hash,
    ) if version else None
    return MessageListItem(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        order_key=message.order_key,
        turn_index=message.turn_index,
        created_at=message.created_at,
        current_version=current_version,
        render_blocks=blocks,
        block_count=message.block_count,
        char_count=message.char_count,
        is_heavy=message.is_heavy,
        ordinal=ordinal,
        content_preview=None,
        content_truncated=False,
    )


def _block_read(block: RenderBlock, occurrence: MessageVersionAttachment | None = None) -> RenderBlockRead:
    data = dict(block.data or {})
    if occurrence is not None:
        data.update({
            "messageVersionId": str(occurrence.message_version_id),
            "occurrenceKey": occurrence.occurrence_key,
            "displayOrder": occurrence.display_order,
            "displayMode": occurrence.display_mode,
            "alt": occurrence.alt_text,
            "caption": occurrence.caption,
            "relationType": occurrence.relation_type,
        })
    return RenderBlockRead(
        id=block.id,
        block_index=block.block_index,
        block_type=block.block_type,
        plain_text=block.plain_text,
        data=data,
        char_count=block.char_count,
        collapsed_by_default=block.collapsed_by_default,
        render_priority=block.render_priority,
    )
