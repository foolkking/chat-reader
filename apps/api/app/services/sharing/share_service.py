import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus

from sqlalchemy import func, select
from sqlalchemy.orm import Query, Session

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.render_block import RenderBlock
from app.models.share import Share
from app.schemas.conversation import ConversationListItem
from app.schemas.message import DialogueIndexItem, DialogueIndexResponse, MessageListItem, MessageVersionRead, RenderBlockRead
from app.schemas.search import MessageWindowResponse
from app.schemas.share import ShareCreate, ShareCreateResponse, ShareRead, ShareUpdate, SharedConversationBootstrap
from app.services.preferences import get_or_create_preferences
from app.schemas.toc import TocItem, TocResponse
from app.services.reader_preview import dialogue_preview


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
    share_url = f"{get_settings().public_web_base_url.rstrip('/')}/share/{token}"
    now = _utc_now()
    preferences = get_or_create_preferences(db)
    theme = payload.theme or (preferences.theme_mode if preferences.theme_mode in {"light", "dark"} else "light")
    locale = payload.locale or (preferences.locale_mode if preferences.locale_mode in {"zh-CN", "en-US"} else "zh-CN")
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
        theme=theme,
        locale=locale,
        expires_at=payload.expires_at,
        created_at=now,
        updated_at=now,
        created_by="local",
        metadata_={"share_url": share_url},
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
        share_url=share_url,
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


def get_shared_conversation_by_token(db: Session, token: str) -> SharedConversationBootstrap:
    share = _get_accessible_share(db, token)
    conversation = _get_conversation(db, share.conversation_id)
    share.access_count += 1
    share.last_accessed_at = _utc_now()
    share.updated_at = share.last_accessed_at
    db.flush()
    return SharedConversationBootstrap(
        share=share_read(share),
        conversation=_conversation_item(conversation),
        message_count=_share_message_query(db, share).count(),
        turn_count=conversation.turn_count,
        capabilities={
            "dialogue_index": True,
            "toc": share.include_toc,
            "blocks": True,
            "export": share.allow_export,
        },
    )


def get_shared_message_window(
    db: Session,
    token: str,
    *,
    offset: int,
    limit: int,
    anchor_message_id: uuid.UUID | None,
    anchor_before: int,
) -> MessageWindowResponse:
    share = _get_accessible_share(db, token)
    query = _share_message_query(db, share)
    total = query.count()
    if anchor_message_id is not None:
        anchor = query.filter(Message.id == anchor_message_id).one_or_none()
        if anchor is None:
            raise ShareError("Shared message not found.", HTTPStatus.NOT_FOUND)
        before_anchor = query.filter(Message.order_key < anchor.order_key).count()
        offset = max(0, min(max(total - limit, 0), before_anchor - anchor_before))
    messages = query.order_by(Message.order_key.asc()).offset(offset).limit(limit).all()
    return MessageWindowResponse(
        items=[_message_item(db, message, ordinal=offset + index + 1) for index, message in enumerate(messages)],
        limit=limit,
        offset=offset,
        total=total,
        has_previous=offset > 0,
        has_more=offset + len(messages) < total,
    )


