import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from http import HTTPStatus

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.models.conversation_event import ConversationEvent
from app.models.heading import Heading
from app.models.import_record import utc_now
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.render_block import RenderBlock
from app.models.search_document import SearchDocument
from app.models.source_message_ref import SourceMessageRef
from app.services.canonical.block_builder import build_basic_render_blocks
from app.services.import_pipeline.canonical_draft import (
    BLOCK_BUILDER_VERSION,
    MARKDOWN_PARSER_VERSION,
    NORMALIZER_VERSION,
    PARSER_VERSION,
    SEARCH_DOCUMENT_VERSION,
    content_hash,
)
from app.services.import_pipeline.thinking_cleaner import clean_thinking_summary
from app.services.projects.project_service import add_conversation_to_project, ensure_default_project
from app.services.search.search_indexer import (
    rebuild_search_and_toc_for_conversation,
)
from app.services.annotations import relocate_annotations_for_new_version
from app.services.editing.conversation_merge_service import copy_conversation_history
from app.services.assets.scanner import scan_status_allows_use
from app.services.database.bulk_insert import insert_rows

MAX_EDIT_TEXT_LENGTH = 200_000
MESSAGE_ORDER_SCALE = Decimal("1000000")
MergeProgressCallback = Callable[[str, int, int, int], None]


