import re
import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.attachment import Attachment, MessageVersionAttachment
from app.schemas.editing import (
    MessageAttachmentOccurrenceInput,
    MessageEditRequest,
    MessageEditResponse,
    MessageMergeRequest,
    MessageMergeResponse,
    MessageSplitRequest,
    MessageSplitResponse,
    MessageTaskToggleRequest,
    MessageVersionHistoryItem,
    MessageVersionHistoryResponse,
    MessageVersionDeleteResponse,
    MessageVersionRestoreRequest,
    MessageVersionSelectRequest,
)
from app.schemas.attachment import MessageVersionAttachmentRead
from app.schemas.message import MessageDetail, MessageVersionRead, RenderBlockRead
from app.services.editing.message_edit_service import (
    MessageEditError,
    edit_message,
    delete_message_version,
    list_message_versions,
    merge_messages,
    restore_message_version,
    select_message_version,
    split_message,
)
from app.services.assets.attachment_service import attachment_read
from app.services.background_jobs import queue_conversation_derived_rebuild
from app.services.canonical.block_builder import extract_markdown_tasks

router = APIRouter(prefix="/api/messages", tags=["messages"])
UPLOAD_REFERENCE_RE = re.compile(r"cr-upload://(?P<id>[^\s)]+)")
ASSET_REFERENCE_RE = re.compile(r"cr-asset://(?P<id>[0-9a-fA-F-]{36})")
logger = logging.getLogger(__name__)


@router.post("/merge", response_model=MessageMergeResponse)
def merge_messages_endpoint(
    payload: MessageMergeRequest,
    db: Session = Depends(get_db),
) -> MessageMergeResponse:
    try:
        result = merge_messages(
            db=db,
            message_ids=payload.message_ids,
            separator=payload.separator,
            edit_reason=payload.edit_reason,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return MessageMergeResponse(
        conversation_id=result.survivor_message.conversation_id,
        survivor_message_id=result.survivor_message.id,
        merged_message_ids=result.merged_message_ids,
        current_version_id=result.current_version.id,
        version_number=result.current_version.version_number,
    )


@router.get("/{message_id}", response_model=MessageDetail)
def get_message(message_id: uuid.UUID, db: Session = Depends(get_db)) -> MessageDetail:
    message = db.get(Message, message_id)
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    version = db.get(MessageVersion, message.current_version_id) if message.current_version_id else None
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == message.current_version_id)
        .order_by(RenderBlock.block_index.asc())
        .all()
        if message.current_version_id
        else []
    )
    return MessageDetail(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        order_key=message.order_key,
        turn_index=message.turn_index,
        created_at=message.created_at,
        current_version=_version_read(version) if version else None,
        render_blocks=[_block_read(block) for block in blocks],
        block_count=message.block_count,
        char_count=message.char_count,
        is_heavy=message.is_heavy,
        source_refs=[
            {
                "source_type": ref.source_type,
                "source_profile": ref.source_profile,
                "source_conversation_id": ref.source_conversation_id,
                "source_node_id": ref.source_node_id,
                "source_message_id": ref.source_message_id,
                "source_json_index": ref.source_json_index,
                "source_markdown_index": ref.source_markdown_index,
                "is_primary_path": ref.is_primary_path,
                "raw_metadata": ref.raw_metadata,
            }
            for ref in message.source_refs
        ],
    )


