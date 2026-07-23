import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
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

router = APIRouter(tags=["annotations"])


@router.get("/api/conversations/{conversation_id}/annotations", response_model=list[AnnotationRead])
def get_annotations(
    conversation_id: uuid.UUID,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
) -> list[AnnotationRead]:
    try:
        return [annotation_read(item) for item in list_annotations(db, conversation_id, include_deleted=include_deleted)]
    except AnnotationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post(
    "/api/conversations/{conversation_id}/annotations",
    response_model=AnnotationRead,
    status_code=status.HTTP_201_CREATED,
)
def post_annotation(
    conversation_id: uuid.UUID, payload: AnnotationCreate, db: Session = Depends(get_db)
) -> AnnotationRead:
    try:
        annotation = create_annotation(db, conversation_id, payload)
        db.commit()
        return annotation_read(annotation)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.patch("/api/annotations/{annotation_id}", response_model=AnnotationRead)
def patch_annotation(
    annotation_id: uuid.UUID, payload: AnnotationUpdate, db: Session = Depends(get_db)
) -> AnnotationRead:
    try:
        annotation = update_annotation(db, annotation_id, payload)
        db.commit()
        return annotation_read(annotation)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.delete("/api/annotations/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_annotation(
    annotation_id: uuid.UUID,
    base_revision: int = Query(ge=1),
    db: Session = Depends(get_db),
) -> Response:
    try:
        delete_annotation(db, annotation_id, base_revision)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.post("/api/annotations/sync", response_model=AnnotationSyncResponse)
def post_annotation_sync(
    payload: AnnotationSyncRequest, db: Session = Depends(get_db)
) -> AnnotationSyncResponse:
    try:
        response = sync_annotations(db, payload)
        db.commit()
        return response
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/conversations/{conversation_id}/notebook", response_model=NotebookRead)
def get_conversation_notebook(
    conversation_id: uuid.UUID, db: Session = Depends(get_db)
) -> NotebookRead:
    try:
        notebook = get_notebook(db, conversation_id)
        db.commit()
        return notebook_read(notebook)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.put("/api/conversations/{conversation_id}/notebook", response_model=NotebookRead)
def put_conversation_notebook(
    conversation_id: uuid.UUID, payload: NotebookPut, db: Session = Depends(get_db)
) -> NotebookRead:
    try:
        notebook = put_notebook(db, conversation_id, payload)
        db.commit()
        return notebook_read(notebook)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/api/conversations/{conversation_id}/notebook/conflicts", response_model=list[NotebookRead])
def get_conversation_notebook_conflicts(
    conversation_id: uuid.UUID, db: Session = Depends(get_db)
) -> list[NotebookRead]:
    try:
        return [notebook_read(item) for item in list_notebook_conflicts(db, conversation_id)]
    except AnnotationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
