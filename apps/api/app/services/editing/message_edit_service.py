import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from http import HTTPStatus

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.import_record import utc_now
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.render_block import RenderBlock
from app.models.source_message_ref import SourceMessageRef
from app.services.canonical.block_builder import build_basic_render_blocks
from app.services.import_pipeline.canonical_draft import PARSER_VERSION
from app.services.import_pipeline.canonical_draft import content_hash
from app.services.projects.project_service import add_conversation_to_project, ensure_default_project
from app.services.search.search_indexer import (
    rebuild_search_and_toc_for_conversation,
    rebuild_search_documents_for_conversation,
)
from app.services.toc.toc_builder import rebuild_headings_for_conversation

MAX_EDIT_TEXT_LENGTH = 200_000
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


def edit_message(
    db: Session,
    message_id: uuid.UUID,
    new_text: str,
    edit_reason: str | None = None,
    base_version_id: uuid.UUID | None = None,
) -> MessageEditResult:
    message = _get_editable_message(db, message_id)
    current_version = _get_current_version(db, message)
    clean_text = _validate_text(new_text)

    if base_version_id is not None and current_version.id != base_version_id:
        raise MessageEditError("Base version does not match current version.", HTTPStatus.CONFLICT)
    if clean_text == current_version.display_text:
        raise MessageEditError("No changes to save.")

    new_version = _create_version(
        db=db,
        message=message,
        text=clean_text,
        edit_type="manual_edit",
        edit_reason=edit_reason or "manual edit",
        created_by="user",
        based_on_version_id=current_version.id,
    )
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
    rebuild_search_and_toc_for_conversation(db, message.conversation_id)
    db.flush()
    return MessageEditResult(
        message=message,
        previous_version_id=current_version.id,
        current_version=new_version,
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
    source_messages = [
        message
        for conversation in conversations
        for message in _active_messages(db, conversation.id)
    ]
    _report_merge(progress_callback, "creating", 10, 0, len(source_messages))
    copied_count = _copy_messages_to_conversation(
        db=db,
        target=new_conversation,
        source_messages=source_messages,
        source_operation="conversation_merge",
        progress_callback=progress_callback,
    )
    _refresh_conversation_stats(db, new_conversation.id)
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
    _report_merge(progress_callback, "headings", 80, copied_count, copied_count)
    rebuild_headings_for_conversation(db, new_conversation.id)
    _report_merge(progress_callback, "search", 88, copied_count, copied_count)
    rebuild_search_documents_for_conversation(db, new_conversation.id)
    _report_merge(progress_callback, "publishing", 98, copied_count, copied_count)
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


def _create_version(
    db: Session,
    message: Message,
    text: str,
    edit_type: str,
    edit_reason: str,
    created_by: str,
    based_on_version_id: uuid.UUID | None,
    plain_text: str | None = None,
) -> MessageVersion:
    next_version_number = _next_version_number(db, message.id)
    plain = plain_text if plain_text is not None else text
    block_drafts = build_basic_render_blocks(text)
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
    new_hash = content_hash(text)
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
    )
    db.add(version)
    db.flush()

    for index, block in enumerate(block_drafts):
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

    message.current_version_id = version.id
    message.content_hash = new_hash
    message.block_count = len(block_drafts)
    message.char_count = len(text)
    message.is_heavy = len(text) > 12000 or len(block_drafts) > 80
    db.flush()
    return version


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
    new_hash = content_hash(clean_text)
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
    db.flush()


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


def _copy_messages_to_conversation(
    db: Session,
    target: Conversation,
    source_messages: list[Message],
    source_operation: str,
    progress_callback: MergeProgressCallback | None = None,
) -> int:
    count = 0
    for index, source_message in enumerate(source_messages, start=1):
        version = _get_current_version(db, source_message)
        copied_message, _ = _create_message_with_version(
            db=db,
            conversation_id=target.id,
            role=source_message.role,
            text=version.display_text,
            order_key=f"{index:06d}",
            turn_index=source_message.turn_index,
            created_at=source_message.created_at,
            edit_type=source_operation,
            edit_reason=source_operation.replace("_", " "),
            created_by="user",
            source_type=source_operation,
            based_on_version_id=version.id,
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
    add_conversation_to_project(db, target_project_id, conversation_id, added_by="user")


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