@router.post("/{message_id}/split", response_model=MessageSplitResponse)
def split_message_endpoint(
    message_id: uuid.UUID,
    payload: MessageSplitRequest,
    db: Session = Depends(get_db),
) -> MessageSplitResponse:
    try:
        result = split_message(
            db=db,
            message_id=message_id,
            split_offset=payload.split_offset,
            edit_reason=payload.edit_reason,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return MessageSplitResponse(
        conversation_id=result.original_message.conversation_id,
        original_message_id=result.original_message.id,
        new_message_id=result.new_message.id,
        original_version_id=result.original_version.id,
        new_version_id=result.new_version.id,
    )


@router.patch("/{message_id}", response_model=MessageEditResponse)
def update_message(
    message_id: uuid.UUID,
    payload: MessageEditRequest,
    db: Session = Depends(get_db),
) -> MessageEditResponse:
    request_started = time.perf_counter()
    timings: dict[str, float] = {"request_parse_ms": 0.0}
    try:
        if payload.upload_item_ids:
            raise MessageEditError(
                "Attachment uploads must be finalized before saving the message.",
                409,
            )
        try:
            source_text = payload.text_value()
        except ValueError as exc:
            raise MessageEditError(str(exc), 422) from exc
        timings["request_parse_ms"] = round((time.perf_counter() - request_started) * 1000, 3)
        _upload_references(source_text)
        if "cr-upload://" in source_text:
            line_number = next(index for index, line in enumerate(source_text.splitlines(), 1) if "cr-upload://" in line)
            raise MessageEditError(f"Line {line_number} contains an unresolved attachment upload.", 422)
        if payload.attachment_occurrences:
            occurrence_keys = [item.occurrence_key for item in payload.attachment_occurrences]
            if len(set(occurrence_keys)) != len(occurrence_keys):
                raise MessageEditError("Attachment occurrence keys must be unique.", 422)
            declared = sorted(str(item.attachment_id) for item in payload.attachment_occurrences)
            referenced = sorted(match.group("id").lower() for match in ASSET_REFERENCE_RE.finditer(source_text))
            if declared != referenced:
                raise MessageEditError("Attachment occurrence declarations do not match the Markdown references.", 422)
        result = edit_message(
            db=db,
            message_id=message_id,
            new_text=source_text,
            edit_reason=payload.edit_reason,
            base_version_id=payload.base_version_id,
            save_mode=payload.save_mode,
            rebuild_derived=False,
            attachment_occurrences=payload.attachment_occurrences,
        )
        _apply_removed_attachment_actions(db, result.message, payload.removed_attachment_actions)
        timings.update(result.timings)
        commit_started = time.perf_counter()
        db.commit()
        timings["commit_ms"] = round((time.perf_counter() - commit_started) * 1000, 3)
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    response_started = time.perf_counter()
    message = db.get(Message, result.message.id)
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    response = _edit_response(
        message=message,
        previous_version_id=result.previous_version_id,
        current_version_id=result.current_version.id,
        version_number=result.current_version.version_number,
        warnings=result.warnings,
        db=db,
    )
    timings["response_serialize_ms"] = round((time.perf_counter() - response_started) * 1000, 3)
    queue_started = time.perf_counter()
    try:
        queue_conversation_derived_rebuild(
            db,
            conversation_id=message.conversation_id,
            idempotency_key=f"message-edit-derived:{message.conversation_id}:{result.current_version.id}",
            rebuild_versions=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Unable to queue post-commit derived rebuild for conversation %s", message.conversation_id)
    timings["derived_queue_ms"] = round((time.perf_counter() - queue_started) * 1000, 3)
    timings["total_ms"] = round((time.perf_counter() - request_started) * 1000, 3)
    for name in (
        "base_version_check_ms",
        "attachment_validation_ms",
        "markdown_parse_ms",
        "version_insert_ms",
        "occurrence_insert_ms",
        "render_block_ms",
        "commit_ms",
        "response_serialize_ms",
    ):
        timings.setdefault(name, 0.0)
    log = logger.warning if timings["total_ms"] > 1000 else logger.info
    log("message_save_timing message_id=%s conversation_id=%s timings=%s", message.id, message.conversation_id, timings)
    return response


@router.post("/{message_id}/tasks/{task_key}/toggle", response_model=MessageEditResponse)
def toggle_message_task(
    message_id: uuid.UUID,
    task_key: str,
    payload: MessageTaskToggleRequest,
    db: Session = Depends(get_db),
) -> MessageEditResponse:
    message = db.get(Message, message_id)
    if message is None or message.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    current_version = db.get(MessageVersion, message.current_version_id) if message.current_version_id else None
    if current_version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Current message version not found.")
    if current_version.id != payload.base_version_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Base version does not match current version.")
    task = next((item for item in extract_markdown_tasks(current_version.display_text) if item.task_key == task_key), None)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Markdown task was not found in the current version.")
    if task.checked == payload.checked:
        return _edit_response(
            message=message,
            previous_version_id=current_version.id,
            current_version_id=current_version.id,
            version_number=current_version.version_number,
            warnings=[],
            db=db,
        )
    marker = current_version.display_text[task.checked_offset: task.checked_offset + 1]
    if marker not in {" ", "x", "X"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Markdown task position is stale.")
    next_text = (
        current_version.display_text[:task.checked_offset]
        + ("x" if payload.checked else " ")
        + current_version.display_text[task.checked_offset + 1:]
    )
    occurrences = [
        MessageAttachmentOccurrenceInput(
            occurrence_key=link.occurrence_key,
            attachment_id=link.attachment_id,
            placement=link.placement,
            display_order=link.display_order,
            alt_text=link.alt_text,
        )
        for link in db.query(MessageVersionAttachment)
        .filter(MessageVersionAttachment.message_version_id == current_version.id)
        .order_by(MessageVersionAttachment.display_order.asc())
        .all()
    ]
    try:
        result = edit_message(
            db=db,
            message_id=message_id,
            new_text=next_text,
            edit_reason="task checklist toggled",
            base_version_id=current_version.id,
            save_mode="create_version" if current_version.version_number == 1 else "replace_current",
            rebuild_derived=False,
            attachment_occurrences=occurrences,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    refreshed_message = db.get(Message, result.message.id)
    if refreshed_message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    response = _edit_response(
        message=refreshed_message,
        previous_version_id=result.previous_version_id,
        current_version_id=result.current_version.id,
        version_number=result.current_version.version_number,
        warnings=result.warnings,
        db=db,
    )
    try:
        queue_conversation_derived_rebuild(
            db,
            conversation_id=message.conversation_id,
            idempotency_key=f"message-task-derived:{message.conversation_id}:{result.current_version.id}",
            rebuild_versions=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Unable to queue task-toggle derived rebuild for conversation %s", message.conversation_id)
    return response


@router.get("/{message_id}/versions", response_model=MessageVersionHistoryResponse)
def get_message_versions(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> MessageVersionHistoryResponse:
    try:
        message = db.get(Message, message_id)
        versions = list_message_versions(db, message_id)
    except MessageEditError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return MessageVersionHistoryResponse(
        message_id=message_id,
        current_version_id=message.current_version_id if message else None,
        items=[
            MessageVersionHistoryItem(
                id=version.id,
                version_number=version.version_number,
                plain_text=version.plain_text,
                display_text=version.display_text,
                edit_type=version.edit_type,
                edit_reason=version.edit_reason,
                created_at=version.created_at,
                created_by=version.created_by,
                based_on_version_id=version.based_on_version_id,
                content_hash=version.content_hash,
                is_current=message is not None and version.id == message.current_version_id,
                is_initial=version.version_number == 1,
                can_delete=version.version_number > 1,
            )
            for version in versions
        ],
    )


@router.put("/{message_id}/current-version", response_model=MessageEditResponse)
def select_message_version_endpoint(
    message_id: uuid.UUID,
    payload: MessageVersionSelectRequest,
    db: Session = Depends(get_db),
) -> MessageEditResponse:
    try:
        result = select_message_version(db, message_id, payload.version_id)
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    message = db.get(Message, result.message.id)
    assert message is not None
    return _edit_response(message, result.previous_version_id, result.current_version.id, result.current_version.version_number, result.warnings, db)


@router.delete("/{message_id}/versions/{version_id}", response_model=MessageVersionDeleteResponse)
def delete_message_version_endpoint(
    message_id: uuid.UUID,
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> MessageVersionDeleteResponse:
    try:
        result = delete_message_version(db, message_id, version_id)
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    message = db.get(Message, result.message.id)
    assert message is not None
    return MessageVersionDeleteResponse(
        message_id=message.id,
        deleted_version_id=result.deleted_version_id,
        current_version_id=result.current_version.id,
        message=get_message(message.id, db),
        warnings=result.warnings,
    )


@router.post("/{message_id}/versions/{version_id}/restore", response_model=MessageEditResponse)
def restore_message_version_endpoint(
    message_id: uuid.UUID,
    version_id: uuid.UUID,
    payload: MessageVersionRestoreRequest | None = None,
    db: Session = Depends(get_db),
) -> MessageEditResponse:
    try:
        result = restore_message_version(
            db=db,
            message_id=message_id,
            version_id=version_id,
            edit_reason=payload.edit_reason if payload else None,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    message = db.get(Message, result.message.id)
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    return _edit_response(
        message=message,
        previous_version_id=result.previous_version_id,
        current_version_id=result.current_version.id,
        version_number=result.current_version.version_number,
        warnings=result.warnings,
        db=db,
    )


@router.get("/{message_id}/blocks", response_model=list[RenderBlockRead])
def get_message_blocks(
    message_id: uuid.UUID,
    start: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list[RenderBlockRead]:
    message = db.get(Message, message_id)
    if message is None or message.current_version_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == message.current_version_id)
        .order_by(RenderBlock.block_index.asc())
        .offset(start)
        .limit(limit)
        .all()
    )
    return [_block_read(block) for block in blocks]


def _edit_response(
    message: Message,
    previous_version_id: uuid.UUID | None,
    current_version_id: uuid.UUID,
    version_number: int,
    warnings: list[str],
    db: Session,
) -> MessageEditResponse:
    current_version = db.get(MessageVersion, current_version_id)
    if current_version is None:
        raise HTTPException(status_code=404, detail="Message version not found.")
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == current_version_id)
        .order_by(RenderBlock.block_index.asc())
        .all()
    )
    links = (
        db.query(MessageVersionAttachment, Attachment)
        .join(Attachment, Attachment.id == MessageVersionAttachment.attachment_id)
        .filter(MessageVersionAttachment.message_version_id == current_version_id)
        .order_by(MessageVersionAttachment.display_order.asc())
        .all()
    )
    attachment_occurrences = [
        MessageVersionAttachmentRead(
            id=link.id,
            message_version_id=link.message_version_id,
            attachment=attachment_read(attachment),
            occurrence_key=link.occurrence_key,
            placement=link.placement,
            relation_type=link.relation_type,
            display_order=link.display_order,
            block_index=link.block_index,
            display_mode=link.display_mode,
            alt_text=link.alt_text,
            caption=link.caption,
        )
        for link, attachment in links
    ]
    attachment_summary = _conversation_attachment_summary(db, message.conversation_id)
    return MessageEditResponse(
        message_id=message.id,
        conversation_id=message.conversation_id,
        previous_version_id=previous_version_id,
        current_version_id=current_version_id,
        version_number=version_number,
        message=get_message(message.id, db),
        message_version=_version_read(current_version),
        render_blocks=[_block_read(block) for block in blocks],
        attachment_occurrences=attachment_occurrences,
        conversation_attachment_summary=attachment_summary,
        warnings=warnings,
    )


def _conversation_attachment_summary(db: Session, conversation_id: uuid.UUID) -> dict:
    rows = (
        db.query(Attachment.status, Attachment.resolution_status)
        .filter(Attachment.conversation_id == conversation_id, Attachment.deleted_at.is_(None))
        .all()
    )
    active = [row for row in rows if row[0] != "detached"]
    return {
        "total": len(active),
        "used": db.query(MessageVersionAttachment.attachment_id)
        .join(MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id)
        .join(Message, Message.id == MessageVersion.message_id)
        .join(Attachment, Attachment.id == MessageVersionAttachment.attachment_id)
        .filter(
            Message.conversation_id == conversation_id,
            Message.current_version_id == MessageVersionAttachment.message_version_id,
            Attachment.deleted_at.is_(None),
            Attachment.status != "detached",
        )
        .distinct()
        .count(),
        "missing": sum(1 for row in active if row[1] == "missing"),
    }


def _apply_removed_attachment_actions(db: Session, message: Message, actions) -> None:
    detach_ids = {item.attachment_id for item in actions if item.action == "detach_from_conversation"}
    if not detach_ids:
        return
    attachments = (
        db.query(Attachment)
        .filter(
            Attachment.id.in_(detach_ids),
            Attachment.conversation_id == message.conversation_id,
            Attachment.deleted_at.is_(None),
        )
        .all()
    )
    if {item.id for item in attachments} != detach_ids:
        raise MessageEditError("A detached attachment does not belong to this conversation.", 422)
    referenced = {
        row[0]
        for row in db.query(MessageVersionAttachment.attachment_id)
        .join(MessageVersion, MessageVersion.id == MessageVersionAttachment.message_version_id)
        .join(Message, Message.id == MessageVersion.message_id)
        .filter(
            MessageVersionAttachment.attachment_id.in_(detach_ids),
            Message.current_version_id == MessageVersionAttachment.message_version_id,
            Message.is_deleted.is_(False),
        )
        .all()
    }
    if referenced:
        raise MessageEditError("An attachment cannot be detached while a current message version still uses it.", 409)
    for attachment in attachments:
        attachment.status = "detached"


def _upload_references(text: str) -> list[tuple[int, uuid.UUID]]:
    references: list[tuple[int, uuid.UUID]] = []
    for line_number, line in enumerate(text.splitlines(), 1):
        for match in UPLOAD_REFERENCE_RE.finditer(line):
            try:
                item_id = uuid.UUID(match.group("id"))
            except ValueError as exc:
                raise MessageEditError(
                    f"Line {line_number} contains an invalid attachment upload reference.",
                    422,
                ) from exc
            references.append((line_number, item_id))
    return references


def _version_read(version: MessageVersion) -> MessageVersionRead:
    return MessageVersionRead(
        id=version.id,
        version_number=version.version_number,
        plain_text=version.plain_text,
        display_text=version.display_text,
        blocks=version.blocks,
        edit_type=version.edit_type,
        created_at=version.created_at,
        created_by=version.created_by,
        content_hash=version.content_hash,
    )


def _block_read(block: RenderBlock) -> RenderBlockRead:
    return RenderBlockRead(
        id=block.id,
        block_index=block.block_index,
        block_type=block.block_type,
        plain_text=block.plain_text,
        data=block.data,
        char_count=block.char_count,
        collapsed_by_default=block.collapsed_by_default,
        render_priority=block.render_priority,
    )
