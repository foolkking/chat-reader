import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.routes.conversations import _conversation_item
from app.core.database import get_db
from app.models.reading_position import ReadingPosition
from app.models.recent_item import RecentItem
from app.schemas.reading import (
    ReadingPositionRead,
    ReadingPositionResponse,
    ReadingPositionUpsert,
    RecentItemCreate,
    RecentItemRead,
)
from app.services.reading.reading_service import (
    ReadingServiceError,
    get_reading_position,
    list_recent_items,
    record_recent_item,
    upsert_reading_position,
)

router = APIRouter(tags=["reading"])


@router.get(
    "/api/conversations/{conversation_id}/reading-position",
    response_model=ReadingPositionResponse,
)
def get_position(conversation_id: uuid.UUID, db: Session = Depends(get_db)) -> ReadingPositionResponse:
    try:
        position = get_reading_position(db, conversation_id)
    except ReadingServiceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ReadingPositionResponse(
        conversation_id=conversation_id,
        position=_position_read(position) if position else None,
    )


@router.put(
    "/api/conversations/{conversation_id}/reading-position",
    response_model=ReadingPositionRead,
)
def put_position(
    conversation_id: uuid.UUID,
    payload: ReadingPositionUpsert,
    db: Session = Depends(get_db),
) -> ReadingPositionRead:
    try:
        position = upsert_reading_position(
            db,
            conversation_id,
            message_id=payload.message_id,
            block_index=payload.block_index,
            scroll_offset=payload.scroll_offset,
            anchor_data=payload.anchor_data,
        )
        db.commit()
    except ReadingServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=_status_for_reading_error(exc), detail=str(exc)) from exc
    return _position_read(position)


@router.post("/api/conversations/{conversation_id}/recent", response_model=RecentItemRead)
def record_recent(
    conversation_id: uuid.UUID,
    payload: RecentItemCreate | None = None,
    db: Session = Depends(get_db),
) -> RecentItemRead:
    payload = payload or RecentItemCreate()
    try:
        recent = record_recent_item(
            db,
            conversation_id,
            project_id=payload.project_id,
            last_message_id=payload.last_message_id,
            context=payload.context,
        )
        db.commit()
    except ReadingServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=_status_for_reading_error(exc), detail=str(exc)) from exc
    return _recent_read(recent)


@router.get("/api/recent-items", response_model=list[RecentItemRead])
def get_recent_items(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[RecentItemRead]:
    return [_recent_read(item) for item in list_recent_items(db, limit)]


def _position_read(position: ReadingPosition) -> ReadingPositionRead:
    return ReadingPositionRead(
        id=position.id,
        conversation_id=position.conversation_id,
        message_id=position.message_id,
        block_index=position.block_index,
        scroll_offset=position.scroll_offset,
        anchor_data=position.anchor_data,
        updated_at=position.updated_at,
        created_at=position.created_at,
    )


def _recent_read(item: RecentItem) -> RecentItemRead:
    return RecentItemRead(
        id=item.id,
        conversation_id=item.conversation_id,
        project_id=item.project_id,
        last_message_id=item.last_message_id,
        last_opened_at=item.last_opened_at,
        open_count=item.open_count,
        context=item.context,
        conversation=_conversation_item(item.conversation),
    )


def _status_for_reading_error(exc: ReadingServiceError) -> int:
    message = str(exc).lower()
    if "not found" in message:
        return status.HTTP_404_NOT_FOUND
    return status.HTTP_400_BAD_REQUEST
