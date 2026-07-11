import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.share import ShareCreate, ShareCreateResponse, ShareRead, ShareRevokeResponse, ShareUpdate, SharedConversationResponse
from app.services.sharing.share_service import (
    ShareError,
    create_share,
    get_shared_conversation_by_token,
    list_shares,
    revoke_share,
    share_create_response,
    share_read,
    update_share,
)

router = APIRouter(tags=["shares"])


@router.post("/api/conversations/{conversation_id}/shares", response_model=ShareCreateResponse)
def create_conversation_share(
    conversation_id: uuid.UUID,
    payload: ShareCreate,
    db: Session = Depends(get_db),
) -> ShareCreateResponse:
    try:
        result = create_share(db, conversation_id, payload)
        db.commit()
        return share_create_response(result)
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/conversations/{conversation_id}/shares", response_model=list[ShareRead])
def list_conversation_shares(
    conversation_id: uuid.UUID,
    include_revoked: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[ShareRead]:
    try:
        return [share_read(share) for share in list_shares(db, conversation_id, include_revoked)]
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/api/shares/{share_id}/revoke", response_model=ShareRevokeResponse)
def revoke_conversation_share(
    share_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> ShareRevokeResponse:
    try:
        share = revoke_share(db, share_id)
        db.commit()
        return ShareRevokeResponse(**share_read(share).model_dump())
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.patch("/api/shares/{share_id}", response_model=ShareRead)
def update_conversation_share(
    share_id: uuid.UUID,
    payload: ShareUpdate,
    db: Session = Depends(get_db),
) -> ShareRead:
    try:
        share = update_share(db, share_id, payload)
        db.commit()
        return share_read(share)
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}", response_model=SharedConversationResponse)
def get_shared_conversation(
    token: str,
    db: Session = Depends(get_db),
) -> SharedConversationResponse:
    try:
        response = get_shared_conversation_by_token(db, token)
        db.commit()
        return response
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