class MessageEditError(ValueError):
    def __init__(self, message: str, status_code: int = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class MessageEditResult:
    message: Message
    previous_version_id: uuid.UUID | None
    current_version: MessageVersion
    warnings: list[str] = field(default_factory=list)
    timings: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class MessageSplitResult:
    original_message: Message
    new_message: Message
    original_version: MessageVersion
    new_version: MessageVersion


@dataclass(frozen=True)
class MessageMergeResult:
    survivor_message: Message
    merged_message_ids: list[uuid.UUID]
    current_version: MessageVersion


@dataclass(frozen=True)
class ConversationTransformResult:
    conversation: Conversation
    message_count: int


@dataclass(frozen=True)
class ConversationSplitGroup:
    messages: list[Message]
    suggested_title: str


@dataclass(frozen=True)
class MessageVersionDeleteResult:
    message: Message
    deleted_version_id: uuid.UUID
    current_version: MessageVersion
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ConversationAutoCleanResult:
    conversation: Conversation
    scanned_messages: int
    cleaned_messages: int


@dataclass(frozen=True)
class ConversationCreateResult:
    conversation: Conversation
    messages: list[Message]


@dataclass(frozen=True)
class MessageInsertResult:
    conversation: Conversation
    messages: list[Message]


@dataclass(frozen=True)
class MessageDeleteResult:
    message: Message
    was_deleted: bool


def edit_message(
    db: Session,
    message_id: uuid.UUID,
    new_text: str,
    edit_reason: str | None = None,
    base_version_id: uuid.UUID | None = None,
    save_mode: str = "create_version",
    rebuild_derived: bool = True,
    attachment_occurrences=None,
) -> MessageEditResult:
    import time

    timings: dict[str, float] = {}
    base_started = time.perf_counter()
    message = _get_editable_message(db, message_id)
    current_version = _get_current_version(db, message)
    timings["base_version_check_ms"] = round((time.perf_counter() - base_started) * 1000, 3)
    markdown_started = time.perf_counter()
    clean_text = _validate_text(new_text)
    timings["request_validation_ms"] = round((time.perf_counter() - markdown_started) * 1000, 3)

    if base_version_id is not None and current_version.id != base_version_id:
        raise MessageEditError("Base version does not match current version.", HTTPStatus.CONFLICT)
    if clean_text == current_version.display_text:
        raise MessageEditError("No changes to save.")

    if save_mode not in {"create_version", "replace_current"}:
        raise MessageEditError("Unsupported save mode.")
    if save_mode == "replace_current":
        if current_version.version_number == 1:
            raise MessageEditError("The initial version cannot be replaced.")
        previous_hash = current_version.content_hash
        version_started = time.perf_counter()
        _replace_version_content(
            db=db,
            message=message,
            version=current_version,
            text=clean_text,
            edit_reason=edit_reason or "replace current version",
            timings=timings,
            attachment_occurrences=attachment_occurrences,
        )
        timings["version_insert_ms"] = round((time.perf_counter() - version_started) * 1000, 3)
        _write_event(
            db=db,
            message=message,
            event_type="message_version_replaced",
            target_version_id=current_version.id,
            created_by="user",
            payload={
                "message_id": str(message.id),
                "version_id": str(current_version.id),
                "version_number": current_version.version_number,
                "previous_content_hash": previous_hash,
                "content_hash": current_version.content_hash,
                "edit_reason": current_version.edit_reason,
            },
        )
        if rebuild_derived:
            _refresh_conversation_stats(db, message.conversation_id)
            rebuild_search_and_toc_for_conversation(db, message.conversation_id)
        db.flush()
        return MessageEditResult(
            message=message,
            previous_version_id=current_version.id,
            current_version=current_version,
            timings=timings,
        )

    version_started = time.perf_counter()
    new_version = _create_version(
        db=db,
        message=message,
        text=clean_text,
        edit_type="manual_edit",
        edit_reason=edit_reason or "manual edit",
        created_by="user",
        based_on_version_id=current_version.id,
        timings=timings,
        attachment_occurrences=attachment_occurrences,
    )
    timings["version_insert_ms"] = round((time.perf_counter() - version_started) * 1000, 3)
    _write_event(
        db=db,
        message=message,
        event_type="message_edited",
        target_version_id=new_version.id,
        created_by="user",
        payload={
            "message_id": str(message.id),
            "previous_version_id": str(current_version.id),
            "new_version_id": str(new_version.id),
            "previous_version_number": current_version.version_number,
            "new_version_number": new_version.version_number,
            "edit_reason": new_version.edit_reason,
            "content_hash": new_version.content_hash,
        },
    )
    if rebuild_derived:
        _refresh_conversation_stats(db, message.conversation_id)
        rebuild_search_and_toc_for_conversation(db, message.conversation_id)
    db.flush()
    return MessageEditResult(
        message=message,
        previous_version_id=current_version.id,
        current_version=new_version,
        timings=timings,
    )


def create_system_message_version(
    db: Session,
    *,
    message: Message,
    text: str,
    plain_text: str,
    edit_type: str,
    edit_reason: str,
) -> MessageVersion:
    """Create a version for a deterministic system repair while preserving history."""
    current_version = _get_current_version(db, message)
    return _create_version(
        db=db,
        message=message,
        text=_validate_text(text),
        plain_text=plain_text,
        edit_type=edit_type,
        edit_reason=edit_reason,
        created_by="system",
        based_on_version_id=current_version.id,
    )


def auto_clean_conversation(
    db: Session,
    conversation_id: uuid.UUID,
    progress_callback: MergeProgressCallback | None = None,
) -> ConversationAutoCleanResult:
    conversation = _get_active_conversation(db, conversation_id)
    messages = (
        db.query(Message)
        .filter(
            Message.conversation_id == conversation_id,
            Message.is_deleted.is_(False),
            Message.role == "assistant",
        )
        .order_by(Message.order_key.asc())
        .all()
    )
    total = len(messages)
    cleaned_count = 0
    for index, message in enumerate(messages, start=1):
        current_version = _get_current_version(db, message)
        cleaned = clean_thinking_summary(message.role, current_version.display_text)
        if cleaned.removed and cleaned.text != current_version.display_text:
            new_version = _create_version(
                db=db,
                message=message,
                text=cleaned.text,
                plain_text=cleaned.text,
                edit_type="auto_clean",
                edit_reason="remove exported thinking/search summary",
                created_by="system",
                based_on_version_id=current_version.id,
            )
            _write_event(
                db=db,
                message=message,
                event_type="message_edited",
                target_version_id=new_version.id,
                created_by="system",
                payload={
                    "message_id": str(message.id),
                    "previous_version_id": str(current_version.id),
                    "new_version_id": str(new_version.id),
                    "edit_type": "auto_clean",
                },
            )
            cleaned_count += 1
        if progress_callback and (index == total or index % 25 == 0):
            progress_callback("cleaning_messages", 10 + int((index / max(total, 1)) * 70), index, total)

    if cleaned_count:
        if progress_callback:
            progress_callback("rebuilding_index", 85, total, total)
        rebuild_search_and_toc_for_conversation(db, conversation_id)
    db.flush()
    return ConversationAutoCleanResult(
        conversation=conversation,
        scanned_messages=total,
        cleaned_messages=cleaned_count,
    )


def split_message(
    db: Session,
    message_id: uuid.UUID,
    split_offset: int,
    edit_reason: str | None = None,
) -> MessageSplitResult:
    message = _get_editable_message(db, message_id)
    current_version = _get_current_version(db, message)
    text = current_version.display_text
    if split_offset <= 0 or split_offset >= len(text):
        raise MessageEditError("Split offset must be inside the message content.")

    first_text = _validate_text(text[:split_offset])
    second_text = _validate_text(text[split_offset:])
    reason = edit_reason or "split message"

    original_version = _create_version(
        db=db,
        message=message,
        text=first_text,
        edit_type="split",
        edit_reason=reason,
        created_by="user",
        based_on_version_id=current_version.id,
    )
    new_message, new_version = _create_message_with_version(
        db=db,
        conversation_id=message.conversation_id,
        role=message.role,
        text=second_text,
        order_key=f"{message.order_key}.split-{uuid.uuid4().hex[:8]}",
        turn_index=message.turn_index,
        created_at=message.created_at,
        edit_type="split",
        edit_reason=reason,
        created_by="user",
        source_type="split",
        based_on_version_id=current_version.id,
    )
    _renumber_conversation(db, message.conversation_id)
    _refresh_conversation_stats(db, message.conversation_id)
    _write_event(
        db=db,
        message=message,
        event_type="message_split",
        target_version_id=original_version.id,
        created_by="user",
        payload={
            "message_id": str(message.id),
            "new_message_id": str(new_message.id),
            "previous_version_id": str(current_version.id),
            "original_version_id": str(original_version.id),
            "new_version_id": str(new_version.id),
            "split_offset": split_offset,
            "edit_reason": reason,
        },
    )
    rebuild_search_and_toc_for_conversation(db, message.conversation_id)
    db.flush()
    return MessageSplitResult(
        original_message=message,
        new_message=new_message,
        original_version=original_version,
        new_version=new_version,
    )


def merge_messages(
    db: Session,
    message_ids: list[uuid.UUID],
    separator: str = "\n\n",
    edit_reason: str | None = None,
) -> MessageMergeResult:
    if len(message_ids) < 2:
        raise MessageEditError("At least two messages are required for merge.")
    unique_ids = list(dict.fromkeys(message_ids))
    if len(unique_ids) != len(message_ids):
        raise MessageEditError("Duplicate message ids are not allowed.")

    messages = [_get_editable_message(db, message_id) for message_id in unique_ids]
    conversation_id = messages[0].conversation_id
    if any(message.conversation_id != conversation_id for message in messages):
        raise MessageEditError("Messages must belong to the same conversation.")
    role = messages[0].role
    if any(message.role != role for message in messages):
        raise MessageEditError("Only adjacent messages with the same role can be merged.")

    active_messages = _active_messages(db, conversation_id)
    positions = [active_messages.index(message) for message in messages]
    sorted_positions = sorted(positions)
    if sorted_positions != list(range(sorted_positions[0], sorted_positions[-1] + 1)):
        raise MessageEditError("Messages must be adjacent to merge.")

    ordered_messages = [active_messages[index] for index in sorted_positions]
    survivor = ordered_messages[0]
    versions = [_get_current_version(db, message) for message in ordered_messages]
    reason = edit_reason or "merge messages"
    merged_text = separator.join(version.display_text.strip() for version in versions if version.display_text.strip())
    merged_version = _create_version(
        db=db,
        message=survivor,
        text=merged_text,
        edit_type="merged",
        edit_reason=reason,
        created_by="user",
        based_on_version_id=versions[0].id,
    )

    deleted_at = utc_now()
    absorbed_ids: list[uuid.UUID] = []
    for absorbed in ordered_messages[1:]:
        absorbed.is_deleted = True
        absorbed.deleted_at = deleted_at
        absorbed.deleted_by = "user"
        absorbed.delete_reason = f"merged into {survivor.id}"
        absorbed_ids.append(absorbed.id)

    _renumber_conversation(db, conversation_id)
    _refresh_conversation_stats(db, conversation_id)
    _write_event(
        db=db,
        message=survivor,
        event_type="message_merged",
        target_version_id=merged_version.id,
        created_by="user",
        payload={
            "survivor_message_id": str(survivor.id),
            "merged_message_ids": [str(message.id) for message in ordered_messages],
            "absorbed_message_ids": [str(message_id) for message_id in absorbed_ids],
            "new_version_id": str(merged_version.id),
            "edit_reason": reason,
        },
    )
    rebuild_search_and_toc_for_conversation(db, conversation_id)
    db.flush()
    return MessageMergeResult(
        survivor_message=survivor,
        merged_message_ids=[message.id for message in ordered_messages],
        current_version=merged_version,
    )


def merge_conversations(
    db: Session,
    conversation_ids: list[uuid.UUID],
    title: str | None = None,
    project_id: uuid.UUID | None = None,
    progress_callback: MergeProgressCallback | None = None,
) -> ConversationTransformResult:
    if len(conversation_ids) < 2:
        raise MessageEditError("At least two conversations are required for merge.")
    unique_ids = list(dict.fromkeys(conversation_ids))
    if len(unique_ids) != len(conversation_ids):
        raise MessageEditError("Duplicate conversation ids are not allowed.")
    conversations = [_get_active_conversation(db, conversation_id) for conversation_id in unique_ids]
    merged_title = (title or " / ".join(conversation.display_title for conversation in conversations[:2])).strip()
    if not merged_title:
        merged_title = "Merged conversation"

    new_conversation = _create_empty_conversation(
        db=db,
        title=merged_title,
        source_type="merged",
        source_profile="merged",
        status="processing",
    )
    copy_result = copy_conversation_history(
        db,
        target=new_conversation,
        sources=conversations,
        progress_callback=progress_callback,
    )
    copied_count = copy_result.message_count
    _attach_conversation_to_project(db, new_conversation.id, project_id)
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=new_conversation.id,
            event_type="conversation_merged",
            payload={
                "source_conversation_ids": [str(conversation.id) for conversation in conversations],
                "order_policy": "request_order",
                "message_count": copied_count,
                "version_count": copy_result.version_count,
                "block_count": copy_result.block_count,
                "annotation_count": copy_result.annotation_count,
                "heading_count": copy_result.heading_count,
                "attachment_count": copy_result.attachment_count,
            },
            created_by="user",
        )
    )
    for conversation in conversations:
        db.add(
            ConversationEvent(
                id=uuid.uuid4(),
                conversation_id=conversation.id,
                event_type="conversation_merged_into",
                payload={"target_conversation_id": str(new_conversation.id)},
                created_by="user",
            )
        )
    new_conversation.status = "active"
    db.flush()
    return ConversationTransformResult(conversation=new_conversation, message_count=copied_count)


