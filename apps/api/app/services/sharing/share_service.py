import hashlib
import hmac
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http import HTTPStatus

from sqlalchemy import LargeBinary, Text, cast, func, or_, select
from sqlalchemy.orm import Query, Session

from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.heading import Heading
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.attachment import MessageVersionAttachment
from app.models.render_block import RenderBlock
from app.models.share import Share, ShareUnlockSession
from app.models.share_snapshot import ShareSnapshot
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.schemas.conversation import ConversationListItem
from app.schemas.message import DialogueIndexItem, DialogueIndexResponse, MessageListItem, MessageVersionRead, ReaderTurnResponse, RenderBlockRead
from app.schemas.search import MessageWindowResponse
from app.schemas.share import (
    OwnedSharePage,
    OwnedShareRead,
    ShareCreate,
    ShareCreateResponse,
    SharePreviewResponse,
    ShareRead,
    ShareUpdate,
    SharedConversationBootstrap,
)
from app.services.auth import hash_password, verify_password
from app.services.preferences import get_or_create_preferences
from app.schemas.toc import TocItem, TocResponse
from app.services.reader_preview import dialogue_preview
from app.services.reader_turns import ReaderTurnHydrationError, load_reader_turn_from_query
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, OwnershipScope, get_owned
from app.services.feature_policies import get_feature_policy


