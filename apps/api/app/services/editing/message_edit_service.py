import uuid
from dataclasses import dataclass, field
from http import HTTPStatus

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.conversation_event import ConversationEvent
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.services.canonical.block_builder import build_basic_render_blocks
from app.services.import_pipeline.canonical_draft import content_hash
from app.services.search.search_indexer import rebuild_search_and_toc_for_conversation

MAX_EDIT_TEXT_LENGTH = 200_000


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
    based_on_version_id: uuid.UUID,
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