def split_conversation(
    db: Session,
    conversation_id: uuid.UUID,
    start_message_id: uuid.UUID,
    end_message_id: uuid.UUID | None = None,
    title: str | None = None,
    project_id: uuid.UUID | None = None,
) -> ConversationTransformResult:
    source = _get_active_conversation(db, conversation_id)
    messages = _active_messages(db, source.id)
    start_index = _message_index(messages, start_message_id)
    end_index = _message_index(messages, end_message_id) if end_message_id else len(messages) - 1
    if start_index > end_index:
        raise MessageEditError("Start message must come before end message.")
    selected = messages[start_index : end_index + 1]
    if not selected:
        raise MessageEditError("Conversation split range is empty.")

    split_title = (title or f"{source.display_title} split").strip()
    new_conversation = _create_empty_conversation(
        db=db,
        title=split_title,
        source_type="split",
        source_profile="split",
    )
    copied_count = _copy_messages_to_conversation(
        db=db,
        target=new_conversation,
        source_messages=selected,
        source_operation="conversation_split",
    )
    _refresh_conversation_stats(db, new_conversation.id)
    _attach_conversation_to_project(db, new_conversation.id, project_id)
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=source.id,
            event_type="conversation_split",
            payload={
                "target_conversation_id": str(new_conversation.id),
                "start_message_id": str(start_message_id),
                "end_message_id": str(end_message_id) if end_message_id else None,
                "message_count": copied_count,
            },
            created_by="user",
        )
    )
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=new_conversation.id,
            event_type="conversation_created_from_split",
            payload={"source_conversation_id": str(source.id), "message_count": copied_count},
            created_by="user",
        )
    )
    rebuild_search_and_toc_for_conversation(db, new_conversation.id)
    db.flush()
    return ConversationTransformResult(conversation=new_conversation, message_count=copied_count)


def plan_conversation_split(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    mode: str,
    start_message_id: uuid.UUID | None = None,
    end_message_id: uuid.UUID | None = None,
    boundary_message_id: uuid.UUID | None = None,
    message_ids: list[uuid.UUID] | None = None,
) -> list[ConversationSplitGroup]:
    source = _get_active_conversation(db, conversation_id)
    messages = _active_messages(db, source.id)
    if not messages:
        raise MessageEditError("Conversation has no messages.")
    if mode == "range_copy":
        if start_message_id is None:
            raise MessageEditError("A range start message is required.")
        start_index = _message_index(messages, start_message_id)
        end_index = _message_index(messages, end_message_id) if end_message_id else len(messages) - 1
        if start_index > end_index:
            raise MessageEditError("Start message must come before end message.")
        return [ConversationSplitGroup(messages[start_index : end_index + 1], f"{source.display_title} excerpt")]
    if mode == "boundary_copy":
        if boundary_message_id is None:
            raise MessageEditError("A boundary message is required.")
        boundary_index = _message_index(messages, boundary_message_id)
        if boundary_index >= len(messages) - 1:
            raise MessageEditError("The boundary must leave messages on both sides.")
        return [
            ConversationSplitGroup(messages[: boundary_index + 1], f"{source.display_title} part 1"),
            ConversationSplitGroup(messages[boundary_index + 1 :], f"{source.display_title} part 2"),
        ]
    if mode == "discrete_copy":
        requested = message_ids or []
        if not requested:
            raise MessageEditError("At least one message must be selected.")
        if len(set(requested)) != len(requested):
            raise MessageEditError("Duplicate message ids are not allowed.")
        requested_set = set(requested)
        selected = [message for message in messages if message.id in requested_set]
        if len(selected) != len(requested):
            raise MessageEditError("Every selected message must belong to the conversation.")
        return [ConversationSplitGroup(selected, f"{source.display_title} selection")]
    raise MessageEditError("Unsupported conversation split mode.")


def execute_conversation_split(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    mode: str,
    groups: list[ConversationSplitGroup],
    titles: list[str] | None = None,
    project_id: uuid.UUID | None = None,
) -> list[ConversationTransformResult]:
    source = _get_active_conversation(db, conversation_id)
    requested_titles = titles or []
    results: list[ConversationTransformResult] = []
    for index, group in enumerate(groups):
        title = (requested_titles[index] if index < len(requested_titles) else group.suggested_title).strip()
        if not title:
            raise MessageEditError("Conversation title cannot be empty.")
        target = _create_empty_conversation(
            db=db,
            title=title,
            source_type="split",
            source_profile=mode,
        )
        copied_count = _copy_messages_to_conversation(
            db=db,
            target=target,
            source_messages=group.messages,
            source_operation=f"conversation_{mode}",
        )
        _refresh_conversation_stats(db, target.id)
        _attach_conversation_to_project(db, target.id, project_id)
        db.add(ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=target.id,
            event_type="conversation_created_from_split",
            payload={"source_conversation_id": str(source.id), "mode": mode, "message_count": copied_count},
            created_by="user",
        ))
        rebuild_search_and_toc_for_conversation(db, target.id)
        results.append(ConversationTransformResult(target, copied_count))
    db.add(ConversationEvent(
        id=uuid.uuid4(),
        conversation_id=source.id,
        event_type="conversation_split",
        payload={
            "mode": mode,
            "target_conversation_ids": [str(result.conversation.id) for result in results],
            "message_counts": [result.message_count for result in results],
        },
        created_by="user",
    ))
    db.flush()
    return results


def list_message_versions(db: Session, message_id: uuid.UUID) -> list[MessageVersion]:
    message = db.get(Message, message_id)
    if message is None:
        raise MessageEditError("Message not found.", HTTPStatus.NOT_FOUND)
    return (
        db.query(MessageVersion)
        .filter(MessageVersion.message_id == message_id)
        .order_by(MessageVersion.version_number.desc())
        .all()
    )


