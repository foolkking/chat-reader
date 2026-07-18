import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.message import DialogueIndexResponse, RenderBlockRead
from app.schemas.search import MessageWindowResponse
from app.schemas.share import ShareCreate, ShareCreateResponse, ShareRead, ShareRevokeResponse, ShareUpdate, SharedConversationBootstrap
from app.schemas.toc import TocResponse
from app.services.sharing.share_service import (
    ShareError,
    create_share,
    get_shared_dialogue_index,
    get_shared_conversation_by_token,
    get_shared_message_blocks,
    get_shared_message_window,
    get_shared_toc,
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


@router.get("/api/shared/{token}", response_model=SharedConversationBootstrap)
def get_shared_conversation(
    token: str,
    db: Session = Depends(get_db),
) -> SharedConversationBootstrap:
    try:
        response = get_shared_conversation_by_token(db, token)
        db.commit()
        return response
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/message-window", response_model=MessageWindowResponse)
def get_shared_messages(
    token: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=30, ge=1, le=100),
    anchor_message_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
) -> MessageWindowResponse:
    try:
        return get_shared_message_window(
            db,
            token,
            offset=offset,
            limit=limit,
            anchor_message_id=anchor_message_id,
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/dialogue-index", response_model=DialogueIndexResponse)
def get_shared_index(
    token: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=80, ge=1, le=5000),
    anchor_message_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
) -> DialogueIndexResponse:
    try:
        return get_shared_dialogue_index(
            db,
            token,
            offset=offset,
            limit=limit,
            anchor_message_id=anchor_message_id,
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/toc", response_model=TocResponse)
def get_shared_contents(
    token: str,
    message_id: uuid.UUID | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    max_level: int | None = Query(default=None, ge=1, le=6),
    db: Session = Depends(get_db),
) -> TocResponse:
    try:
        return get_shared_toc(
            db,
            token,
            message_id=message_id,
            offset=offset,
            limit=limit,
            max_level=max_level,
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/messages/{message_id}/blocks", response_model=list[RenderBlockRead])
def get_shared_blocks(
    token: str,
    message_id: uuid.UUID,
    start: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[RenderBlockRead]:
    try:
        return get_shared_message_blocks(
            db,
            token,
            message_id=message_id,
            start=start,
            limit=limit,
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
