import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.toc import TocItem, TocResponse
from app.services.toc.toc_service import TocServiceError, list_headings_page

router = APIRouter(prefix="/api/conversations", tags=["toc"])


@router.get("/{conversation_id}/toc", response_model=TocResponse)
def get_conversation_toc(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    max_level: int | None = Query(default=None, ge=1, le=6),
    role: str | None = Query(default=None, max_length=40),
    q: str | None = Query(default=None, max_length=200),
    start_order_key: str | None = Query(default=None, max_length=100),
    end_order_key: str | None = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
) -> TocResponse:
    try:
        headings, total = list_headings_page(
            db,
            conversation_id,
            message_id=message_id,
            offset=offset,
            limit=limit,
            max_level=max_level,
            role=role,
            query_text=q,
            start_order_key=start_order_key,
            end_order_key=end_order_key,
        )
    except TocServiceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return TocResponse(
        conversation_id=conversation_id,
        items=[
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
        ],
        limit=limit,
        offset=offset,
        total=total,
        has_more=offset + len(headings) < total,
    )
