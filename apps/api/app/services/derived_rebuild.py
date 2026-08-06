from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.canonical.block_builder import build_basic_render_blocks
from app.services.import_pipeline.canonical_draft import (
    BLOCK_BUILDER_VERSION,
    MARKDOWN_PARSER_VERSION,
    NORMALIZER_VERSION,
    SEARCH_DOCUMENT_VERSION,
    content_hash,
)
from app.services.search.search_indexer import rebuild_search_and_toc_for_conversation


@dataclass(frozen=True)
class DerivedRebuildResult:
    conversation_id: uuid.UUID
    rebuilt_versions: int
    rebuilt_blocks: int


def rebuild_conversation_derived_data(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    progress_callback=None,
) -> DerivedRebuildResult:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ValueError("Conversation not found.")

    version_ids = [
        row[0]
        for row in (
            db.query(MessageVersion.id)
            .join(Message, Message.id == MessageVersion.message_id)
            .filter(Message.conversation_id == conversation_id)
            .order_by(Message.order_key, MessageVersion.version_number)
            .all()
        )
    ]
    total = len(version_ids)
    rebuilt_versions = 0
    rebuilt_blocks = 0
    for offset in range(0, total, 50):
        batch_ids = version_ids[offset : offset + 50]
        rows = (
            db.query(MessageVersion, Message)
            .join(Message, Message.id == MessageVersion.message_id)
            .filter(MessageVersion.id.in_(batch_ids))
            .all()
        )
        for version, message in rows:
            blocks = build_basic_render_blocks(version.display_text)
            version.plain_text = "\n\n".join(block.plain_text or "" for block in blocks).strip()
            version.content_hash = content_hash(version.display_text, message.role)
            version.blocks = [_block_payload(index, block) for index, block in enumerate(blocks)]
            version.normalizer_version = NORMALIZER_VERSION
            version.markdown_parser_version = MARKDOWN_PARSER_VERSION
            version.block_builder_version = BLOCK_BUILDER_VERSION
            version.search_document_version = SEARCH_DOCUMENT_VERSION
            db.query(RenderBlock).filter(RenderBlock.message_version_id == version.id).delete(synchronize_session=False)
            for index, block in enumerate(blocks):
                db.add(
                    RenderBlock(
                        id=uuid.uuid4(),
                        message_version_id=version.id,
                        block_index=index,
                        block_type=block.block_type,
                        plain_text=block.plain_text,
                        data=block.data,
                        char_count=block.char_count,
                        collapsed_by_default=block.collapsed_by_default,
                        render_priority=block.render_priority,
                    )
                )
            if message.current_version_id == version.id:
                message.content_hash = version.content_hash
                message.block_count = len(blocks)
                message.char_count = len(version.display_text)
                message.is_heavy = message.char_count > 12000 or message.block_count > 80
            rebuilt_versions += 1
            rebuilt_blocks += len(blocks)
        db.flush()
        if progress_callback:
            progress_callback("rebuilding_versions", min(85, 10 + round(75 * rebuilt_versions / max(total, 1))), rebuilt_versions, total)

    current_versions = (
        db.query(MessageVersion)
        .join(Message, Message.current_version_id == MessageVersion.id)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key)
        .all()
    )
    conversation.content_hash = content_hash("\n".join(version.plain_text for version in current_versions)) if current_versions else None
    conversation.offline_revision += 1
    if progress_callback:
        progress_callback("rebuilding_indexes", 90, rebuilt_versions, total)
    rebuild_search_and_toc_for_conversation(db, conversation_id)
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            event_type="derived_data_rebuilt",
            payload={
                "normalizer_version": NORMALIZER_VERSION,
                "markdown_parser_version": MARKDOWN_PARSER_VERSION,
                "block_builder_version": BLOCK_BUILDER_VERSION,
                "search_document_version": SEARCH_DOCUMENT_VERSION,
                "rebuilt_versions": rebuilt_versions,
                "rebuilt_blocks": rebuilt_blocks,
            },
            created_by="system",
        )
    )
    db.flush()
    return DerivedRebuildResult(conversation_id, rebuilt_versions, rebuilt_blocks)


def _block_payload(index, block) -> dict:
    return {
        "block_index": index,
        "block_type": block.block_type,
        "plain_text": block.plain_text,
        "data": block.data,
        "char_count": block.char_count,
        "collapsed_by_default": block.collapsed_by_default,
        "render_priority": block.render_priority,
    }