def select_message_version(db: Session, message_id: uuid.UUID, version_id: uuid.UUID) -> MessageEditResult:
    message = _get_editable_message(db, message_id)
    current = _get_current_version(db, message)
    selected = db.get(MessageVersion, version_id)
    if selected is None or selected.message_id != message.id:
        raise MessageEditError("Message version not found.", HTTPStatus.NOT_FOUND)
    if selected.id == current.id:
        return MessageEditResult(message, current.id, current)
    message.current_version_id = selected.id
    _sync_message_from_version(db, message, selected)
    relocate_annotations_for_new_version(
        db,
        message=message,
        version=selected,
        block_texts=[block.plain_text or "" for block in _version_blocks(db, selected.id)],
    )
    _write_event(
        db=db,
        message=message,
        event_type="message_version_selected",
        target_version_id=selected.id,
        created_by="user",
        payload={"previous_version_id": str(current.id), "selected_version_id": str(selected.id)},
    )
    _refresh_conversation_stats(db, message.conversation_id)
    rebuild_search_and_toc_for_conversation(db, message.conversation_id)
    db.flush()
    return MessageEditResult(message, current.id, selected)


def delete_message_version(db: Session, message_id: uuid.UUID, version_id: uuid.UUID) -> MessageVersionDeleteResult:
    message = _get_editable_message(db, message_id)
    target = db.get(MessageVersion, version_id)
    if target is None or target.message_id != message.id:
        raise MessageEditError("Message version not found.", HTTPStatus.NOT_FOUND)
    if target.version_number == 1:
        raise MessageEditError("The initial version cannot be deleted.")
    warnings: list[str] = []
    current = _get_current_version(db, message)
    if current.id == target.id:
        fallback = (
            db.query(MessageVersion)
            .filter(MessageVersion.message_id == message.id, MessageVersion.version_number < target.version_number)
            .order_by(MessageVersion.version_number.desc())
            .first()
        )
        if fallback is None:
            raise MessageEditError("No earlier version is available.")
        message.current_version_id = fallback.id
        _sync_message_from_version(db, message, fallback)
        current = fallback
    relocate_annotations_for_new_version(
        db,
        message=message,
        version=current,
        block_texts=[block.plain_text or "" for block in _version_blocks(db, current.id)],
    )
    db.query(MessageVersion).filter(MessageVersion.based_on_version_id == target.id).update(
        {MessageVersion.based_on_version_id: None}, synchronize_session=False
    )
    db.query(Heading).filter(Heading.message_version_id == target.id).delete(synchronize_session=False)
    db.query(SearchDocument).filter(SearchDocument.message_version_id == target.id).delete(synchronize_session=False)
    _write_event(
        db=db,
        message=message,
        event_type="message_version_deleted",
        target_version_id=None,
        created_by="user",
        payload={
            "deleted_version_id": str(target.id),
            "deleted_version_number": target.version_number,
            "selected_version_id": str(current.id),
        },
    )
    deleted_id = target.id
    db.delete(target)
    _refresh_conversation_stats(db, message.conversation_id)
    rebuild_search_and_toc_for_conversation(db, message.conversation_id)
    db.flush()
    return MessageVersionDeleteResult(message, deleted_id, current, warnings)


def restore_message_version(
    db: Session,
    message_id: uuid.UUID,
    version_id: uuid.UUID,
    edit_reason: str | None = None,
) -> MessageEditResult:
    message = _get_editable_message(db, message_id)
    current_version = _get_current_version(db, message)
    restore_source = db.get(MessageVersion, version_id)
    if restore_source is None or restore_source.message_id != message.id:
        raise MessageEditError("Message version not found.", HTTPStatus.NOT_FOUND)
    if restore_source.id == current_version.id:
        raise MessageEditError("Version is already current.")

    reason = edit_reason or f"restore version {restore_source.version_number}"
    new_version = _create_version(
        db=db,
        message=message,
        text=restore_source.display_text,
        edit_type="restore",
        edit_reason=reason,
        created_by="user",
        based_on_version_id=restore_source.id,
        plain_text=restore_source.plain_text,
    )
    _write_event(
        db=db,
        message=message,
        event_type="message_version_restored",
        target_version_id=new_version.id,
        created_by="user",
        payload={
            "message_id": str(message.id),
            "restored_from_version_id": str(restore_source.id),
            "restored_from_version_number": restore_source.version_number,
            "previous_version_id": str(current_version.id),
            "previous_version_number": current_version.version_number,
            "new_version_id": str(new_version.id),
            "new_version_number": new_version.version_number,
            "edit_reason": reason,
        },
    )
    _refresh_conversation_stats(db, message.conversation_id)
    rebuild_search_and_toc_for_conversation(db, message.conversation_id)
    db.flush()
    return MessageEditResult(
        message=message,
        previous_version_id=current_version.id,
        current_version=new_version,
    )


def _get_editable_message(db: Session, message_id: uuid.UUID) -> Message:
    message = db.get(Message, message_id)
    if message is None:
        raise MessageEditError("Message not found.", HTTPStatus.NOT_FOUND)
    if message.is_deleted:
        raise MessageEditError("Deleted messages cannot be edited.")
    return message


def _get_current_version(db: Session, message: Message) -> MessageVersion:
    if message.current_version_id is None:
        raise MessageEditError("Message has no current version.")
    version = db.get(MessageVersion, message.current_version_id)
    if version is None:
        raise MessageEditError("Current message version not found.", HTTPStatus.NOT_FOUND)
    return version


def _validate_text(text: str) -> str:
    clean_text = text.strip()
    if not clean_text:
        raise MessageEditError("Message content cannot be empty.")
    if len(clean_text) > MAX_EDIT_TEXT_LENGTH:
        raise MessageEditError("Message content is too large.")
    return clean_text


def _version_blocks(db: Session, version_id: uuid.UUID) -> list[RenderBlock]:
    return (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == version_id)
        .order_by(RenderBlock.block_index.asc())
        .all()
    )


def _sync_message_from_version(
    db: Session,
    message: Message,
    version: MessageVersion,
    *,
    block_count: int | None = None,
) -> None:
    blocks = _version_blocks(db, version.id) if block_count is None else []
    message.content_hash = version.content_hash
    message.block_count = block_count if block_count is not None else len(blocks)
    message.char_count = len(version.display_text)
    message.is_heavy = len(version.display_text) > 12000 or message.block_count > 80
    conversation = db.get(Conversation, message.conversation_id)
    if conversation is not None:
        conversation.offline_revision += 1


