import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.task import BackgroundTaskRead
from app.schemas.toc import TocItem, TocRefreshRequest, TocResponse
from app.services.background_jobs import queue_toc_refresh
from app.services.editing.message_edit_service import MessageEditError
from app.api.routes.tasks import background_job_read
from app.services.toc.toc_service import TocServiceError, list_headings_page

router = APIRouter(prefix="/api/conversations", tags=["toc"])


@router.post("/{conversation_id}/toc/refresh", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def refresh_conversation_toc(
    conversation_id: uuid.UUID,
    payload: TocRefreshRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    try:
        job = queue_toc_refresh(
            db,
            conversation_id=conversation_id,
            refresh_dialogue_index=payload.refresh_dialogue_index,
            refresh_section_toc=payload.refresh_section_toc,
            section_scope=payload.section_scope,
            idempotency_key=idempotency_key,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return background_job_read(job)


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
                message_version_id=heading.message_version_id,
                render_block_id=heading.render_block_id,
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
