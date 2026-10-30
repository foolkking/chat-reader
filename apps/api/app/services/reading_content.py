import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.reading_content_baseline import ReadingContentBaseline, ReadingContentBaselineMessage
from app.schemas.reading import (
    NewMessageRead,
    ReadingContentBaselineResponse,
    ReadingContentChangesResponse,
)
from app.services.ownership import OwnershipScope, get_owned
from app.services.preferences import get_or_create_preferences


class ReadingContentError(ValueError):
    pass


def get_new_message_changes(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    subject_key: str,
    ownership_scope: OwnershipScope,
    limit: int = 50,
) -> ReadingContentChangesResponse:
    conversation = get_owned(db, Conversation, conversation_id, ownership_scope)
    if conversation is None or conversation.deleted_at is not None:
        raise ReadingContentError("Conversation not found.")
    baseline = db.scalar(select(ReadingContentBaseline).where(
        ReadingContentBaseline.subject_key == subject_key,
        ReadingContentBaseline.conversation_id == conversation_id,
    ))
    if baseline is None:
        return ReadingContentChangesResponse(
            conversation_id=conversation_id,
            baseline_available=False,
            new_message_count=None,
            items=[],
            limit=limit,
            has_more=False,
        )
    seen_ids = select(ReadingContentBaselineMessage.message_id).where(
        ReadingContentBaselineMessage.baseline_id == baseline.id,
    )
    new_query = db.query(Message.id, Message.order_key, Message.role, MessageVersion.display_text).join(
        MessageVersion,
        MessageVersion.id == Message.current_version_id,
        isouter=True,
    ).filter(
        Message.conversation_id == conversation_id,
        Message.is_deleted.is_(False),
        Message.id.not_in(seen_ids),
    )
    count = new_query.count()
    rows = new_query.order_by(Message.order_key.asc(), Message.id.asc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    return ReadingContentChangesResponse(
        conversation_id=conversation_id,
        baseline_available=True,
        baseline_captured_at=baseline.captured_at,
        new_message_count=count,
        first_new_message_id=rows[0].id if rows else None,
        items=[
            NewMessageRead(
                message_id=row.id,
                order_key=row.order_key,
                role=row.role,
                preview=" ".join((row.display_text or "").split())[:240],
            )
            for row in rows
        ],
        limit=limit,
        has_more=has_more,
    )


def capture_reading_content_baseline(
    db: Session,
    conversation_id: uuid.UUID,
    *,
    subject_key: str,
    ownership_scope: OwnershipScope,
) -> ReadingContentBaselineResponse:
    conversation = db.scalar(
        select(Conversation)
        .where(
            Conversation.id == conversation_id,
            ownership_scope.predicate(Conversation),
            Conversation.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if conversation is None:
        raise ReadingContentError("Conversation not found.")
    get_or_create_preferences(db, subject_key)
    baseline = db.scalar(
        select(ReadingContentBaseline)
        .where(
            ReadingContentBaseline.subject_key == subject_key,
            ReadingContentBaseline.conversation_id == conversation_id,
        )
        .with_for_update()
    )
    if baseline is None:
        baseline = ReadingContentBaseline(
            id=uuid.uuid4(),
            subject_key=subject_key,
            conversation_id=conversation_id,
            captured_at=datetime.now(timezone.utc),
        )
        db.add(baseline)
        db.flush()
    else:
        db.query(ReadingContentBaselineMessage).filter(
            ReadingContentBaselineMessage.baseline_id == baseline.id,
        ).delete(synchronize_session=False)
        baseline.captured_at = datetime.now(timezone.utc)
    message_query = select(Message.id).where(
            Message.conversation_id == conversation_id,
            Message.is_deleted.is_(False),
        ).order_by(Message.order_key.asc(), Message.id.asc())
    # Avoid materializing a potentially large conversation in application memory.
    # Explicit baselines are capped so a pathological import cannot hold a
    # long-running transaction or create an unbounded per-account snapshot.
    total = db.query(Message.id).filter(
        Message.conversation_id == conversation_id,
        Message.is_deleted.is_(False),
    ).count()
    if total > 100_000:
        raise ReadingContentError("Conversation is too large to create a reading baseline.")
    for start in range(0, total, 1000):
        message_ids = db.scalars(message_query.offset(start).limit(1000)).all()
        db.add_all(
            ReadingContentBaselineMessage(
                id=uuid.uuid4(),
                baseline_id=baseline.id,
                message_id=message_id,
            )
            for message_id in message_ids
        )
    db.flush()
    return ReadingContentBaselineResponse(
        conversation_id=conversation_id,
        captured_at=baseline.captured_at,
        message_count=total,
    )
