import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.core.database import get_db
from app.schemas.message import DialogueIndexResponse, LocatorTargetRequest, ReaderTurnResponse, RenderBlockRead, ResolvedLocatorResponse
from app.schemas.search import MessageWindowResponse
from app.schemas.annotation import AnnotationRead, NotebookRead
from app.schemas.share import ShareCreate, ShareCreateResponse, ShareRead, ShareRevokeResponse, ShareUnlockInput, ShareUnlockResponse, ShareUpdate, SharedConversationBootstrap
from app.schemas.share import OwnedSharePage, ShareBatchResult, ShareBatchRevokeInput, ShareBatchRevokeResponse
from app.schemas.toc import TocResponse
from app.services.sharing.share_service import (
    ShareError,
    create_share,
    get_shared_dialogue_index,
    get_shared_conversation_by_token,
    get_shared_message_blocks,
    get_shared_message_window,
    get_shared_reader_turn,
    get_shared_annotations,
    get_shared_notebook,
    get_shared_toc,
    list_shares,
    list_owned_shares,
    get_owned_share,
    revoke_share,
    share_create_response,
    share_read,
    SHARE_UNLOCK_COOKIE_NAME,
    _ensure_shared_message,
    _get_accessible_share,
    unlock_share,
    update_share,
)
from app.services.annotations import annotation_read, notebook_read
from app.services.reader_locator import resolve_reader_locator
from app.services.ownership import ownership_scope_from_request

router = APIRouter(tags=["shares"])


@router.get("/api/shares", response_model=OwnedSharePage)
def get_my_shares(
    request: Request, response: Response, db: Session = Depends(get_db),
    status_filter: Literal["all", "active", "expired", "revoked"] = Query(default="all", alias="status"),
    conversation_id: uuid.UUID | None = None, q: str = Query(default="", max_length=200),
    offset: int = Query(default=0, ge=0), limit: int = Query(default=20, ge=1, le=100),
) -> OwnedSharePage:
    response.headers["Cache-Control"] = "no-store"
    return list_owned_shares(db, ownership_scope_from_request(request), status=status_filter,
                             conversation_id=conversation_id, query=q, offset=offset, limit=limit)


@router.post("/api/shares/revoke-batch", response_model=ShareBatchRevokeResponse)
def revoke_my_shares(
    payload: ShareBatchRevokeInput, request: Request, db: Session = Depends(get_db),
) -> ShareBatchRevokeResponse:
    scope = ownership_scope_from_request(request)
    results = []
    # Independent transactions retain acknowledged successes if another item fails.
    # Repeating the same ID is safe: revoke_share emits its event only once.
    for share_id in dict.fromkeys(payload.share_ids):
        try:
            revoke_share(db, share_id, scope)
            db.commit()
            result = "revoked"
        except ShareError as exc:
            db.rollback()
            result = "not_found" if exc.status_code == 404 else "failed"
        except SQLAlchemyError:
            db.rollback()
            result = "failed"
        results.append(ShareBatchResult(share_id=share_id, status=result))
    return ShareBatchRevokeResponse(results=results)


