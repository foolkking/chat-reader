import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.share import Share
from app.schemas.conversation import ConversationListItem
from app.schemas.message import MessageListItem, MessageVersionRead, RenderBlockRead
from app.schemas.share import ShareCreate, ShareCreateResponse, ShareRead, SharedConversationResponse
from app.schemas.toc import TocItem


class ShareError(ValueError):
    def __init__(self, message: str, status_code: int = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class ShareCreateResult:
    share: Share
    token: str
    share_url: str


def create_share(db: Session, conversation_id: uuid.UUID, payload: ShareCreate) -> ShareCreateResult:
    conversation = _get_conversation(db, conversation_id)
    _validate_share_payload(db, conversation, payload)
    token = secrets.token_urlsafe(32)
    now = _utc_now()
    share = Share(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        token_hash=hash_token(token),
        token_prefix=token[:10],
        title=payload.title,
        description=payload.description,
        scope=payload.scope,
        selected_message_ids=[str(message_id) for message_id in payload.selected_message_ids],
        include_toc=payload.include_toc,
        include_metadata=payload.include_metadata,
        allow_export=payload.allow_export,
        expires_at=payload.expires_at,
        created_at=now,
        updated_at=now,
        created_by="local",
        metadata_={},
    )
    db.add(share)
    db.flush()
    _write_event(
        db,
        conversation.id,
        "share_created",
        {
            "share_id": str(share.id),
            "scope": share.scope,
            "selected_message_count": len(share.selected_message_ids),
        },
    )
    return ShareCreateResult(
        share=share,
        token=token,
        share_url=f"{get_settings().public_web_base_url.rstrip('/')}/share/{token}",
    )


def list_shares(
    db: Session,
    conversation_id: uuid.UUID | None = None,
    include_revoked: bool = False,
) -> list[Share]:
    query = db.query(Share)
    if conversation_id is not None:
        _get_conversation(db, conversation_id)
        query = query.filter(Share.conversation_id == conversation_id)
    if not include_revoked:
        query = query.filter(Share.revoked_at.is_(None))
    return query.order_by(Share.created_at.desc()).all()


def get_shared_conversation_by_token(db: Session, token: str) -> SharedConversationResponse:
    share = db.query(Share).filter(Share.token_hash == hash_token(token)).one_or_none()
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    _assert_share_accessible(share)
    conversation = _get_conversation(db, share.conversation_id)
    share.access_count += 1
    share.last_accessed_at = _utc_now()
    share.updated_at = share.last_accessed_at
    messages = _share_messages(db, share)
    toc = _share_toc(db, share) if share.include_toc else []
    db.flush()
    return SharedConversationResponse(
        share=share_read(share),
        conversation=_conversation_item(conversation),
        toc=toc,
        messages=messages,
    )


def revoke_share(db: Session, share_id: uuid.UUID) -> Share:
    share = db.get(Share, share_id)
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    if share.revoked_at is None:
        share.revoked_at = _utc_now()
        share.updated_at = share.revoked_at
        _write_event(
            db,
            share.conversation_id,
            "share_revoked",
            {
                "share_id": str(share.id),
                "scope": share.scope,
                "selected_message_count": len(share.selected_message_ids),
            },
        )
    db.flush()
    return share


def share_read(share: Share) -> ShareRead:
    return ShareRead(
        id=share.id,
        conversation_id=share.conversation_id,
        token_prefix=share.token_prefix,
        title=share.title,
        description=share.description,
        scope=share.scope,
        selected_message_ids=[uuid.UUID(str(message_id)) for message_id in share.selected_message_ids],
        include_toc=share.include_toc,
        include_metadata=share.include_metadata,
        allow_export=share.allow_export,
        expires_at=share.expires_at,
        revoked_at=share.revoked_at,
        access_count=share.access_count,
        last_accessed_at=share.last_accessed_at,
        created_at=share.created_at,
        updated_at=share.updated_at,
    )


def share_create_response(result: ShareCreateResult) -> ShareCreateResponse:
    base = share_read(result.share).model_dump()
    return ShareCreateResponse(**base, token=result.token, share_url=result.share_url)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _validate_share_payload(db: Session, conversation: Conversation, payload: ShareCreate) -> None:
    if payload.scope not in {"conversation", "selected_messages"}:
        raise ShareError("Unsupported share scope.")
    if payload.expires_at is not None and _as_utc(payload.expires_at) <= _utc_now():
        raise ShareError("Share expiry must be in the future.")
    if payload.scope == "selected_messages" and not payload.selected_message_ids:
        raise ShareError("selected_messages share requires at least one message.")
    if payload.selected_message_ids:
        valid_ids = {
            row[0]
            for row in db.query(Message.id)
            .filter(Message.conversation_id == conversation.id, Message.is_deleted.is_(False))
            .all()
        }
        if any(message_id not in valid_ids for message_id in payload.selected_message_ids):
            raise ShareError("Selected message ids must belong to the conversation.")


def _assert_share_accessible(share: Share) -> None:
    if share.revoked_at is not None:
        raise ShareError("Share has been revoked.", HTTPStatus.GONE)
    if share.expires_at is not None and _as_utc(share.expires_at) <= _utc_now():
        raise ShareError("Share has expired.", HTTPStatus.GONE)


def _get_conversation(db: Session, conversation_id: uuid.UUID) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ShareError("Conversation not found.", HTTPStatus.NOT_FOUND)
    return conversation


def _share_messages(db: Session, share: Share) -> list[MessageListItem]:
    query = db.query(Message).filter(Message.conversation_id == share.conversation_id, Message.is_deleted.is_(False))
    selected_ids = {uuid.UUID(str(message_id)) for message_id in share.selected_message_ids}
    if share.scope == "selected_messages":
        query = query.filter(Message.id.in_(selected_ids))
    messages = query.order_by(Message.order_key.asc()).all()
    return [_message_item(db, message) for message in messages]


def _share_toc(db: Session, share: Share) -> list[TocItem]:
    query = db.query(Heading).filter(Heading.conversation_id == share.conversation_id)
    selected_ids = {uuid.UUID(str(message_id)) for message_id in share.selected_message_ids}
    if share.scope == "selected_messages":
        query = query.filter(Heading.message_id.in_(selected_ids))
    headings = query.order_by(Heading.heading_index.asc()).all()
    return [
        TocItem(
            id=heading.id,
            heading_index=heading.heading_index,
            level=heading.level,
            text=heading.text,
            slug=heading.slug,
            message_id=heading.message_id,
            message_order_key=heading.order_key,
            block_index=heading.block_index,
        )
        for heading in headings
    ]


def _message_item(db: Session, message: Message) -> MessageListItem:
    version = db.get(MessageVersion, message.current_version_id) if message.current_version_id else None
    blocks = []
    if version is not None:
        blocks = (
            db.query(RenderBlock)
            .filter(RenderBlock.message_version_id == version.id)
            .order_by(RenderBlock.block_index.asc())
            .all()
        )
    return MessageListItem(
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


def _write_event(db: Session, conversation_id: uuid.UUID, event_type: str, payload: dict) -> None:
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            event_type=event_type,
            payload=payload,
            created_by="system",
        )
    )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
