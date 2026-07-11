import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.schemas.editing import (
    MessageEditRequest,
    MessageEditResponse,
    MessageMergeRequest,
    MessageMergeResponse,
    MessageSplitRequest,
    MessageSplitResponse,
    MessageVersionHistoryItem,
    MessageVersionHistoryResponse,
    MessageVersionRestoreRequest,
)
from app.schemas.message import MessageDetail, MessageVersionRead, RenderBlockRead
from app.services.editing.message_edit_service import (
    MessageEditError,
    edit_message,
    list_message_versions,
    merge_messages,
    restore_message_version,
    split_message,
)

router = APIRouter(prefix="/api/messages", tags=["messages"])


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
    return MessageDetail(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        order_key=message.order_key,
        turn_index=message.turn_index,
        created_at=message.created_at,
        current_version=_version_read(version) if version else None,
        render_blocks=[],
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
    try:
        result = edit_message(
            db=db,
            message_id=message_id,
            new_text=payload.display_text,
            edit_reason=payload.edit_reason,
            base_version_id=payload.base_version_id,
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
            )
            for version in versions
        ],
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
    return MessageEditResponse(
        message_id=message.id,
        conversation_id=message.conversation_id,
        previous_version_id=previous_version_id,
        current_version_id=current_version_id,
        version_number=version_number,
        message=get_message(message.id, db),
        warnings=warnings,
    )


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
