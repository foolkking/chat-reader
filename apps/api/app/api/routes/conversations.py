import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.schemas.conversation import ConversationDetail, ConversationListItem
from app.schemas.message import MessageListItem, MessageVersionRead, RenderBlockRead
from app.schemas.project import ConversationPinUpdate
from app.models.import_record import utc_now

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.get("", response_model=list[ConversationListItem])
def list_conversations(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    source_type: str | None = None,
    source_profile: str | None = None,
    db: Session = Depends(get_db),
) -> list[ConversationListItem]:
    query = db.query(Conversation).filter(Conversation.deleted_at.is_(None))
    if source_type:
        query = query.filter(Conversation.source_type == source_type)
    if source_profile:
        query = query.filter(Conversation.source_profile == source_profile)
    conversations = (
        query.order_by(
            Conversation.is_global_pinned.desc(),
            Conversation.global_pinned_at.desc(),
            Conversation.sort_time.desc(),
            Conversation.imported_at.desc(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_conversation_item(conversation) for conversation in conversations]


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> ConversationDetail:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return ConversationDetail(
        **_conversation_item(conversation).model_dump(),
        external_source_id=conversation.external_source_id,
        parser_version=conversation.parser_version,
        render_version=conversation.render_version,
        content_hash=conversation.content_hash,
        sort_time=conversation.sort_time,
    )


@router.patch("/{conversation_id}/pin", response_model=ConversationDetail)
def set_conversation_pin(
    conversation_id: uuid.UUID,
    payload: ConversationPinUpdate,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    conversation.is_global_pinned = payload.is_pinned
    conversation.global_pinned_at = utc_now() if payload.is_pinned else None
    db.commit()
    return ConversationDetail(
        **_conversation_item(conversation).model_dump(),
        external_source_id=conversation.external_source_id,
        parser_version=conversation.parser_version,
        render_version=conversation.render_version,
        content_hash=conversation.content_hash,
        sort_time=conversation.sort_time,
    )


@router.get("/{conversation_id}/messages", response_model=list[MessageListItem])
def list_conversation_messages(
    conversation_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_blocks: bool = False,
    db: Session = Depends(get_db),
) -> list[MessageListItem]:
    if db.get(Conversation, conversation_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_message_item(message, include_blocks, db) for message in messages]


def _conversation_item(conversation: Conversation) -> ConversationListItem:
    return ConversationListItem(
        id=conversation.id,
        title=conversation.title,
        display_title=conversation.display_title,
        source_type=conversation.source_type,
        source_profile=conversation.source_profile,
        message_count=conversation.message_count,
        turn_count=conversation.turn_count,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        imported_at=conversation.imported_at,
        first_user_message=conversation.first_user_message,
        status=conversation.status,
        is_global_pinned=conversation.is_global_pinned,
        global_pinned_at=conversation.global_pinned_at,
    )


def _message_item(message: Message, include_blocks: bool, db: Session) -> MessageListItem:
    version = _current_version(message, db)
    blocks = _render_blocks(version.id, db) if include_blocks and version else []
    return MessageListItem(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        order_key=message.order_key,
        turn_index=message.turn_index,
        created_at=message.created_at,
        current_version=_version_read(version) if version else None,
        render_blocks=blocks,
    )


def _current_version(message: Message, db: Session) -> MessageVersion | None:
    if message.current_version_id is None:
        return None
    return db.get(MessageVersion, message.current_version_id)


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


def _render_blocks(version_id: uuid.UUID, db: Session) -> list[RenderBlockRead]:
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == version_id)
        .order_by(RenderBlock.block_index.asc())
        .all()
    )
    return [_block_read(block) for block in blocks]


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