def _replace_version_content(
    db: Session,
    *,
    message: Message,
    version: MessageVersion,
    text: str,
    edit_reason: str,
    timings: dict[str, float] | None = None,
    attachment_occurrences=None,
) -> None:
    import time
    parse_started = time.perf_counter()
    block_drafts = build_basic_render_blocks(text)
    if timings is not None:
        timings["markdown_parse_ms"] = round((time.perf_counter() - parse_started) * 1000, 3)
    render_started = time.perf_counter()
    db.query(RenderBlock).filter(RenderBlock.message_version_id == version.id).delete(synchronize_session=False)
    version.plain_text = text
    version.display_text = text
    version.blocks = [
        {
            "block_index": index,
            "block_type": block.block_type,
            "plain_text": block.plain_text,
            "data": block.data,
            "char_count": block.char_count,
        }
        for index, block in enumerate(block_drafts)
    ]
    version.edit_type = "manual_replace"
    version.edit_reason = edit_reason
    version.content_hash = content_hash(text, message.role)
    version.normalizer_version = NORMALIZER_VERSION
    version.markdown_parser_version = MARKDOWN_PARSER_VERSION
    version.block_builder_version = BLOCK_BUILDER_VERSION
    version.search_document_version = SEARCH_DOCUMENT_VERSION
    insert_rows(db, RenderBlock, _render_block_rows(version.id, block_drafts))
    if timings is not None:
        timings["render_block_ms"] = round((time.perf_counter() - render_started) * 1000, 3)
    occurrence_started = time.perf_counter()
    _sync_version_attachment_links(
        db,
        version.id,
        block_drafts,
        source_text=text,
        replace_existing=True,
        timings=timings,
        occurrence_declarations=attachment_occurrences,
    )
    if timings is not None:
        timings["occurrence_insert_ms"] = round((time.perf_counter() - occurrence_started) * 1000, 3)
    db.flush()
    relocate_annotations_for_new_version(
        db,
        message=message,
        version=version,
        block_texts=[block.plain_text for block in block_drafts],
    )
    _sync_message_from_version(db, message, version, block_count=len(block_drafts))


def _create_version(
    db: Session,
    message: Message,
    text: str,
    edit_type: str,
    edit_reason: str,
    created_by: str,
    based_on_version_id: uuid.UUID | None,
    plain_text: str | None = None,
    timings: dict[str, float] | None = None,
    attachment_occurrences=None,
) -> MessageVersion:
    import time
    parse_started = time.perf_counter()
    next_version_number = _next_version_number(db, message.id)
    plain = plain_text if plain_text is not None else text
    block_drafts = build_basic_render_blocks(text)
    if timings is not None:
        timings["markdown_parse_ms"] = round((time.perf_counter() - parse_started) * 1000, 3)
    blocks_payload = [
        {
            "block_index": index,
            "block_type": block.block_type,
            "plain_text": block.plain_text,
            "data": block.data,
            "char_count": block.char_count,
        }
        for index, block in enumerate(block_drafts)
    ]
    new_hash = content_hash(text, message.role)
    version = MessageVersion(
        id=uuid.uuid4(),
        message_id=message.id,
        version_number=next_version_number,
        plain_text=plain,
        display_text=text,
        blocks=blocks_payload,
        edit_type=edit_type,
        edit_reason=edit_reason,
        created_by=created_by,
        based_on_version_id=based_on_version_id,
        content_hash=new_hash,
        normalizer_version=NORMALIZER_VERSION,
        markdown_parser_version=MARKDOWN_PARSER_VERSION,
        block_builder_version=BLOCK_BUILDER_VERSION,
        search_document_version=SEARCH_DOCUMENT_VERSION,
    )
    db.add(version)
    db.flush()

    render_started = time.perf_counter()
    insert_rows(db, RenderBlock, _render_block_rows(version.id, block_drafts))

    if timings is not None:
        timings["render_block_ms"] = round((time.perf_counter() - render_started) * 1000, 3)
    occurrence_started = time.perf_counter()
    _sync_version_attachment_links(
        db,
        version.id,
        block_drafts,
        source_text=text,
        replace_existing=False,
        timings=timings,
        occurrence_declarations=attachment_occurrences,
    )
    if timings is not None:
        timings["occurrence_insert_ms"] = round((time.perf_counter() - occurrence_started) * 1000, 3)

    relocate_annotations_for_new_version(
        db,
        message=message,
        version=version,
        block_texts=[block.plain_text for block in block_drafts],
    )
    message.current_version_id = version.id
    message.content_hash = new_hash
    message.block_count = len(block_drafts)
    message.char_count = len(text)
    message.is_heavy = len(text) > 12000 or len(block_drafts) > 80
    conversation = db.get(Conversation, message.conversation_id)
    if conversation is not None:
        conversation.offline_revision += 1
    db.flush()
    return version


def _sync_version_attachment_links(
    db: Session,
    version_id: uuid.UUID,
    block_drafts,
    *,
    source_text: str,
    replace_existing: bool,
    timings: dict[str, float] | None = None,
    occurrence_declarations=None,
) -> None:
    import time
    if replace_existing:
        db.query(MessageVersionAttachment).filter(
            MessageVersionAttachment.message_version_id == version_id
        ).delete(synchronize_session=False)
    references: list[tuple[int, uuid.UUID, object]] = []
    for index, block in enumerate(block_drafts):
        if block.block_type not in {"image", "attachment"} or not isinstance(block.data, dict):
            continue
        try:
            attachment_id = uuid.UUID(str(block.data.get("attachmentId") or ""))
        except ValueError as exc:
            line_number = _attachment_reference_line(source_text, str(block.data.get("attachmentId") or ""))
            raise MessageEditError(f"Line {line_number} contains an invalid attachment reference.", 422) from exc
        references.append((index, attachment_id, block))
    if occurrence_declarations and len(occurrence_declarations) != len(references):
        raise MessageEditError("Attachment occurrence declarations do not match the Markdown references.", 422)
    if not references:
        if timings is not None:
            timings["attachment_validation_ms"] = 0.0
        return
    attachment_ids = {item[1] for item in references}
    validation_started = time.perf_counter()
    available_rows = (
        db.query(Attachment, AssetObject)
        .join(AssetObject, AssetObject.id == Attachment.asset_object_id)
        .filter(
            Attachment.id.in_(attachment_ids),
            Attachment.conversation_id == db.query(Message.conversation_id).join(
                MessageVersion, MessageVersion.message_id == Message.id
            ).filter(MessageVersion.id == version_id).scalar_subquery(),
            Attachment.deleted_at.is_(None),
            Attachment.resolution_status == "resolved",
            Attachment.status.in_(("available", "detached")),
            AssetObject.status == "available",
        )
        .all()
    )
    available = {
        attachment.id
        for attachment, asset in available_rows
        if scan_status_allows_use(asset.scan_status)
    }
    if available != attachment_ids:
        unavailable_id = next(iter(attachment_ids - available))
        line_number = _attachment_reference_line(source_text, str(unavailable_id))
        raise MessageEditError(
            f"Line {line_number} references an unavailable attachment or an attachment from another conversation.",
            422,
        )
    for attachment, _asset in available_rows:
        attachment.status = "available"
    if timings is not None:
        timings["attachment_validation_ms"] = round((time.perf_counter() - validation_started) * 1000, 3)
    rows: list[dict] = []
    for ordinal, (block_index, attachment_id, block) in enumerate(references):
        data = block.data
        declaration = occurrence_declarations[ordinal] if occurrence_declarations else None
        if declaration is not None and declaration.attachment_id != attachment_id:
            raise MessageEditError("Attachment occurrence declarations are not in Markdown reference order.", 422)
        display_order = declaration.display_order if declaration is not None else ordinal
        rows.append({
            "id": uuid.uuid4(),
            "message_version_id": version_id,
            "attachment_id": attachment_id,
            "occurrence_key": str(
                declaration.occurrence_key
                if declaration is not None
                else data.get("occurrenceKey") or f"block-{block_index}-{uuid.uuid4().hex[:8]}"
            )[:255],
            "placement": str(declaration.placement if declaration is not None else data.get("placement") or "inline")[:50],
            "relation_type": str(data.get("relationType") or ("inline" if block.block_type == "image" else "file")),
            "display_order": display_order,
            "block_index": block_index,
            "display_mode": str(data.get("displayMode") or ("inline" if block.block_type == "image" else "card")),
            "alt_text": (
                declaration.alt_text
                if declaration is not None and declaration.alt_text is not None
                else str(data.get("alt") or "") or None
            ),
            "caption": str(data.get("caption") or "") or None,
        })
    insert_rows(db, MessageVersionAttachment, rows)


