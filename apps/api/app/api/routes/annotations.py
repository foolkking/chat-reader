import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.annotation import ConversationAnnotation
from app.models.conversation import Conversation
from app.schemas.annotation import (
    AnnotationCreate,
    AnnotationRead,
    AnnotationSyncRequest,
    AnnotationSyncResponse,
    AnnotationUpdate,
    NotebookPut,
    NotebookRead,
)
from app.services.annotations import (
    AnnotationError,
    annotation_read,
    create_annotation,
    delete_annotation,
    get_notebook,
    list_notebook_conflicts,
    list_annotations,
    notebook_read,
    put_notebook,
    sync_annotations,
    update_annotation,
)
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request, subject_key_from_request

router = APIRouter(tags=["annotations"])


@router.get("/api/conversations/{conversation_id}/annotations", response_model=list[AnnotationRead])
def get_annotations(
    conversation_id: uuid.UUID,
    request: Request,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
) -> list[AnnotationRead]:
    try:
        _owned_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
        return [
            annotation_read(item)
            for item in list_annotations(
                db,
                conversation_id,
                include_deleted=include_deleted,
                subject_key=subject_key_from_request(request),
            )
        ]
    except AnnotationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post(
    "/api/conversations/{conversation_id}/annotations",
    response_model=AnnotationRead,
    status_code=status.HTTP_201_CREATED,
)
def post_annotation(
    conversation_id: uuid.UUID,
    payload: AnnotationCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> AnnotationRead:
    try:
        _owned_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
        annotation = create_annotation(
            db,
            conversation_id,
            payload,
            subject_key=subject_key_from_request(request),
        )
        db.commit()
        return annotation_read(annotation)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.patch("/api/annotations/{annotation_id}", response_model=AnnotationRead)
def patch_annotation(
    annotation_id: uuid.UUID,
    payload: AnnotationUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> AnnotationRead:
    try:
        _owned_annotation_or_404(db, annotation_id, ownership_scope_from_request(request))
        annotation = update_annotation(
            db,
            annotation_id,
            payload,
            subject_key=subject_key_from_request(request),
        )
        db.commit()
        return annotation_read(annotation)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.delete("/api/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_annotation(
    annotation_id: uuid.UUID,
    request: Request,
    base_revision: int = Query(ge=1),
    db: Session = Depends(get_db),
) -> Response:
    try:
        _owned_annotation_or_404(db, annotation_id, ownership_scope_from_request(request))
        delete_annotation(
            db,
            annotation_id,
            base_revision,
            subject_key=subject_key_from_request(request),
        )
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/api/annotations/sync", response_model=AnnotationSyncResponse)
def post_annotation_sync(
    payload: AnnotationSyncRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AnnotationSyncResponse:
    try:
        ownership_scope = ownership_scope_from_request(request)
        for conversation_id in {item.conversation_id for item in payload.operations}:
            _owned_conversation_or_404(db, conversation_id, ownership_scope)
        response = sync_annotations(db, payload, subject_key=subject_key_from_request(request))
        db.commit()
        return response
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/conversations/{conversation_id}/notebook", response_model=NotebookRead)
def get_conversation_notebook(
    conversation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> NotebookRead:
    try:
        _owned_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
        notebook = get_notebook(db, conversation_id, subject_key=subject_key_from_request(request))
        db.commit()
        return notebook_read(notebook)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.put("/api/conversations/{conversation_id}/notebook", response_model=NotebookRead)
def put_conversation_notebook(
    conversation_id: uuid.UUID,
    payload: NotebookPut,
    request: Request,
    db: Session = Depends(get_db),
) -> NotebookRead:
    try:
        _owned_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
        notebook = put_notebook(
            db,
            conversation_id,
            payload,
            subject_key=subject_key_from_request(request),
        )
        db.commit()
        return notebook_read(notebook)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/conversations/{conversation_id}/notebook/conflicts", response_model=list[NotebookRead])
def get_conversation_notebook_conflicts(
    conversation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> list[NotebookRead]:
    try:
        _owned_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
        return [
            notebook_read(item)
            for item in list_notebook_conflicts(
                db,
                conversation_id,
                subject_key=subject_key_from_request(request),
            )
        ]
    except AnnotationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


def _owned_conversation_or_404(
    db: Session,
    conversation_id: uuid.UUID,
    ownership_scope: OwnershipScope,
) -> Conversation:
    conversation = get_owned(db, Conversation, conversation_id, ownership_scope)
    if conversation is None or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return conversation


def _owned_annotation_or_404(
    db: Session,
    annotation_id: uuid.UUID,
    ownership_scope: OwnershipScope,
) -> ConversationAnnotation:
    annotation = (
        db.query(ConversationAnnotation)
        .join(Conversation, Conversation.id == ConversationAnnotation.conversation_id)
        .filter(
            ConversationAnnotation.id == annotation_id,
            ownership_scope.predicate(Conversation),
            Conversation.deleted_at.is_(None),
        )
        .one_or_none()
    )
    if annotation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found.")
    return annotation
