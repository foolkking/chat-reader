import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.schemas.message import MessageDetail, MessageVersionRead, RenderBlockRead

router = APIRouter(prefix="/api/messages", tags=["messages"])


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