def _render_block_rows(version_id: uuid.UUID, block_drafts) -> list[dict]:
    return [
        {
            "id": uuid.uuid4(),
            "message_version_id": version_id,
            "block_index": index,
            "block_type": block.block_type,
            "plain_text": block.plain_text,
            "data": block.data,
            "char_count": block.char_count,
            "collapsed_by_default": block.collapsed_by_default,
            "render_priority": block.render_priority,
        }
        for index, block in enumerate(block_drafts)
    ]


def _attachment_reference_line(source_text: str, attachment_id: str) -> int:
    needle = f"cr-asset://{attachment_id}"
    return next(
        (line_number for line_number, line in enumerate(source_text.splitlines(), 1) if needle in line),
        1,
    )


def _create_message_with_version(
    db: Session,
    conversation_id: uuid.UUID,
    role: str,
    text: str,
    order_key: str,
    turn_index: int | None,
    created_at,
    edit_type: str,
    edit_reason: str,
    created_by: str,
    source_type: str,
    based_on_version_id: uuid.UUID | None,
) -> tuple[Message, MessageVersion]:
    clean_text = _validate_text(text)
    new_hash = content_hash(clean_text, role)
    message = Message(
        id=uuid.uuid4(),
        conversation_id=conversation_id,
        role=role,
        order_key=order_key,
        turn_index=turn_index,
        created_at=created_at,
        created_by=created_by,
        source_type=source_type,
        content_hash=new_hash,
    )
    db.add(message)
    db.flush()
    version = _create_version(
        db=db,
        message=message,
        text=clean_text,
        edit_type=edit_type,
        edit_reason=edit_reason,
        created_by=created_by,
        based_on_version_id=based_on_version_id,
    )
    return message, version


def _active_messages(db: Session, conversation_id: uuid.UUID) -> list[Message]:
    return (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .all()
    )


def _message_index(messages: list[Message], message_id: uuid.UUID | None) -> int:
    for index, message in enumerate(messages):
        if message.id == message_id:
            return index
    raise MessageEditError("Message not found in conversation.", HTTPStatus.NOT_FOUND)


def _renumber_conversation(db: Session, conversation_id: uuid.UUID) -> None:
    all_messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.order_key.asc(), Message.created_in_system_at.asc())
        .all()
    )
    for index, message in enumerate(all_messages):
        message.order_key = f"__tmp_{index:06d}_{message.id.hex[:8]}"
    db.flush()

    turn_index = 0
    active = [message for message in all_messages if not message.is_deleted]
    for index, message in enumerate(active, start=1):
        if message.role == "user":
            turn_index += 1
        message.order_key = f"{index:06d}"
        message.turn_index = turn_index if message.role in {"user", "assistant"} else None

    deleted = [message for message in all_messages if message.is_deleted]
    for index, message in enumerate(deleted, start=1):
        message.order_key = f"deleted-{index:06d}-{message.id.hex[:8]}"
    db.flush()


def _refresh_conversation_stats(db: Session, conversation_id: uuid.UUID) -> None:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        return
    messages = _active_messages(db, conversation_id)
    conversation.message_count = len(messages)
    conversation.turn_count = sum(1 for message in messages if message.role == "user")
    first_user = next((message for message in messages if message.role == "user"), None)
    first_version = _get_current_version(db, first_user) if first_user else None
    conversation.first_user_message = first_version.plain_text if first_version else None
    text_parts = []
    for message in messages:
        version = _get_current_version(db, message)
        text_parts.append(version.plain_text)
    conversation.content_hash = content_hash("\n".join(text_parts)) if text_parts else None
    conversation.updated_at = utc_now()
    conversation.sort_time = conversation.updated_at
    conversation.offline_revision += 1
    db.flush()


def refresh_conversation_stats(db: Session, conversation_id: uuid.UUID) -> None:
    _refresh_conversation_stats(db, conversation_id)


def _get_active_conversation(db: Session, conversation_id: uuid.UUID) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise MessageEditError("Conversation not found.", HTTPStatus.NOT_FOUND)
    return conversation


def _create_empty_conversation(
    db: Session,
    title: str,
    source_type: str,
    source_profile: str,
    status: str = "active",
) -> Conversation:
    conversation = Conversation(
        id=uuid.uuid4(),
        title=title,
        display_title=title,
        source_type=source_type,
        source_profile=source_profile,
        status=status,
        imported_at=utc_now(),
        parser_version=PARSER_VERSION,
        render_version=1,
        sort_time=utc_now(),
    )
    db.add(conversation)
    db.flush()
    return conversation


def create_manual_conversation(
    db: Session,
    *,
    title: str,
    user_text: str,
    assistant_text: str,
    project_id: uuid.UUID | None = None,
) -> ConversationCreateResult:
    title = title.strip() or "New conversation"
    now = utc_now()
    conversation = _create_empty_conversation(
        db,
        title=title,
        source_type="manual",
        source_profile="chat_reader_manual",
    )
    conversation.created_at = now
    conversation.updated_at = now
    conversation.sort_time = now
    if project_id is None:
        project_id = ensure_default_project(db).id
    add_conversation_to_project(db, project_id, conversation.id, added_by="user")
    messages: list[Message] = []
    for index, (role, text) in enumerate((("user", user_text), ("assistant", assistant_text)), start=1):
        message, _version = _create_message_with_version(
            db=db,
            conversation_id=conversation.id,
            role=role,
            text=text,
            order_key=_format_message_order_key(index * 1_000_000),
            turn_index=index,
            created_at=now,
            edit_type="manual_create",
            edit_reason="manual conversation creation",
            created_by="user",
            source_type="manual",
            based_on_version_id=None,
        )
        messages.append(message)
    _refresh_conversation_stats(db, conversation.id)
    return ConversationCreateResult(conversation=conversation, messages=messages)