@router.post("/api/conversations/{conversation_id}/shares", response_model=ShareCreateResponse)
def create_conversation_share(
    conversation_id: uuid.UUID,
    payload: ShareCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> ShareCreateResponse:
    try:
        result = create_share(db, conversation_id, payload, ownership_scope_from_request(request))
        db.commit()
        return share_create_response(result)
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/conversations/{conversation_id}/shares", response_model=list[ShareRead])
def list_conversation_shares(
    conversation_id: uuid.UUID,
    request: Request,
    include_revoked: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[ShareRead]:
    try:
        return [share_read(share) for share in list_shares(db, conversation_id, include_revoked, ownership_scope_from_request(request))]
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shares/{share_id}", response_model=ShareRead)
def get_my_share(share_id: uuid.UUID, request: Request, response: Response, db: Session = Depends(get_db)) -> ShareRead:
    response.headers["Cache-Control"] = "no-store"
    try:
        return share_read(get_owned_share(db, share_id, ownership_scope_from_request(request)))
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/api/shares/{share_id}/revoke", response_model=ShareRevokeResponse)
def revoke_conversation_share(
    share_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> ShareRevokeResponse:
    try:
        share = revoke_share(db, share_id, ownership_scope_from_request(request))
        db.commit()
        return ShareRevokeResponse(**share_read(share).model_dump())
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.patch("/api/shares/{share_id}", response_model=ShareRead)
def update_conversation_share(
    share_id: uuid.UUID,
    payload: ShareUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> ShareRead:
    try:
        share = update_share(db, share_id, payload, ownership_scope_from_request(request))
        db.commit()
        return share_read(share)
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": str(exc)} if exc.code else str(exc)) from exc


@router.get("/api/shared/{token}", response_model=SharedConversationBootstrap)
def get_shared_conversation(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
) -> SharedConversationBootstrap:
    try:
        response = get_shared_conversation_by_token(db, token, request.cookies.get(SHARE_UNLOCK_COOKIE_NAME))
        db.commit()
        return response
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/api/shared/{token}/unlock", response_model=ShareUnlockResponse)
def unlock_shared_conversation(
    token: str,
    payload: ShareUnlockInput,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> ShareUnlockResponse:
    try:
        _, unlock_token = unlock_share(db, token, payload.password)
        db.commit()
        if unlock_token:
            settings = get_settings()
            response.set_cookie(
                SHARE_UNLOCK_COOKIE_NAME,
                unlock_token,
                max_age=30 * 24 * 60 * 60,
                httponly=True,
                secure=settings.auth_cookie_secure,
                samesite="lax",
                path=f"/api/shared/{token}",
            )
        response.headers["Cache-Control"] = "no-store"
        return ShareUnlockResponse()
    except ShareError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/message-window", response_model=MessageWindowResponse)
def get_shared_messages(
    token: str,
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=30, ge=1, le=100),
    anchor_message_id: uuid.UUID | None = None,
    anchor_before: int | None = Query(default=None, ge=0, le=99),
    db: Session = Depends(get_db),
) -> MessageWindowResponse:
    try:
        if anchor_before is not None and anchor_before >= limit:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="anchor_before must be smaller than limit.",
            )
        return get_shared_message_window(
            db,
            token,
            offset=offset,
            limit=limit,
            anchor_message_id=anchor_message_id,
            anchor_before=min(anchor_before if anchor_before is not None else 12, limit - 1),
            unlock_token=request.cookies.get(SHARE_UNLOCK_COOKIE_NAME),
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/reader-turn", response_model=ReaderTurnResponse)
def get_shared_reader_turn_route(
    token: str,
    request: Request,
    anchor_message_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
) -> ReaderTurnResponse:
    try:
        return get_shared_reader_turn(db, token, anchor_message_id=anchor_message_id, unlock_token=request.cookies.get(SHARE_UNLOCK_COOKIE_NAME))
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/api/shared/{token}/resolve-locator", response_model=ResolvedLocatorResponse)
def resolve_shared_locator_route(
    token: str,
    payload: LocatorTargetRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ResolvedLocatorResponse:
    """Resolve a locator without widening the share's message scope."""
    try:
        share = _get_accessible_share(db, token, request.cookies.get(SHARE_UNLOCK_COOKIE_NAME))
        _ensure_shared_message(db, share, payload.message_id)
        return resolve_reader_locator(db, share.conversation_id, payload)
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/dialogue-index", response_model=DialogueIndexResponse)
def get_shared_index(
    token: str,
    request: Request,
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
            unlock_token=request.cookies.get(SHARE_UNLOCK_COOKIE_NAME),
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/toc", response_model=TocResponse)
def get_shared_contents(
    token: str,
    request: Request,
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
            unlock_token=request.cookies.get(SHARE_UNLOCK_COOKIE_NAME),
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/messages/{message_id}/blocks", response_model=list[RenderBlockRead])
def get_shared_blocks(
    token: str,
    request: Request,
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
            unlock_token=request.cookies.get(SHARE_UNLOCK_COOKIE_NAME),
        )
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/annotations", response_model=list[AnnotationRead])
def get_shared_annotations_route(token: str, request: Request, db: Session = Depends(get_db)) -> list[AnnotationRead]:
    try:
        return [annotation_read(item) for item in get_shared_annotations(db, token, request.cookies.get(SHARE_UNLOCK_COOKIE_NAME))]
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/shared/{token}/notebook", response_model=NotebookRead | None)
def get_shared_notebook_route(token: str, request: Request, db: Session = Depends(get_db)) -> NotebookRead | None:
    try:
        notebook = get_shared_notebook(db, token, request.cookies.get(SHARE_UNLOCK_COOKIE_NAME))
        return notebook_read(notebook) if notebook else None
    except ShareError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
