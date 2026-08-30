"""Batch loading and grouping for the complete-turn Reader contract."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import and_, func
from sqlalchemy.orm import Query, Session, joinedload

from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.schemas.message import MessageListItem, MessageVersionRead, ReaderTurnResponse, RenderBlockRead
from app.services.assets.attachment_service import attachment_read


@dataclass(frozen=True)
class _Turn:
    key: str
    start: int
    end: int


@dataclass(frozen=True)
class _SelectedTurn:
    messages: list[Message]
    start_offset: int
    end_offset: int
    total_messages: int
    previous_anchor_message_id: uuid.UUID | None
    next_anchor_message_id: uuid.UUID | None


class ReaderTurnHydrationError(RuntimeError):
    """Raised when canonical block rows cannot satisfy the complete-turn contract."""


def load_reader_turn(db: Session, conversation_id: uuid.UUID, anchor_message_id: uuid.UUID | None = None) -> ReaderTurnResponse:
    base = db.query(Message).filter(
        Message.conversation_id == conversation_id,
        Message.is_deleted.is_(False),
    )
    return load_reader_turn_from_query(db, conversation_id, base, anchor_message_id)


def load_reader_turn_from_query(
    db: Session,
    conversation_id: uuid.UUID,
    base: Query,
    anchor_message_id: uuid.UUID | None = None,
    *,
    attachment_content_prefix: str = "/api/attachments",
) -> ReaderTurnResponse:
    """Load one complete Reader turn from an already permission-scoped query.

    Share uses this entry point so the public scope predicate is applied to
    every boundary/count query. It avoids materializing the entire shared
    conversation while retaining the same fallback for legacy turn data.
    """
    # The old implementation loaded every message before grouping turns. A
    # citation into a long conversation therefore paid an O(N) database read
    # even when only one turn was needed. Resolve the turn boundaries with
    # indexed order-key queries and hydrate only that bounded range.
    selected = _load_selected_turn(db, base, anchor_message_id)
    if selected is None:
        # Mixed/null turn indexes are legacy data for which the bounded SQL
        # path cannot prove the same grouping semantics. Preserve the
        # canonical fallback rather than guessing a boundary.
        messages = base.order_by(Message.order_key.asc()).all()
        return build_reader_turn(
            db,
            conversation_id,
            messages,
            anchor_message_id,
            attachment_content_prefix=attachment_content_prefix,
        )
    return build_reader_turn(
        db,
        conversation_id,
        selected.messages,
        attachment_content_prefix=attachment_content_prefix,
        turn_metadata=selected,
    )


def _load_selected_turn(
    db: Session,
    base: Query,
    anchor_message_id: uuid.UUID | None,
) -> _SelectedTurn | None:
    total_messages = base.count()
    if total_messages == 0:
        return _SelectedTurn([], 0, 0, 0, None, None)

    anchor = (
        base.filter(Message.id == anchor_message_id).one_or_none()
        if anchor_message_id is not None
        else base.order_by(Message.order_key.asc()).first()
    )
    if anchor is None:
        raise ValueError("Anchor message not found.")

    # A user/prompt/human message starts a turn in the canonical Reader
    # contract. Use case-insensitive SQL predicates so imported role casing
    # does not force a fallback to full-message loading.
    user_roles = ("user", "prompt", "human")
    has_user_role = base.filter(func.lower(Message.role).in_(user_roles)).first() is not None
    if has_user_role:
        user_role_filter = func.lower(Message.role).in_(user_roles)
        start_anchor = (
            base.filter(user_role_filter, Message.order_key <= anchor.order_key)
            .order_by(Message.order_key.desc())
            .first()
        )
        first_message = base.order_by(Message.order_key.asc()).first()
        start_order = start_anchor.order_key if start_anchor is not None else first_message.order_key
        next_anchor = (
            base.filter(user_role_filter, Message.order_key > anchor.order_key)
            .order_by(Message.order_key.asc())
            .first()
        )
        previous_anchor = (
            base.filter(user_role_filter, Message.order_key < start_order)
            .order_by(Message.order_key.desc())
            .first()
        )
    elif base.filter(Message.turn_index.is_not(None)).first() is not None:
        # Explicit turn_index data can repeat non-contiguously. The canonical
        # Python grouper treats each contiguous run as a distinct turn, so a
        # SQL equality range could silently join unrelated runs. Keep this
        # legacy shape on the correctness-first fallback path.
        return None
    else:
        previous_anchor = base.filter(Message.order_key < anchor.order_key).order_by(Message.order_key.desc()).first()
        next_anchor = base.filter(Message.order_key > anchor.order_key).order_by(Message.order_key.asc()).first()
        start_order = anchor.order_key

    end_order = next_anchor.order_key if next_anchor is not None else None
    range_filter = Message.order_key >= start_order
    if end_order is not None:
        range_filter = and_(range_filter, Message.order_key < end_order)
    messages = base.filter(range_filter).order_by(Message.order_key.asc()).all()
    start_offset = base.filter(Message.order_key < start_order).count()
    return _SelectedTurn(
        messages,
        start_offset,
        start_offset + len(messages),
        total_messages,
        previous_anchor.id if previous_anchor else None,
        next_anchor.id if next_anchor else None,
    )


def build_reader_turn(
    db: Session,
    conversation_id: uuid.UUID,
    messages: list[Message],
    anchor_message_id: uuid.UUID | None = None,
    attachment_content_prefix: str = "/api/attachments",
    turn_metadata: _SelectedTurn | None = None,
) -> ReaderTurnResponse:
    ordered = sorted(messages, key=lambda message: message.order_key)
    if not ordered:
        return ReaderTurnResponse(conversation_id=conversation_id, turn_key="empty", start_offset=0, end_offset=0, total_messages=0)
    turns = _group_turns(ordered) if turn_metadata is None else [_Turn("turn-range", 0, len(ordered))]
    if turn_metadata is None:
        anchor_index = 0
        if anchor_message_id is not None:
            anchor_index = next((i for i, message in enumerate(ordered) if message.id == anchor_message_id), -1)
            if anchor_index < 0:
                raise ValueError("Anchor message not found.")
        selected_index = next(i for i, turn in enumerate(turns) if turn.start <= anchor_index < turn.end)
        selected = turns[selected_index]
        selected_messages = ordered[selected.start:selected.end]
        start_offset = selected.start
        end_offset = selected.end
        total_messages = len(ordered)
        previous_anchor_message_id = ordered[turns[selected_index - 1].start].id if selected_index > 0 else None
        next_anchor_message_id = ordered[turns[selected_index + 1].start].id if selected_index + 1 < len(turns) else None
    else:
        selected_messages = ordered
        selected_key = f"turn-{turn_metadata.start_offset}"
        start_offset = turn_metadata.start_offset
        end_offset = turn_metadata.end_offset
        total_messages = turn_metadata.total_messages
        previous_anchor_message_id = turn_metadata.previous_anchor_message_id
        next_anchor_message_id = turn_metadata.next_anchor_message_id
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
        .options(
            joinedload(MessageVersionAttachment.attachment).joinedload(Attachment.asset_object),
        )
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
    occurrence_by_block: dict[tuple[uuid.UUID, int], list[MessageVersionAttachment]] = {}
    for link in attachment_links:
        if link.block_index is not None:
            occurrence_by_block.setdefault((link.message_version_id, link.block_index), []).append(link)
    for block in blocks:
        blocks_by_version.setdefault(block.message_version_id, []).append(
            _block_read(
                block,
                occurrence_by_block.get((block.message_version_id, block.block_index), []),
                attachment_content_prefix=attachment_content_prefix,
            )
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
        items.append(_message_item(message, version, message_blocks, start_offset + index + 1))
    return ReaderTurnResponse(
        conversation_id=conversation_id,
        turn_key=selected.key if turn_metadata is None else selected_key,
        start_offset=start_offset,
        end_offset=end_offset,
        total_messages=total_messages,
        items=items,
        previous_anchor_message_id=previous_anchor_message_id,
        next_anchor_message_id=next_anchor_message_id,
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


def _block_read(
    block: RenderBlock,
    occurrence: list[MessageVersionAttachment] | None = None,
    *,
    attachment_content_prefix: str = "/api/attachments",
) -> RenderBlockRead:
    data = dict(block.data or {})
    links = occurrence or []
    if links:
        occurrence = links[0]
        data.update({
            "messageVersionId": str(occurrence.message_version_id),
            "occurrenceKey": occurrence.occurrence_key,
            "displayOrder": occurrence.display_order,
            "displayMode": occurrence.display_mode,
            "alt": occurrence.alt_text,
            "caption": occurrence.caption,
            "relationType": occurrence.relation_type,
            "attachmentOccurrences": [
                {
                    "messageVersionId": str(link.message_version_id),
                    "occurrenceKey": link.occurrence_key,
                    "attachmentId": str(link.attachment_id),
                    "blockIndex": link.block_index,
                    "renderBlockId": str(block.id),
                    "startOffset": getattr(link, "start_offset", None),
                    "endOffset": getattr(link, "end_offset", None),
                    "displayOrder": link.display_order,
                    "displayMode": link.display_mode,
                    "alt": link.alt_text,
                    "caption": link.caption,
                    "relationType": link.relation_type,
                }
                for link in links
            ],
        })
        # The Reader has already loaded this relation for the complete-turn
        # response. Supplying the same safe attachment representation prevents
        # every inline block from immediately issuing a duplicate detail request.
        if occurrence.attachment is not None and occurrence.attachment.deleted_at is None:
            data["attachment"] = attachment_read(
                occurrence.attachment,
                content_prefix=attachment_content_prefix,
            ).model_dump(mode="json")
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