def insert_manual_messages(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    anchor_message_id: uuid.UUID,
    position: str,
    mode: str,
    messages: list[tuple[str, str]],
    expected_offline_revision: int | None = None,
) -> MessageInsertResult:
    conversation = _get_active_conversation(db, conversation_id)
    if expected_offline_revision is not None and conversation.offline_revision != expected_offline_revision:
        raise MessageEditError("Conversation changed since it was loaded.", HTTPStatus.CONFLICT)
    if position not in {"before", "after"} or mode not in {"single", "pair"}:
        raise MessageEditError("Unsupported message insertion mode.", HTTPStatus.UNPROCESSABLE_ENTITY)
    if mode == "pair":
        if len(messages) != 2 or [role for role, _text in messages] != ["user", "assistant"]:
            raise MessageEditError("A message pair must contain user then assistant content.", HTTPStatus.UNPROCESSABLE_ENTITY)
    elif len(messages) != 1:
        raise MessageEditError("A single insertion must contain exactly one message.", HTTPStatus.UNPROCESSABLE_ENTITY)

    active = _active_messages(db, conversation_id)
    anchor_index = _message_index(active, anchor_message_id)
    anchor = active[anchor_index]
    if mode == "single" and not messages[0][0]:
        previous = anchor if position == "after" else (active[anchor_index - 1] if anchor_index > 0 else anchor)
        messages = [("assistant" if previous.role == "user" else "user", messages[0][1])]
    for role, text in messages:
        if role not in {"user", "assistant"}:
            raise MessageEditError("Only user and assistant messages can be inserted.", HTTPStatus.UNPROCESSABLE_ENTITY)
        _validate_text(text)

    _ensure_gapped_order_keys(db, active)
    active = _active_messages(db, conversation_id)
    anchor_index = _message_index(active, anchor_message_id)
    left = _order_value(active[anchor_index - 1].order_key) if position == "before" and anchor_index > 0 else (
        _order_value(active[anchor_index].order_key) if position == "after" else Decimal(0)
    )
    right = _order_value(active[anchor_index].order_key) if position == "before" else (
        _order_value(active[anchor_index + 1].order_key) if anchor_index + 1 < len(active) else None
    )
    if right is None:
        right = left + MESSAGE_ORDER_SCALE * (len(messages) + 1)
    step = (right - left) / Decimal(len(messages) + 1)
    if step < Decimal("0.000001"):
        _rebalance_active_order_keys(db, active)
        active = _active_messages(db, conversation_id)
        anchor_index = _message_index(active, anchor_message_id)
        return insert_manual_messages(
            db,
            conversation_id=conversation_id,
            anchor_message_id=anchor_message_id,
            position=position,
            mode=mode,
            messages=messages,
            expected_offline_revision=expected_offline_revision,
        )

    now = utc_now()
    created: list[Message] = []
    for index, (role, text) in enumerate(messages, start=1):
        order_value = left + (step * index)
        message, _version = _create_message_with_version(
            db=db,
            conversation_id=conversation_id,
            role=role,
            text=text,
            order_key=_format_message_order_key(order_value),
            turn_index=None,
            created_at=now,
            edit_type="manual_insert",
            edit_reason="manual message insertion",
            created_by="user",
            source_type="manual",
            based_on_version_id=None,
        )
        created.append(message)
    _refresh_turn_indexes(db, conversation_id)
    _refresh_conversation_stats(db, conversation_id)
    return MessageInsertResult(conversation=conversation, messages=created)


def soft_delete_message(
    db: Session,
    message_id: uuid.UUID,
    *,
    reason: str | None = None,
    expected_offline_revision: int | None = None,
) -> MessageDeleteResult:
    message = db.get(Message, message_id)
    if message is None or message.is_deleted:
        raise MessageEditError("Message not found.", HTTPStatus.NOT_FOUND)
    conversation = _get_active_conversation(db, message.conversation_id)
    if expected_offline_revision is not None and conversation.offline_revision != expected_offline_revision:
        raise MessageEditError("Conversation changed since it was loaded.", HTTPStatus.CONFLICT)
    original_order = message.order_key
    message.order_key = f"deleted-{original_order}-{message.id.hex[:8]}"
    message.is_deleted = True
    message.deleted_at = utc_now()
    message.deleted_by = "user"
    message.delete_reason = reason or "user deleted message"
    _refresh_turn_indexes(db, message.conversation_id)
    _refresh_conversation_stats(db, message.conversation_id)
    return MessageDeleteResult(message=message, was_deleted=True)


def restore_soft_deleted_message(
    db: Session,
    message_id: uuid.UUID,
    *,
    expected_offline_revision: int | None = None,
) -> MessageDeleteResult:
    message = db.get(Message, message_id)
    if message is None:
        raise MessageEditError("Message not found.", HTTPStatus.NOT_FOUND)
    conversation = _get_active_conversation(db, message.conversation_id)
    if expected_offline_revision is not None and conversation.offline_revision != expected_offline_revision:
        raise MessageEditError("Conversation changed since it was loaded.", HTTPStatus.CONFLICT)
    # Restore is intentionally idempotent so a double click or retry cannot
    # create a second message or reorder the conversation again.
    if not message.is_deleted:
        return MessageDeleteResult(message=message, was_deleted=False)
    original = message.order_key.removeprefix("deleted-").rsplit("-", 1)[0]
    active = _active_messages(db, message.conversation_id)
    try:
        desired = _order_value(original)
    except InvalidOperation:
        desired = None
    if desired is None or any(item.order_key == original for item in active):
        desired = (_order_value(active[-1].order_key) + MESSAGE_ORDER_SCALE) if active else MESSAGE_ORDER_SCALE
    message.order_key = _format_message_order_key(desired)
    message.is_deleted = False
    message.deleted_at = None
    message.deleted_by = None
    _refresh_turn_indexes(db, message.conversation_id)
    _refresh_conversation_stats(db, message.conversation_id)
    return MessageDeleteResult(message=message, was_deleted=False)


def _order_value(value: str) -> Decimal:
    return Decimal(value)


def _format_message_order_key(value: Decimal | int) -> str:
    return f"{Decimal(value):012.6f}"


def _ensure_gapped_order_keys(db: Session, active: list[Message]) -> None:
    if not active:
        return
    parsed: list[Decimal] = []
    try:
        parsed = [_order_value(message.order_key) for message in active]
    except InvalidOperation:
        parsed = []
    if not parsed or any(right - left < MESSAGE_ORDER_SCALE for left, right in zip(parsed, parsed[1:])):
        _rebalance_active_order_keys(db, active)


