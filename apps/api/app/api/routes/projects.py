import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.routes.conversations import _conversation_item
from app.core.database import get_db
from app.models.conversation_event import ConversationEvent
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.import_record import utc_now
from app.schemas.project import (
    ProjectConversationPinUpdate,
    ProjectConversationRead,
    ProjectConversationRelationRead,
    ProjectCreate,
    ProjectRead,
    ProjectUpdate,
)
from app.services.projects.project_service import (
    ProjectServiceError,
    add_conversation_to_project,
    create_project,
    list_project_conversations,
    list_projects,
    project_counts,
    remove_conversation_from_project,
    set_project_conversation_pin,
    update_project,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def get_projects(
    include_archived: bool = False,
    db: Session = Depends(get_db),
) -> list[ProjectRead]:
    projects = list_projects(db, include_archived=include_archived)
    db.commit()
    return [_project_read(project, db) for project in projects]


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project_route(payload: ProjectCreate, db: Session = Depends(get_db)) -> ProjectRead:
    try:
        project = create_project(
            db,
            name=payload.name,
            description=payload.description,
            color=payload.color,
            icon=payload.icon,
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _project_read(project, db)


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project_route(project_id: uuid.UUID, payload: ProjectUpdate, db: Session = Depends(get_db)) -> ProjectRead:
    project = _get_project_or_404(project_id, db)
    try:
        update_project(db, project, payload.model_dump(exclude_unset=True))
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _project_read(project, db)


@router.get("/{project_id}/conversations", response_model=list[ProjectConversationRead])
def get_project_conversations(
    project_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[ProjectConversationRead]:
    try:
        relations = list_project_conversations(db, project_id, limit=limit, offset=offset)
    except ProjectServiceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [_project_conversation_read(relation) for relation in relations]


@router.post("/{project_id}/conversations/{conversation_id}", response_model=ProjectConversationRead)
def add_project_conversation(
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> ProjectConversationRead:
    try:
        relation = add_conversation_to_project(db, project_id, conversation_id, added_by="user")
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=_not_found_status(exc), detail=str(exc)) from exc
    return _project_conversation_read(relation)


@router.delete("/{project_id}/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_conversation(
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> None:
    try:
        remove_conversation_from_project(db, project_id, conversation_id)
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{project_id}/conversations/{conversation_id}/pin", response_model=ProjectConversationRead)
def pin_project_conversation(
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    payload: ProjectConversationPinUpdate,
    db: Session = Depends(get_db),
) -> ProjectConversationRead:
    try:
        relation = set_project_conversation_pin(db, project_id, conversation_id, payload.is_pinned)
        db.add(
            ConversationEvent(
                conversation_id=conversation_id,
                event_type="pin_changed",
                payload={
                    "scope": "project",
                    "project_id": str(project_id),
                    "is_pinned": payload.is_pinned,
                },
                created_at=utc_now(),
                created_by="user",
            )
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _project_conversation_read(relation)


def _get_project_or_404(project_id: uuid.UUID, db: Session) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


def _project_read(project: Project, db: Session) -> ProjectRead:
    counts = project_counts(db, project.id)
    return ProjectRead(
        id=project.id,
        name=project.name,
        description=project.description,
        color=project.color,
        icon=project.icon,
        sort_order=project.sort_order,
        is_default=project.is_default,
        is_archived=project.is_archived,
        archived_at=project.archived_at,
        created_at=project.created_at,
        updated_at=project.updated_at,
        conversation_count=counts.conversation_count,
        pinned_count=counts.pinned_count,
    )


def _project_conversation_read(relation: ProjectConversation) -> ProjectConversationRead:
    conversation = _conversation_item(relation.conversation)
    return ProjectConversationRead(
        **conversation.model_dump(),
        project_relation=ProjectConversationRelationRead(
            is_pinned=relation.is_pinned,
            pinned_at=relation.pinned_at,
            added_at=relation.added_at,
            sort_order=relation.sort_order,
        ),
    )


def _not_found_status(exc: ProjectServiceError) -> int:
    return status.HTTP_404_NOT_FOUND if "not found" in str(exc).lower() else status.HTTP_400_BAD_REQUEST
