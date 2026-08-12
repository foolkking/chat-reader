from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.message import Message
from app.services.toc.toc_builder import rebuild_headings_for_all, rebuild_headings_for_conversation


@dataclass(frozen=True)
class TocRefreshResult:
    conversation_id: uuid.UUID
    dialogue_message_count: int
    section_conversation_count: int
    heading_count: int
    refresh_dialogue_index: bool
    refresh_section_toc: bool
    section_scope: str


def refresh_toc_data(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    refresh_dialogue_index: bool,
    refresh_section_toc: bool,
    section_scope: str,
    progress_callback=None,
) -> TocRefreshResult:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ValueError("Conversation not found.")
    if not refresh_dialogue_index and not refresh_section_toc:
        raise ValueError("At least one TOC target must be selected.")
    if section_scope not in {"current_conversation", "all_conversations"}:
        raise ValueError("Unsupported section TOC scope.")

    dialogue_message_count = 0
    if refresh_dialogue_index:
        # Dialogue index rows are projected directly from current canonical
        # messages. The worker validates/counts that source; Web invalidates
        # its dialogue-index cache only after this task commits.
        dialogue_message_count = (
            db.query(func.count(Message.id))
            .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
            .scalar()
            or 0
        )
        if progress_callback:
            progress_callback("refreshing_dialogue_index", 20, 1, 1)

    section_conversation_count = 0
    heading_count = 0
    if refresh_section_toc and section_scope == "all_conversations":
        def report_sections(processed: int, total: int) -> None:
            if progress_callback:
                progress = 25 + round(65 * processed / max(total, 1))
                progress_callback("rebuilding_section_toc", progress, processed, total)

        result = rebuild_headings_for_all(db, progress_callback=report_sections)
        section_conversation_count = result.conversation_count
        heading_count = result.heading_count
    elif refresh_section_toc:
        if progress_callback:
            progress_callback("rebuilding_section_toc", 55, 0, 1)
        result = rebuild_headings_for_conversation(db, conversation_id)
        section_conversation_count = result.conversation_count
        heading_count = result.heading_count
        if progress_callback:
            progress_callback("rebuilding_section_toc", 90, 1, 1)

    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            event_type="toc_refreshed",
            payload={
                "refresh_dialogue_index": refresh_dialogue_index,
                "refresh_section_toc": refresh_section_toc,
                "section_scope": section_scope,
                "dialogue_message_count": dialogue_message_count,
                "section_conversation_count": section_conversation_count,
                "heading_count": heading_count,
            },
            created_by="user",
        )
    )
    db.flush()
    return TocRefreshResult(
        conversation_id=conversation_id,
        dialogue_message_count=dialogue_message_count,
        section_conversation_count=section_conversation_count,
        heading_count=heading_count,
        refresh_dialogue_index=refresh_dialogue_index,
        refresh_section_toc=refresh_section_toc,
        section_scope=section_scope,
    )