def _rebalance_active_order_keys(db: Session, active: list[Message]) -> None:
    for index, message in enumerate(active, start=1):
        message.order_key = f"__tmp_manual_{index:08d}_{message.id.hex[:8]}"
    db.flush()
    for index, message in enumerate(active, start=1):
        message.order_key = _format_message_order_key(index * 1_000_000)
    _refresh_turn_indexes(db, active[0].conversation_id if active else None)
    db.flush()


def _refresh_turn_indexes(db: Session, conversation_id: uuid.UUID | None) -> None:
    if conversation_id is None:
        return
    turn_index = 0
    for message in _active_messages(db, conversation_id):
        if message.role == "user":
            turn_index += 1
        message.turn_index = turn_index if message.role in {"user", "assistant"} else None


def _copy_messages_to_conversation(
    db: Session,
    target: Conversation,
    source_messages: list[Message],
    source_operation: str,
    progress_callback: MergeProgressCallback | None = None,
) -> int:
    source_versions = [_get_current_version(db, message) for message in source_messages]
    attachment_id_map = _clone_split_attachments(
        db,
        target=target,
        source_version_ids=[version.id for version in source_versions],
        source_operation=source_operation,
    )
    count = 0
    for index, (source_message, version) in enumerate(zip(source_messages, source_versions, strict=True), start=1):
        copied_message, copied_version = _create_message_with_version(
            db=db,
            conversation_id=target.id,
            role=source_message.role,
            text=_rewrite_split_attachment_text(version.display_text, attachment_id_map),
            order_key=f"{index:06d}",
            turn_index=source_message.turn_index,
            created_at=source_message.created_at,
            edit_type=source_operation,
            edit_reason=source_operation.replace("_", " "),
            created_by="user",
            source_type=source_operation,
            based_on_version_id=version.id,
        )
        _copy_split_attachment_occurrences(
            db,
            source_version_id=version.id,
            target_version_id=copied_version.id,
            attachment_id_map=attachment_id_map,
        )
        db.add(
            SourceMessageRef(
                id=uuid.uuid4(),
                message_id=copied_message.id,
                source_type=target.source_type,
                source_profile=target.source_profile,
                source_conversation_id=str(source_message.conversation_id),
                source_message_id=str(source_message.id),
                raw_metadata={
                    "source_operation": source_operation,
                    "source_order_key": source_message.order_key,
                    "source_version_id": str(version.id),
                },
            )
        )
        count += 1
        if progress_callback and (count == len(source_messages) or count % 5 == 0):
            progress = 10 + round(70 * count / max(len(source_messages), 1))
            _report_merge(progress_callback, "copying", progress, count, len(source_messages))
    _renumber_conversation(db, target.id)
    return count


def _clone_split_attachments(
    db: Session,
    *,
    target: Conversation,
    source_version_ids: list[uuid.UUID],
    source_operation: str,
) -> dict[uuid.UUID, uuid.UUID]:
    source_attachment_ids = [
        row[0]
        for row in db.query(MessageVersionAttachment.attachment_id)
        .filter(MessageVersionAttachment.message_version_id.in_(source_version_ids))
        .distinct()
        .all()
    ]
    if not source_attachment_ids:
        return {}
    attachments = (
        db.query(Attachment)
        .filter(Attachment.id.in_(source_attachment_ids), Attachment.deleted_at.is_(None))
        .order_by(Attachment.created_at, Attachment.id)
        .all()
    )
    if len(attachments) != len(source_attachment_ids):
        raise MessageEditError("One or more source attachments are unavailable.", 409)
    attachment_id_map: dict[uuid.UUID, uuid.UUID] = {}
    for source in attachments:
        target_id = uuid.uuid4()
        attachment_id_map[source.id] = target_id
        db.add(Attachment(
            id=target_id,
            conversation_id=target.id,
            asset_object_id=source.asset_object_id,
            import_id=source.import_id,
            original_filename=source.original_filename,
            display_name=source.display_name,
            declared_mime_type=source.declared_mime_type,
            detected_mime_type=source.detected_mime_type,
            status=source.status,
            scan_status=source.scan_status,
            source_type=source_operation,
            source_attachment_id=str(source.id),
            metadata_={**(source.metadata_ or {}), "copied_from_source_type": source.source_type},
            resolution_status=source.resolution_status,
            created_at=source.created_at,
        ))
    db.flush()
    return attachment_id_map


def _copy_split_attachment_occurrences(
    db: Session,
    *,
    source_version_id: uuid.UUID,
    target_version_id: uuid.UUID,
    attachment_id_map: dict[uuid.UUID, uuid.UUID],
) -> None:
    if not attachment_id_map:
        return
    source_rows = (
        db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id == source_version_id)
        .order_by(MessageVersionAttachment.display_order, MessageVersionAttachment.id)
        .all()
    )
    db.query(MessageVersionAttachment).filter(
        MessageVersionAttachment.message_version_id == target_version_id
    ).delete(synchronize_session=False)
    for row in source_rows:
        target_attachment_id = attachment_id_map.get(row.attachment_id)
        if target_attachment_id is None:
            raise MessageEditError("A source attachment occurrence cannot be mapped.", 409)
        db.add(MessageVersionAttachment(
            id=uuid.uuid4(),
            message_version_id=target_version_id,
            attachment_id=target_attachment_id,
            occurrence_key=row.occurrence_key,
            placement=row.placement,
            relation_type=row.relation_type,
            display_order=row.display_order,
            block_index=row.block_index,
            display_mode=row.display_mode,
            alt_text=row.alt_text,
            caption=row.caption,
        ))


def _rewrite_split_attachment_text(value: str, attachment_id_map: dict[uuid.UUID, uuid.UUID]) -> str:
    rewritten = value
    for source_id, target_id in attachment_id_map.items():
        rewritten = rewritten.replace(f"cr-asset://{source_id}", f"cr-asset://{target_id}")
    return rewritten


def _report_merge(
    callback: MergeProgressCallback | None,
    phase: str,
    progress: int,
    processed: int,
    total: int,
) -> None:
    if callback is not None:
        callback(phase, progress, processed, total)


def _attach_conversation_to_project(
    db: Session,
    conversation_id: uuid.UUID,
    project_id: uuid.UUID | None,
) -> None:
    if project_id is not None and db.get(Project, project_id) is None:
        raise MessageEditError("Project not found.", HTTPStatus.NOT_FOUND)
    target_project_id = project_id if project_id is not None else ensure_default_project(db).id
    add_conversation_to_project(db, target_project_id, conversation_id, added_by="system")


def _next_version_number(db: Session, message_id: uuid.UUID) -> int:
    current_max = (
        db.query(func.max(MessageVersion.version_number))
        .filter(MessageVersion.message_id == message_id)
        .scalar()
    )
    return int(current_max or 0) + 1


def _write_event(
    db: Session,
    message: Message,
    event_type: str,
    target_version_id: uuid.UUID,
    payload: dict,
    created_by: str,
) -> None:
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=message.conversation_id,
            event_type=event_type,
            target_message_id=message.id,
            target_version_id=target_version_id,
            payload=payload,
            created_by=created_by,
        )
    )
