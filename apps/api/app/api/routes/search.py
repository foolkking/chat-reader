import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.search import (
    SearchReindexRequest,
    SearchReindexResponse,
    SearchResponse,
    SearchResultItem,
)
from app.services.search.search_indexer import (
    rebuild_search_and_toc_for_conversation,
    rebuild_search_documents_for_all,
)
from app.services.search.search_service import SearchServiceError, search

router = APIRouter(prefix="/api/search", tags=["search"])

DOCUMENT_TYPES = {"conversation", "message", "heading"}
ROLES = {"user", "assistant", "system", "tool", "note"}


@router.get("", response_model=SearchResponse)
def search_documents(
    q: str = Query(...),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    conversation_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    document_type: str | None = None,
    role: str | None = None,
    db: Session = Depends(get_db),
) -> SearchResponse:
    if document_type is not None and document_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid document_type.")
    if role is not None and role not in ROLES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role.")
    try:
        page = search(
            db,
            q,
            limit=limit,
            offset=offset,
            conversation_id=conversation_id,
            project_id=project_id,
            document_type=document_type,
            role=role,
        )
    except SearchServiceError as exc:
        status_code = status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return SearchResponse(
        query=page.query,
        items=[
            SearchResultItem(
                document_id=item.document_id,
                document_type=item.document_type,
                conversation_id=item.conversation_id,
                conversation_title=item.conversation_title,
                message_id=item.message_id,
                role=item.role,
                order_key=item.order_key,
                snippet=item.snippet,
                rank=item.rank,
                source_profile=item.source_profile,
                occurrence_count=item.occurrence_count,
            )
            for item in page.items
        ],
        limit=page.limit,
        offset=page.offset,
        total=page.total,
    )


@router.post("/reindex", response_model=SearchReindexResponse)
def reindex(payload: SearchReindexRequest | None = None, db: Session = Depends(get_db)) -> SearchReindexResponse:
    payload = payload or SearchReindexRequest()
    if payload.conversation_id is not None:
        result = rebuild_search_and_toc_for_conversation(db, payload.conversation_id)
    else:
        result = rebuild_search_documents_for_all(db)
    db.commit()
    return SearchReindexResponse(
        conversation_count=result.conversation_count,
        indexed_count=result.indexed_count,
        heading_count=result.heading_count,
    )