class ShareError(ValueError):
    def __init__(self, message: str, status_code: int = HTTPStatus.BAD_REQUEST, *, code: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


SHARE_UNLOCK_COOKIE_NAME = "chat_reader_share_unlock"
SHARE_UNLOCK_BACKOFF_AFTER = 3
SHARE_UNLOCK_BACKOFF_MAX_SECONDS = 60


@dataclass(frozen=True)
class ShareCreateResult:
    share: Share
    token: str
    share_url: str


def create_share(
    db: Session,
    conversation_id: uuid.UUID,
    payload: ShareCreate,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ShareCreateResult:
    policy = get_feature_policy(db)
    if not policy.allow_share_links:
        raise ShareError("Share links are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
    if payload.share_password and not policy.allow_share_password:
        raise ShareError("Password-protected shares are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
    if not payload.share_password and not policy.allow_public_share:
        raise ShareError("Public shares are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
    conversation = get_owned(db, Conversation, conversation_id, ownership_scope)
    if conversation is None:
        raise ShareError("Conversation not found.", HTTPStatus.NOT_FOUND)
    _validate_share_payload(db, conversation, payload)
    token = secrets.token_urlsafe(32)
    share_url = f"{get_settings().public_web_base_url.rstrip('/')}/share/{token}"
    now = _utc_now()
    preferences = get_or_create_preferences(
        db,
        subject_key=(str(ownership_scope.owner_user_id) if ownership_scope.owner_user_id else "local:default"),
    )
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
        include_description=payload.include_description,
        include_annotations=payload.include_annotations,
        include_notebook=payload.include_notebook,
        allow_export=payload.allow_export,
        content_mode=payload.content_mode,
        theme=theme,
        locale=locale,
        expires_at=payload.expires_at,
        password_hash=hash_password(payload.share_password) if payload.share_password else None,
        created_at=now,
        updated_at=now,
        created_by="local",
        metadata_={"share_url": share_url},
    )
    db.add(share)
    db.flush()
    _build_frozen_snapshot(db, share, conversation)
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


def preview_share(
    db: Session,
    conversation_id: uuid.UUID,
    payload: ShareCreate,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
    *,
    anchor_message_id: uuid.UUID | None = None,
) -> SharePreviewResponse:
    """Render a bounded owner preview without creating a token or Share row."""
    conversation = get_owned(db, Conversation, conversation_id, ownership_scope)
    if conversation is None:
        raise ShareError("Conversation not found.", HTTPStatus.NOT_FOUND)
    _validate_share_payload(db, conversation, payload)
    policy = get_feature_policy(db)
    if not policy.allow_share_links:
        raise ShareError("Share links are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
    if payload.share_password and not policy.allow_share_password:
        raise ShareError("Password-protected shares are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
    if not payload.share_password and not policy.allow_public_share:
        raise ShareError("Public shares are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
    preview = Share(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        token_prefix="preview",
        title=payload.title,
        description=payload.description,
        scope=payload.scope,
        selected_message_ids=[str(item) for item in payload.selected_message_ids],
        include_toc=payload.include_toc,
        include_metadata=payload.include_metadata,
        include_description=payload.include_description,
        include_annotations=payload.include_annotations,
        include_notebook=payload.include_notebook,
        allow_export=payload.allow_export,
        content_mode=payload.content_mode,
        theme=payload.theme or "light",
        locale=payload.locale or "zh-CN",
        metadata_={},
    )
    query = _share_message_query(db, preview)
    if preview.content_mode == "frozen":
        _validate_frozen_content(db, preview, query)
    total = query.count()
    first_message = (
        query.filter(Message.id == anchor_message_id).one_or_none()
        if anchor_message_id is not None
        else query.order_by(Message.order_key.asc()).first()
    )
    if anchor_message_id is not None and first_message is None:
        raise ShareError("Preview message is outside the selected share scope.", HTTPStatus.NOT_FOUND)
    sampled_turn = None
    if first_message is not None:
        try:
            sampled_turn = load_reader_turn_from_query(
                db,
                conversation.id,
                query,
                first_message.id,
                attachment_content_prefix="/api/attachments",
            )
        except (ReaderTurnHydrationError, ValueError) as exc:
            raise ShareError("The visitor preview is temporarily unavailable.", HTTPStatus.CONFLICT) from exc
    toc_response = None
    if payload.include_toc:
        toc_query = db.query(Heading).filter(Heading.conversation_id == conversation.id)
        if payload.scope == "selected_messages":
            toc_query = toc_query.filter(Heading.message_id.in_(set(payload.selected_message_ids)))
        headings = toc_query.order_by(Heading.heading_index.asc()).limit(200).all()
        toc_response = TocResponse(
            conversation_id=conversation.id,
            items=[_toc_item(item) for item in headings],
            limit=200,
            offset=0,
            total=toc_query.count(),
            has_more=toc_query.count() > len(headings),
        )
    return SharePreviewResponse(
        conversation=_conversation_item(conversation),
        message_count=total,
        turn_count=_query_share_turn_count(query),
        sampled_turn=sampled_turn,
        has_previous_turn=bool(sampled_turn and sampled_turn.previous_anchor_message_id),
        has_next_turn=bool(sampled_turn and sampled_turn.next_anchor_message_id),
        toc=toc_response,
        has_more_messages=total > (sampled_turn.end_offset if sampled_turn else 0),
        capabilities={
            "dialogue_index": True,
            "toc": payload.include_toc,
            "blocks": True,
            "export": payload.allow_export,
            "annotations": payload.include_annotations,
            "notebook": payload.include_notebook,
        },
        description_markdown=conversation.description_markdown if payload.include_description else None,
    )


def _query_share_turn_count(query: Query) -> int:
    rows = list(query.with_entities(Message.role, Message.turn_index).order_by(Message.order_key.asc()).yield_per(1000))
    if not rows:
        return 0
    user_roles = {"user", "prompt", "human"}
    if any((role or "").lower() in user_roles for role, _turn_index in rows):
        return 1 + sum(1 for role, _turn_index in rows[1:] if (role or "").lower() in user_roles)
    if any(turn_index is not None for _role, turn_index in rows):
        count = 1
        last_key = rows[0][1]
        for index, (_role, turn_index) in enumerate(rows[1:], start=1):
            key = turn_index if turn_index is not None else ("synthetic", index)
            if key != last_key:
                count += 1
            last_key = key
        return count
    return len(rows)


def list_shares(
    db: Session,
    conversation_id: uuid.UUID | None = None,
    include_revoked: bool = False,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> list[Share]:
    query = db.query(Share).join(Conversation, Conversation.id == Share.conversation_id).filter(
        ownership_scope.predicate(Conversation)
    )
    if conversation_id is not None:
        if get_owned(db, Conversation, conversation_id, ownership_scope) is None:
            raise ShareError("Conversation not found.", HTTPStatus.NOT_FOUND)
        query = query.filter(Share.conversation_id == conversation_id)
    if not include_revoked:
        query = query.filter(Share.revoked_at.is_(None))
    return query.order_by(Share.created_at.desc()).all()


def list_owned_shares(
    db: Session, ownership_scope: OwnershipScope, *, status: str = "all",
    conversation_id: uuid.UUID | None = None, query: str = "", offset: int = 0, limit: int = 20,
) -> OwnedSharePage:
    now = _utc_now()
    rows = db.query(Share, Conversation).join(Conversation, Conversation.id == Share.conversation_id).filter(
        ownership_scope.predicate(Conversation)
    )
    if conversation_id is not None:
        rows = rows.filter(Share.conversation_id == conversation_id)
    if query.strip():
        # contains(..., autoescape=True) treats percent/underscore as literal user text.
        needle = query.strip().lower()
        rows = rows.filter(or_(
            func.lower(Conversation.display_title).contains(needle, autoescape=True),
            func.lower(Share.title).contains(needle, autoescape=True),
        ))
    if status == "revoked":
        rows = rows.filter(Share.revoked_at.is_not(None))
    elif status == "expired":
        rows = rows.filter(Share.revoked_at.is_(None), Share.expires_at <= now)
    elif status == "active":
        rows = rows.filter(Share.revoked_at.is_(None), or_(Share.expires_at.is_(None), Share.expires_at > now))
    total = rows.count()
    page = rows.order_by(Share.created_at.desc(), Share.id.desc()).offset(offset).limit(limit).all()
    items = [OwnedShareRead(
        **share_read(share).model_dump(), conversation_title=conversation.display_title,
        conversation_deleted=conversation.deleted_at is not None,
        status="revoked" if share.revoked_at is not None else (
            "expired" if share.expires_at and _as_utc(share.expires_at) <= now else "active"
        ),
    ) for share, conversation in page]
    return OwnedSharePage(items=items, total=total, offset=offset, limit=limit, has_more=offset + len(items) < total)


def get_shared_conversation_by_token(db: Session, token: str, unlock_token: str | None = None) -> SharedConversationBootstrap:
    share = _get_accessible_share(db, token, unlock_token)
    conversation = _get_conversation(db, share.conversation_id)
    snapshot = _snapshot_for_share(db, share)
    share.access_count += 1
    share.last_accessed_at = _utc_now()
    share.updated_at = share.last_accessed_at
    db.flush()
    conversation_item = ConversationListItem.model_validate(snapshot.conversation) if snapshot else _conversation_item(conversation)
    return SharedConversationBootstrap(
        share=share_read(share),
        conversation=conversation_item,
        message_count=snapshot.message_count if snapshot else _share_message_query(db, share).count(),
        turn_count=snapshot.turn_count if snapshot else conversation.turn_count,
        capabilities={
            "dialogue_index": True,
            "toc": share.include_toc,
            "blocks": True,
            "export": share.allow_export,
            "annotations": share.include_annotations,
            "notebook": share.include_notebook,
        },
        description_markdown=(
            snapshot.description_markdown if snapshot else conversation.description_markdown
        ) if share.include_description else None,
    )


def get_shared_message_window(
    db: Session,
    token: str,
    *,
    offset: int,
    limit: int,
    anchor_message_id: uuid.UUID | None,
    anchor_before: int,
    unlock_token: str | None = None,
) -> MessageWindowResponse:
    share = _get_accessible_share(db, token, unlock_token)
    snapshot = _snapshot_for_share(db, share)
    if snapshot is not None:
        return _frozen_message_window(
            snapshot,
            offset=offset,
            limit=limit,
            anchor_message_id=anchor_message_id,
            anchor_before=anchor_before,
        )
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


def get_shared_reader_turn(db: Session, token: str, *, anchor_message_id: uuid.UUID | None, unlock_token: str | None = None) -> ReaderTurnResponse:
    share = _get_accessible_share(db, token, unlock_token)
    snapshot = _snapshot_for_share(db, share)
    if snapshot is not None:
        return _frozen_reader_turn(snapshot, anchor_message_id)
    try:
        return load_reader_turn_from_query(
            db,
            share.conversation_id,
            _share_message_query(db, share),
            anchor_message_id,
            attachment_content_prefix=f"/api/shared/{token}/attachments",
        )
    except ReaderTurnHydrationError as exc:
        raise ShareError(str(exc), HTTPStatus.CONFLICT) from exc
    except ValueError as exc:
        raise ShareError(str(exc), HTTPStatus.NOT_FOUND) from exc


def get_shared_dialogue_index(
    db: Session,
    token: str,
    *,
    offset: int,
    limit: int,
    anchor_message_id: uuid.UUID | None,
    unlock_token: str | None = None,
) -> DialogueIndexResponse:
    share = _get_accessible_share(db, token, unlock_token)
    snapshot = _snapshot_for_share(db, share)
    if snapshot is not None:
        return _frozen_dialogue_index(
            snapshot,
            offset=offset,
            limit=limit,
            anchor_message_id=anchor_message_id,
        )
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
                preview=dialogue_preview(row.display_preview or "", row.role),
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
    unlock_token: str | None = None,
) -> TocResponse:
    share = _get_accessible_share(db, token, unlock_token)
    snapshot = _snapshot_for_share(db, share)
    if snapshot is not None:
        return _frozen_toc(
            snapshot,
            message_id=message_id,
            offset=offset,
            limit=limit,
            max_level=max_level,
            conversation_id=share.conversation_id,
        )
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
    unlock_token: str | None = None,
) -> list[RenderBlockRead]:
    share = _get_accessible_share(db, token, unlock_token)
    snapshot = _snapshot_for_share(db, share)
    if snapshot is not None:
        return _frozen_blocks(snapshot, message_id=message_id, start=start, limit=limit)
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


def get_shared_annotations(db: Session, token: str, unlock_token: str | None = None):
    share = _get_accessible_share(db, token, unlock_token)
    if not share.include_annotations:
        return []
    conversation = db.get(Conversation, share.conversation_id)
    subject_key = str(conversation.owner_user_id) if conversation and conversation.owner_user_id else "local:default"
    query = db.query(ConversationAnnotation).filter(
        ConversationAnnotation.conversation_id == share.conversation_id,
        ConversationAnnotation.subject_key == subject_key,
        ConversationAnnotation.is_deleted.is_(False),
    )
    if share.scope == "selected_messages":
        query = query.filter(ConversationAnnotation.message_id.in_(_selected_message_ids(share)))
    return query.order_by(ConversationAnnotation.created_at.asc()).all()


def get_shared_notebook(db: Session, token: str, unlock_token: str | None = None):
    share = _get_accessible_share(db, token, unlock_token)
    if not share.include_notebook:
        return None
    conversation = db.get(Conversation, share.conversation_id)
    subject_key = str(conversation.owner_user_id) if conversation and conversation.owner_user_id else "local:default"
    return db.query(ConversationNotebook).filter(
        ConversationNotebook.conversation_id == share.conversation_id,
        ConversationNotebook.subject_key == subject_key,
        ConversationNotebook.is_conflict.is_(False),
    ).order_by(ConversationNotebook.created_at.asc()).first()


def revoke_share(
    db: Session,
    share_id: uuid.UUID,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> Share:
    share = (
        db.query(Share)
        .join(Conversation, Conversation.id == Share.conversation_id)
        .filter(Share.id == share_id, ownership_scope.predicate(Conversation))
        .with_for_update(of=Share)
        .first()
    )
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    if share.revoked_at is None:
        share.revoked_at = _utc_now()
        share.updated_at = share.revoked_at
        db.query(ShareSnapshot).filter(ShareSnapshot.share_id == share.id).delete(synchronize_session=False)
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


def get_owned_share(db: Session, share_id: uuid.UUID, ownership_scope: OwnershipScope) -> Share:
    share = db.query(Share).join(Conversation, Conversation.id == Share.conversation_id).filter(
        Share.id == share_id, ownership_scope.predicate(Conversation)
    ).populate_existing().first()
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    return share


def share_settings_revision(share: Share) -> str:
    # Visitor counters/timestamps are deliberately excluded. Passwords and
    # password hashes never leave the server; its version fences password edits.
    values = {name: getattr(share, name) for name in (
        "title", "description", "scope", "selected_message_ids", "include_toc",
        "include_metadata", "include_description", "include_annotations", "include_notebook",
        "allow_export", "theme", "locale", "password_version", "content_mode",
    )}
    values.update(id=str(share.id), password_required=share.password_hash is not None,
                  expires_at=_as_utc(share.expires_at).isoformat() if share.expires_at else None,
                  revoked_at=_as_utc(share.revoked_at).isoformat() if share.revoked_at else None)
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def update_share(
    db: Session,
    share_id: uuid.UUID,
    payload: ShareUpdate,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> Share:
    policy = get_feature_policy(db)
    if not policy.allow_share_links:
        raise ShareError("Share links are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
    share = (
        db.query(Share)
        .join(Conversation, Conversation.id == Share.conversation_id)
        .filter(Share.id == share_id, ownership_scope.predicate(Conversation))
        .populate_existing()
        .with_for_update(of=Share)
        .first()
    )
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    provided_fields = payload.model_fields_set
    if share.revoked_at is not None:
        raise ShareError("Share has been revoked.", HTTPStatus.GONE)
    if payload.base_revision is not None and not hmac.compare_digest(payload.base_revision, share_settings_revision(share)):
        raise ShareError("Share settings changed. Review the latest settings before saving.", HTTPStatus.CONFLICT, code="SHARE_SETTINGS_CHANGED")
    if share.content_mode == "frozen" and db.get(ShareSnapshot, share.id) is None:
        raise ShareError("Frozen content has been reclaimed. Create a new share.", HTTPStatus.CONFLICT, code="FROZEN_SHARE_RECLAIMED")
    if share.content_mode == "frozen" and (
        {"scope", "selected_message_ids"} & provided_fields
        or any(
            field in provided_fields
            for field in (
                "include_toc",
                "include_metadata",
                "include_description",
                "include_annotations",
                "include_notebook",
                "allow_export",
            )
        )
    ):
        raise ShareError(
            "Frozen share content cannot be changed. Create a new share for a different snapshot.",
            HTTPStatus.CONFLICT,
        )
    if "expires_at" in provided_fields and payload.expires_at is not None and _as_utc(payload.expires_at) <= _utc_now():
        raise ShareError("Share expiry must be in the future.")
    if "title" in provided_fields:
        share.title = (payload.title or "").strip() or None
    if "description" in provided_fields:
        share.description = (payload.description or "").strip() or None
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
    if {"scope", "selected_message_ids"} & provided_fields:
        scope = payload.scope or share.scope
        ids = payload.selected_message_ids if payload.selected_message_ids is not None else [uuid.UUID(item) for item in share.selected_message_ids]
        if scope == "conversation":
            ids = []
        _validate_share_payload(db, share.conversation, ShareCreate(scope=scope, selected_message_ids=ids))
        share.scope = scope
        share.selected_message_ids = [str(item) for item in dict.fromkeys(ids)]
    for field in ("include_toc", "include_metadata", "include_description", "include_annotations", "include_notebook", "allow_export"):
        value = getattr(payload, field)
        if field in provided_fields and value is not None:
            setattr(share, field, value)
    if "share_password" in provided_fields:
        if payload.share_password and not policy.allow_share_password:
            raise ShareError("Password-protected shares are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
        if not payload.share_password and not policy.allow_public_share:
            raise ShareError("Public shares are disabled by the system administrator.", HTTPStatus.FORBIDDEN)
        share.password_hash = hash_password(payload.share_password) if payload.share_password else None
        share.password_version += 1
        share.unlock_failed_attempts = 0
        share.unlock_blocked_until = None
        db.query(ShareUnlockSession).filter(
            ShareUnlockSession.share_id == share.id,
            ShareUnlockSession.revoked_at.is_(None),
        ).update({ShareUnlockSession.revoked_at: _utc_now()}, synchronize_session=False)
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
        include_description=share.include_description,
        include_annotations=share.include_annotations,
        include_notebook=share.include_notebook,
        allow_export=share.allow_export,
        content_mode=share.content_mode,
        theme=share.theme,
        locale=share.locale,
        expires_at=share.expires_at,
        revoked_at=share.revoked_at,
        access_count=share.access_count,
        last_accessed_at=share.last_accessed_at,
        created_at=share.created_at,
        updated_at=share.updated_at,
        share_url=metadata.get("share_url") if isinstance(metadata.get("share_url"), str) else None,
        password_required=share.password_hash is not None,
        settings_revision=share_settings_revision(share),
    )


def share_create_response(result: ShareCreateResult) -> ShareCreateResponse:
    base = share_read(result.share).model_dump()
    base["share_url"] = result.share_url
    return ShareCreateResponse(**base, token=result.token)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _get_accessible_share(db: Session, token: str, unlock_token: str | None = None) -> Share:
    share = db.query(Share).filter(Share.token_hash == hash_token(token)).one_or_none()
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    policy = get_feature_policy(db)
    if not policy.allow_share_links:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    if share.password_hash is None and not policy.allow_public_share:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    if share.password_hash is not None and not policy.allow_share_password:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    _assert_share_accessible(share)
    if share.password_hash is not None:
        if not unlock_token:
            raise ShareError("Share password required.", HTTPStatus.UNAUTHORIZED)
        digest = share_unlock_digest(share.id, unlock_token)
        session = db.query(ShareUnlockSession).filter(
            ShareUnlockSession.share_id == share.id,
            ShareUnlockSession.token_digest == digest,
            ShareUnlockSession.password_version == share.password_version,
            ShareUnlockSession.revoked_at.is_(None),
        ).one_or_none()
        if session is None:
            raise ShareError("Share password required.", HTTPStatus.UNAUTHORIZED)
        session.last_activity_at = _utc_now()
    return share


def resolve_accessible_share(db: Session, token: str, unlock_token: str | None = None) -> Share:
    return _get_accessible_share(db, token, unlock_token)


def unlock_share(db: Session, token: str, password: str) -> tuple[Share, str]:
    share = db.query(Share).filter(Share.token_hash == hash_token(token)).one_or_none()
    if share is None:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    policy = get_feature_policy(db)
    if not policy.allow_share_links or not policy.allow_share_password:
        raise ShareError("Share not found.", HTTPStatus.NOT_FOUND)
    _assert_share_accessible(share)
    if share.password_hash is None:
        return share, ""
    now = _utc_now()
    if share.unlock_blocked_until is not None and _as_utc(share.unlock_blocked_until) > now:
        raise ShareError("Too many attempts. Try again shortly.", HTTPStatus.TOO_MANY_REQUESTS)
    if not verify_password(share.password_hash, password):
        share.unlock_failed_attempts += 1
        if share.unlock_failed_attempts >= SHARE_UNLOCK_BACKOFF_AFTER:
            delay = min(SHARE_UNLOCK_BACKOFF_MAX_SECONDS, 2 ** (share.unlock_failed_attempts - SHARE_UNLOCK_BACKOFF_AFTER))
            share.unlock_blocked_until = now + timedelta(seconds=delay)
        db.flush()
        raise ShareError("Incorrect share password.", HTTPStatus.UNAUTHORIZED)
    share.unlock_failed_attempts = 0
    share.unlock_blocked_until = None
    raw_token = secrets.token_urlsafe(48)
    db.add(ShareUnlockSession(
        share_id=share.id,
        token_digest=share_unlock_digest(share.id, raw_token),
        password_version=share.password_version,
        created_at=now,
        last_activity_at=now,
    ))
    db.flush()
    return share, raw_token


def share_unlock_digest(share_id: uuid.UUID, token: str) -> str:
    secret = get_settings().auth_secret_value().encode("utf-8")
    if len(secret) < 32:
        raise ShareError("Share authorization is unavailable.", HTTPStatus.SERVICE_UNAVAILABLE)
    return hmac.new(secret, f"share:{share_id}:{token}".encode("utf-8"), hashlib.sha256).hexdigest()


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


def _build_frozen_snapshot(db: Session, share: Share, conversation: Conversation) -> None:
    if share.content_mode != "frozen":
        return
    existing = db.get(ShareSnapshot, share.id)
    if existing is not None:
        return
    query = _share_message_query(db, share)
    _validate_frozen_content(db, share, query)
    messages = query.order_by(Message.order_key.asc(), Message.id.asc()).all()
    items = [
        _full_message_item(db, message, ordinal=index + 1).model_dump(mode="json")
        for index, message in enumerate(messages)
    ]
    heading_query = db.query(Heading).filter(Heading.conversation_id == conversation.id)
    if share.scope == "selected_messages":
        heading_query = heading_query.filter(Heading.message_id.in_(_selected_message_ids(share)))
    headings = heading_query.order_by(Heading.heading_index.asc()).limit(5001).all() if share.include_toc else []
    if len(headings) > 5000:
        raise ShareError("Frozen shares are limited to 5,000 headings.", HTTPStatus.UNPROCESSABLE_ENTITY, code="FROZEN_SHARE_LIMIT")
    turn_ranges = _snapshot_turn_ranges([MessageListItem.model_validate(item) for item in items])
    conversation_data = _conversation_item(conversation).model_dump(mode="json")
    toc_data = [_toc_item(heading).model_dump(mode="json") for heading in headings]
    description = conversation.description_markdown if share.include_description else None
    payload = {"conversation": conversation_data, "messages": items, "toc": toc_data, "description": description}
    if len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 24 * 1024 * 1024:
        raise ShareError("Frozen content exceeds the 24 MiB snapshot limit.", HTTPStatus.UNPROCESSABLE_ENTITY, code="FROZEN_SHARE_LIMIT")
    db.add(ShareSnapshot(
        share_id=share.id,
        conversation=conversation_data,
        messages=items,
        toc=toc_data,
        description_markdown=description,
        message_count=len(items),
        turn_count=len(turn_ranges),
        created_at=_utc_now(),
    ))
    db.flush()


def _validate_frozen_content(db: Session, share: Share, query: Query) -> None:
    if query.count() > 5000:
        raise ShareError(
            "Frozen shares are limited to 5,000 messages. Use a live share or select a smaller range.",
            HTTPStatus.UNPROCESSABLE_ENTITY,
            code="FROZEN_SHARE_LIMIT",
        )
    version_ids = query.with_entities(Message.current_version_id).statement
    def byte_length(column):
        value = cast(column, Text)
        return func.coalesce(
            func.octet_length(value) if db.get_bind().dialect.name == "postgresql"
            else func.length(cast(value, LargeBinary)), 0,
        )
    version_bytes = db.scalar(select(func.coalesce(func.sum(
        byte_length(MessageVersion.plain_text) + byte_length(MessageVersion.display_text)
        + byte_length(MessageVersion.blocks),
    ), 0)).where(MessageVersion.id.in_(version_ids)))
    block_count, block_bytes = db.query(
        func.count(RenderBlock.id),
        func.coalesce(func.sum(byte_length(RenderBlock.plain_text) + byte_length(RenderBlock.data)), 0),
    ).filter(RenderBlock.message_version_id.in_(version_ids)).one()
    # Bound bytes and object counts in SQL before hydrating immutable bodies.
    if version_bytes + block_bytes > 24 * 1024 * 1024 or block_count > 50_000:
        raise ShareError("Frozen content exceeds the snapshot resource limit.", HTTPStatus.UNPROCESSABLE_ENTITY, code="FROZEN_SHARE_LIMIT")
    attachment = db.query(MessageVersionAttachment.id).filter(
        MessageVersionAttachment.message_version_id.in_(version_ids)
    ).first()
    if attachment is not None:
        raise ShareError(
            "Frozen shares currently support text-only content. Remove attachments or use a live share.",
            HTTPStatus.UNPROCESSABLE_ENTITY,
            code="FROZEN_SHARE_TEXT_ONLY",
        )
    if share.include_annotations or share.include_notebook or share.allow_export:
        raise ShareError(
            "Frozen shares currently support only messages, headings and the optional conversation description.",
            HTTPStatus.UNPROCESSABLE_ENTITY,
            code="FROZEN_SHARE_UNSUPPORTED_OPTIONS",
        )


def _full_message_item(db: Session, message: Message, *, ordinal: int) -> MessageListItem:
    version = db.get(MessageVersion, message.current_version_id) if message.current_version_id else None
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == message.current_version_id)
        .order_by(RenderBlock.block_index.asc())
        .all()
        if message.current_version_id
        else []
    )
    if version is None or len(blocks) != message.block_count:
        raise ShareError("Frozen content is incomplete. Rebuild the conversation and retry.", HTTPStatus.CONFLICT)
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
        ordinal=ordinal,
        content_preview=None,
        content_truncated=False,
    )


def _snapshot_for_share(db: Session, share: Share) -> ShareSnapshot | None:
    if share.content_mode != "frozen":
        return None
    snapshot = db.get(ShareSnapshot, share.id)
    if snapshot is None:
        raise ShareError("Frozen share content is unavailable.", HTTPStatus.CONFLICT)
    return snapshot


def _snapshot_items(snapshot: ShareSnapshot) -> list[MessageListItem]:
    try:
        return [MessageListItem.model_validate(item) for item in snapshot.messages]
    except (TypeError, ValueError) as exc:
        raise ShareError("Frozen share content is unavailable.", HTTPStatus.CONFLICT) from exc


def _snapshot_turn_ranges(items: list[MessageListItem]) -> list[tuple[int, int]]:
    if not items:
        return []
    user_roles = {"user", "prompt", "human"}
    if any(item.role.lower() in user_roles for item in items):
        ranges: list[tuple[int, int]] = []
        start = 0
        for index, item in enumerate(items):
            if index > 0 and item.role.lower() in user_roles:
                ranges.append((start, index))
                start = index
        ranges.append((start, len(items)))
        return ranges
    if any(item.turn_index is not None for item in items):
        ranges = []
        start = 0
        last_key = items[0].turn_index
        for index, item in enumerate(items[1:], start=1):
            key = item.turn_index if item.turn_index is not None else ("synthetic", index)
            if key != last_key:
                ranges.append((start, index))
                start = index
            last_key = key
        ranges.append((start, len(items)))
        return ranges
    return [(index, index + 1) for index in range(len(items))]


def _frozen_message_window(
    snapshot: ShareSnapshot,
    *,
    offset: int,
    limit: int,
    anchor_message_id: uuid.UUID | None,
    anchor_before: int,
) -> MessageWindowResponse:
    items = _snapshot_items(snapshot)
    if anchor_message_id is not None:
        anchor_index = next((index for index, item in enumerate(items) if item.id == anchor_message_id), None)
        if anchor_index is None:
            raise ShareError("Shared message not found.", HTTPStatus.NOT_FOUND)
        offset = max(0, min(max(len(items) - limit, 0), anchor_index - anchor_before))
    page = items[offset:offset + limit]
    return MessageWindowResponse(
        items=page,
        limit=limit,
        offset=offset,
        total=len(items),
        has_previous=offset > 0,
        has_more=offset + len(page) < len(items),
    )


def _frozen_reader_turn(snapshot: ShareSnapshot, anchor_message_id: uuid.UUID | None) -> ReaderTurnResponse:
    items = _snapshot_items(snapshot)
    if not items:
        return ReaderTurnResponse(
            conversation_id=uuid.UUID(str(snapshot.conversation["id"])),
            turn_key="empty",
            start_offset=0,
            end_offset=0,
            total_messages=0,
        )
    anchor_index = 0
    if anchor_message_id is not None:
        anchor_index = next((index for index, item in enumerate(items) if item.id == anchor_message_id), -1)
        if anchor_index < 0:
            raise ShareError("Anchor message not found.", HTTPStatus.NOT_FOUND)
    ranges = _snapshot_turn_ranges(items)
    selected_index = next(index for index, (start, end) in enumerate(ranges) if start <= anchor_index < end)
    start, end = ranges[selected_index]
    return ReaderTurnResponse(
        conversation_id=uuid.UUID(str(snapshot.conversation["id"])),
        turn_key=f"turn-{selected_index}",
        start_offset=start,
        end_offset=end,
        total_messages=len(items),
        items=items[start:end],
        previous_anchor_message_id=items[ranges[selected_index - 1][0]].id if selected_index else None,
        next_anchor_message_id=items[ranges[selected_index + 1][0]].id if selected_index + 1 < len(ranges) else None,
    )


def _frozen_dialogue_index(
    snapshot: ShareSnapshot,
    *,
    offset: int,
    limit: int,
    anchor_message_id: uuid.UUID | None,
) -> DialogueIndexResponse:
    items = _snapshot_items(snapshot)
    if anchor_message_id is not None:
        anchor_index = next((index for index, item in enumerate(items) if item.id == anchor_message_id), None)
        if anchor_index is None:
            raise ShareError("Shared message not found.", HTTPStatus.NOT_FOUND)
        offset = max(0, min(max(len(items) - limit, 0), anchor_index - limit // 2))
    role_counts: dict[str, int] = {}
    for item in items[:offset]:
        role_counts[item.role] = role_counts.get(item.role, 0) + 1
    result: list[DialogueIndexItem] = []
    for ordinal, item in enumerate(items[offset:offset + limit], start=offset + 1):
        role_counts[item.role] = role_counts.get(item.role, 0) + 1
        preview = item.current_version.display_text if item.current_version else ""
        result.append(
            DialogueIndexItem(
                message_id=item.id,
                role=item.role,
                role_number=role_counts[item.role],
                ordinal=ordinal,
                order_key=item.order_key,
                turn_index=item.turn_index,
                preview=dialogue_preview(preview[:8000], item.role),
            )
        )
    return DialogueIndexResponse(
        conversation_id=uuid.UUID(str(snapshot.conversation["id"])),
        items=result,
        message_count=len(items),
        turn_count=snapshot.turn_count,
        limit=limit,
        offset=offset,
        total=len(items),
        has_previous=offset > 0,
        has_more=offset + len(result) < len(items),
    )


def _frozen_toc(
    snapshot: ShareSnapshot,
    *,
    message_id: uuid.UUID | None,
    offset: int,
    limit: int,
    max_level: int | None,
    conversation_id: uuid.UUID,
) -> TocResponse:
    items = [TocItem.model_validate(item) for item in snapshot.toc]
    if message_id is not None:
        items = [item for item in items if item.message_id == message_id]
    if max_level is not None:
        items = [item for item in items if item.level <= max_level]
    page = items[offset:offset + limit]
    return TocResponse(
        conversation_id=conversation_id,
        items=page,
        limit=limit,
        offset=offset,
        total=len(items),
        has_more=offset + len(page) < len(items),
    )


def _frozen_blocks(
    snapshot: ShareSnapshot,
    *,
    message_id: uuid.UUID,
    start: int,
    limit: int,
) -> list[RenderBlockRead]:
    item = next((item for item in _snapshot_items(snapshot) if item.id == message_id), None)
    if item is None:
        raise ShareError("Shared message not found.", HTTPStatus.NOT_FOUND)
    return item.render_blocks[start:start + limit]


def resolve_frozen_locator(
    share: Share,
    payload,
    *,
    db: Session,
) -> dict:
    snapshot = _snapshot_for_share(db, share)
    items = _snapshot_items(snapshot)
    item = next((candidate for candidate in items if candidate.id == payload.message_id), None)
    if item is None:
        raise ShareError("Shared message not found.", HTTPStatus.NOT_FOUND)
    version_id = item.current_version.id if item.current_version else None
    if payload.message_version_id and payload.message_version_id != version_id:
        return {
            "conversation_id": share.conversation_id,
            "status": "MESSAGE_ONLY",
            "message_id": item.id,
            "message_version_id": version_id,
            "reason": "frozen snapshot does not contain that version",
            "fallback_kind": "message",
        }
    if payload.render_block_id:
        block = next((block for block in item.render_blocks if block.id == payload.render_block_id), None)
        if block is None:
            return {
                "conversation_id": share.conversation_id,
                "status": "MESSAGE_ONLY",
                "message_id": item.id,
                "message_version_id": version_id,
                "reason": "frozen snapshot block not found",
                "fallback_kind": "message",
            }
        return {
            "conversation_id": share.conversation_id,
            "status": "EXACT",
            "message_id": item.id,
            "message_version_id": version_id,
            "render_block_id": block.id,
            "block_index": block.block_index,
        }
    return {
        "conversation_id": share.conversation_id,
        "status": "MESSAGE_ONLY",
        "message_id": item.id,
        "message_version_id": version_id,
        "reason": "frozen snapshot locator",
        "fallback_kind": "message",
    }


def reclaim_expired_frozen_snapshots(session_factory, *, now: datetime | None = None, limit: int = 500) -> int:
    """Remove frozen payload bytes shortly after access expiry using a bounded batch."""
    current = now or _utc_now()
    with session_factory() as db:
        expired_ids = db.query(ShareSnapshot.share_id).join(
            Share,
            Share.id == ShareSnapshot.share_id,
        ).filter(
            Share.content_mode == "frozen",
            Share.expires_at.is_not(None),
            Share.expires_at <= current,
        ).order_by(Share.expires_at.asc(), Share.id.asc()).limit(limit).with_for_update(of=Share).all()
        ids = [row[0] for row in expired_ids]
        if ids:
            db.query(ShareSnapshot).filter(ShareSnapshot.share_id.in_(ids)).delete(synchronize_session=False)
        db.commit()
        return len(ids)


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
    if payload.content_mode not in {"live", "frozen"}:
        raise ShareError("Unsupported share content mode.")
    if payload.scope == "selected_messages" and not payload.selected_message_ids:
        raise ShareError("selected_messages share requires at least one message.")
    if payload.selected_message_ids:
        requested = list(set(payload.selected_message_ids))
        for start in range(0, len(requested), 5000):
            batch = requested[start:start + 5000]
            valid_count = db.query(Message.id).filter(
                Message.conversation_id == conversation.id, Message.is_deleted.is_(False), Message.id.in_(batch)
            ).count()
            if valid_count != len(batch):
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
        message_version_id=heading.message_version_id,
        render_block_id=heading.render_block_id,
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
        description_markdown=None,
        project_id=None,
        project_name=None,
        offline_revision=conversation.offline_revision,
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
