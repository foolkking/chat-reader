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
from app.services.editing.message_edit_service import refresh_conversation_stats


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
    rebuild_versions: bool = True,
    commit_batches: bool = False,
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
    if not rebuild_versions:
        version_ids = []
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
        # Long rebuilds must not hold message/render-block locks for the
        # lifetime of the worker task.  The worker opts into a commit at each
        # bounded batch so interactive deletion can cancel and proceed at a
        # batch boundary.  Callers that need one transaction retain the
        # previous default.
        if commit_batches:
            db.commit()
        if progress_callback:
            progress_callback("rebuilding_versions", min(85, 10 + round(75 * rebuilt_versions / max(total, 1))), rebuilt_versions, total)

    # Derived indexes and render blocks are rebuilt asynchronously after the
    # user mutation has committed. They must not create a second conversation
    # revision, otherwise the mutation response becomes stale immediately.
    refresh_conversation_stats(db, conversation_id, bump_revision=False)
    if commit_batches:
        # Separate the statistics write from the index rebuild as well.  This
        # gives a pending conversation delete a transaction boundary before
        # the comparatively expensive search/TOC derivation begins.
        db.commit()
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
                "rebuild_versions": rebuild_versions,
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