def get_shared_dialogue_index(
    db: Session,
    token: str,
    *,
    offset: int,
    limit: int,
    anchor_message_id: uuid.UUID | None,
) -> DialogueIndexResponse:
    share = _get_accessible_share(db, token)
    conversation = _get_conversation(db, share.conversation_id)
    base_query = _share_message_query(db, share)
    total = base_query.count()
    if anchor_message_id is not None:
        anchor = base_query.filter(Message.id == anchor_message_id).one_or_none()
        if anchor is None:
            raise ShareError("Shared message not found.", HTTPStatus.NOT_FOUND)
        before_anchor = base_query.filter(Message.order_key < anchor.order_key).count()
        offset = max(0, min(max(total - limit, 0), before_anchor - limit // 2))
    allowed_ids = base_query.with_entities(Message.id).subquery()
    rows = (
        db.query(
            Message.id,
            Message.role,
            Message.order_key,
            Message.turn_index,
            func.substr(MessageVersion.display_text, 1, 8000).label("display_preview"),
        )
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .filter(Message.id.in_(select(allowed_ids.c.id)))
        .order_by(Message.order_key.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    role_counts: dict[str, int] = {}
    if rows and offset > 0:
        role_counts = {
            role: count
            for role, count in (
                base_query.with_entities(Message.role, func.count(Message.id))
                .filter(Message.order_key < rows[0].order_key)
                .group_by(Message.role)
                .all()
            )
        }
    items: list[DialogueIndexItem] = []
    for ordinal, row in enumerate(rows, start=offset + 1):
        role_counts[row.role] = role_counts.get(row.role, 0) + 1
        items.append(
            DialogueIndexItem(
                message_id=row.id,
                role=row.role,
                role_number=role_counts[row.role],
                ordinal=ordinal,
                order_key=row.order_key,
                turn_index=row.turn_index,
                preview=dialogue_preview(row.display_preview or ""),
            )
        )
    return DialogueIndexResponse(
        conversation_id=share.conversation_id,
        items=items,
        message_count=total,
        turn_count=conversation.turn_count,
        limit=limit,
        offset=offset,
        total=total,
        has_previous=offset > 0,
        has_more=offset + len(items) < total,
    )


def get_shared_toc(
    db: Session,
    token: str,
    *,
    message_id: uuid.UUID | None,
    offset: int,
    limit: int,
    max_level: int | None,
) -> TocResponse:
    share = _get_accessible_share(db, token)
    if not share.include_toc:
        return TocResponse(conversation_id=share.conversation_id, items=[], limit=limit, offset=0, total=0)
    query = db.query(Heading).filter(Heading.conversation_id == share.conversation_id)
    if share.scope == "selected_messages":
        query = query.filter(Heading.message_id.in_(_selected_message_ids(share)))
    if message_id is not None:
        _ensure_shared_message(db, share, message_id)
        query = query.filter(Heading.message_id == message_id)
    if max_level is not None:
        query = query.filter(Heading.level <= max_level)
    total = query.count()
    headings = query.order_by(Heading.heading_index.asc()).offset(offset).limit(limit).all()
    return TocResponse(
        conversation_id=share.conversation_id,
        items=[_toc_item(heading) for heading in headings],
        limit=limit,
        offset=offset,
        total=total,
        has_more=offset + len(headings) < total,
    )


def get_shared_message_blocks(
    db: Session,
    token: str,
    *,
    message_id: uuid.UUID,
    start: int,
    limit: int,
) -> list[RenderBlockRead]:
    share = _get_accessible_share(db, token)
    message = _ensure_shared_message(db, share, message_id)
    if message.current_version_id is None:
        return []
    blocks = (
        db.query(RenderBlock)
        .filter(
            RenderBlock.message_version_id == message.current_version_id,
            RenderBlock.block_index >= start,
        )
        .order_by(RenderBlock.block_index.asc())
        .limit(limit)
        .all()
    )
    return [_block_read(block) for block in blocks]


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


def update_share(db: Session, share_id: uuid.UUID, payload: ShareUpdate) -> Share:
    share = db.get(Share, share_id)
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    provided_fields = payload.model_fields_set
    if "expires_at" in provided_fields and payload.expires_at is not None and _as_utc(payload.expires_at) <= _utc_now():
        raise ShareError("Share expiry must be in the future.")
    if "title" in provided_fields:
        share.title = payload.title.strip() or None
    if "description" in provided_fields:
        share.description = payload.description.strip() or None
    if "expires_at" in provided_fields:
        share.expires_at = payload.expires_at
    if "theme" in provided_fields and payload.theme is not None:
        if payload.theme not in {"light", "dark"}:
            raise ShareError("Unsupported share theme.")
        share.theme = payload.theme
    if "locale" in provided_fields and payload.locale is not None:
        if payload.locale not in {"zh-CN", "en-US"}:
            raise ShareError("Unsupported share locale.")
        share.locale = payload.locale
    share.updated_at = _utc_now()
    _write_event(
        db,
        share.conversation_id,
        "share_updated",
        {
            "share_id": str(share.id),
            "expires_at": share.expires_at.isoformat() if share.expires_at else None,
        },
    )
    db.flush()
    return share


def share_read(share: Share) -> ShareRead:
    metadata = share.metadata_ or {}
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
        theme=share.theme,
        locale=share.locale,
        expires_at=share.expires_at,
        revoked_at=share.revoked_at,
        access_count=share.access_count,
        last_accessed_at=share.last_accessed_at,
        created_at=share.created_at,
        updated_at=share.updated_at,
        share_url=metadata.get("share_url") if isinstance(metadata.get("share_url"), str) else None,
    )


def share_create_response(result: ShareCreateResult) -> ShareCreateResponse:
    base = share_read(result.share).model_dump()
    base["share_url"] = result.share_url
    return ShareCreateResponse(**base, token=result.token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _get_accessible_share(db: Session, token: str) -> Share:
    share = db.query(Share).filter(Share.token_hash == hash_token(token)).one_or_none()
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    _assert_share_accessible(share)
    return share


def _selected_message_ids(share: Share) -> set[uuid.UUID]:
    return {uuid.UUID(str(message_id)) for message_id in share.selected_message_ids}


def _share_message_query(db: Session, share: Share) -> Query:
    query = db.query(Message).filter(
        Message.conversation_id == share.conversation_id,
        Message.is_deleted.is_(False),
    )
    if share.scope == "selected_messages":
        query = query.filter(Message.id.in_(_selected_message_ids(share)))
    return query


def _ensure_shared_message(db: Session, share: Share, message_id: uuid.UUID) -> Message:
    message = _share_message_query(db, share).filter(Message.id == message_id).one_or_none()
    if message is None:
        raise ShareError("Shared message not found.", HTTPStatus.NOT_FOUND)
    return message


def _validate_share_payload(db: Session, conversation: Conversation, payload: ShareCreate) -> None:
    if payload.scope not in {"conversation", "selected_messages"}:
        raise ShareError("Unsupported share scope.")
    if payload.expires_at is not None and _as_utc(payload.expires_at) <= _utc_now():
        raise ShareError("Share expiry must be in the future.")
    if payload.theme is not None and payload.theme not in {"light", "dark"}:
        raise ShareError("Unsupported share theme.")
    if payload.locale is not None and payload.locale not in {"zh-CN", "en-US"}:
        raise ShareError("Unsupported share locale.")
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


def _message_item(db: Session, message: Message, *, ordinal: int | None = None) -> MessageListItem:
    version = db.get(MessageVersion, message.current_version_id) if message.current_version_id else None
    content_truncated = bool(version is not None and message.is_heavy)
    preview = " ".join((version.display_text if version else "").split())[:500] if content_truncated else None
    return MessageListItem(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        order_key=message.order_key,
        turn_index=message.turn_index,
        created_at=message.created_at,
        current_version=_version_read(version, truncate=content_truncated, omit_blocks=True) if version else None,
        render_blocks=[],
        block_count=message.block_count,
        char_count=message.char_count,
        is_heavy=message.is_heavy,
        ordinal=ordinal,
        content_preview=preview,
        content_truncated=content_truncated,
    )


def _version_read(
    version: MessageVersion,
    *,
    truncate: bool = False,
    omit_blocks: bool = False,
) -> MessageVersionRead:
    return MessageVersionRead(
        id=version.id,
        version_number=version.version_number,
        plain_text=version.plain_text[:500] if truncate else version.plain_text,
        display_text=version.display_text[:500] if truncate else version.display_text,
        blocks=[] if truncate or omit_blocks else version.blocks,
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


def _toc_item(heading: Heading) -> TocItem:
    return TocItem(
        id=heading.id,
        heading_index=heading.heading_index,
        level=heading.level,
        text=heading.text,
        slug=heading.slug,
        message_id=heading.message_id,
        message_order_key=heading.order_key,
        block_index=heading.block_index,
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
