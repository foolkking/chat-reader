import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.routes.conversations import _conversation_item
from app.core.database import get_db
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.import_record import utc_now
from app.schemas.project import (
    ProjectConversationPinUpdate,
    ProjectConversationRead,
    ProjectConversationRelationRead,
    ProjectConversationOrderUpdate,
    ProjectCreate,
    ProjectOrderUpdate,
    ProjectPlacementRequest,
    ProjectRead,
    ProjectUpdate,
)
from app.services.projects.project_service import (
    ProjectServiceError,
    add_conversation_to_project,
    create_project,
    delete_archived_project,
    list_project_conversations,
    list_projects,
    place_project,
    project_counts,
    project_counts_many,
    record_project_recent,
    remove_conversation_from_project,
    set_project_conversation_pin,
    update_project,
)
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectRead])
def get_projects(
    request: Request,
    include_archived: bool = False,
    sort: str = Query(
        default="recent_read",
        pattern="^(recent_read|updated|created|title|conversation_count|custom)$",
    ),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> list[ProjectRead]:
    ownership_scope = ownership_scope_from_request(request)
    projects = list_projects(
        db,
        include_archived=include_archived,
        sort=sort,
        direction=direction,
        ownership_scope=ownership_scope,
    )
    db.commit()
    counts = project_counts_many(db, [project.id for project in projects], ownership_scope)
    return [_project_read(project, db, ownership_scope, counts=counts.get(project.id)) for project in projects]


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project_route(payload: ProjectCreate, request: Request, db: Session = Depends(get_db)) -> ProjectRead:
    ownership_scope = ownership_scope_from_request(request)
    try:
        project = create_project(
            db,
            name=payload.name,
            description=payload.description,
            color=payload.color,
            icon=payload.icon,
            ownership_scope=ownership_scope,
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _project_read(project, db, ownership_scope)


@router.patch("/{project_id}", response_model=ProjectRead)
def update_project_route(
    project_id: uuid.UUID, payload: ProjectUpdate, request: Request, db: Session = Depends(get_db)
) -> ProjectRead:
    ownership_scope = ownership_scope_from_request(request)
    project = _get_project_or_404(project_id, db, ownership_scope)
    try:
        update_project(db, project, payload.model_dump(exclude_unset=True))
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return _project_read(project, db, ownership_scope)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_route(project_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> None:
    ownership_scope = ownership_scope_from_request(request)
    project = _get_project_or_404(project_id, db, ownership_scope)
    try:
        delete_archived_project(db, project, ownership_scope)
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc


@router.put("/{project_id}/placement", response_model=ProjectRead)
def place_project_route(
    project_id: uuid.UUID,
    payload: ProjectPlacementRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ProjectRead:
    ownership_scope = ownership_scope_from_request(request)
    try:
        project = place_project(
            db,
            project_id=project_id,
            before_project_id=payload.before_project_id,
            after_project_id=payload.after_project_id,
            ownership_scope=ownership_scope,
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return _project_read(project, db, ownership_scope)


@router.get("/{project_id}/conversations", response_model=list[ProjectConversationRead])
def get_project_conversations(
    project_id: uuid.UUID,
    request: Request,
    limit: int = Query(default=50, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    sort: str = Query(
        default="recent_read",
        pattern="^(recent_read|updated|created|imported|title|message_count|custom)$",
    ),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> list[ProjectConversationRead]:
    ownership_scope = ownership_scope_from_request(request)
    try:
        relations = list_project_conversations(
            db,
            project_id,
            limit=limit,
            offset=offset,
            sort=sort,
            direction=direction,
            ownership_scope=ownership_scope,
        )
    except ProjectServiceError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return [_project_conversation_read(relation) for relation in relations]


@router.put("/order", status_code=status.HTTP_204_NO_CONTENT)
def update_project_order(payload: ProjectOrderUpdate, request: Request, db: Session = Depends(get_db)) -> None:
    ownership_scope = ownership_scope_from_request(request)
    rows = db.query(Project).filter(
        ownership_scope.predicate(Project), Project.id.in_(payload.project_ids)
    ).all()
    if len(rows) != len(set(payload.project_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    by_id = {row.id: row for row in rows}
    for index, project_id in enumerate(payload.project_ids):
        by_id[project_id].sort_order = index
    db.commit()


@router.post("/{project_id}/recent", response_model=ProjectRead)
def record_project_recent_route(project_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> ProjectRead:
    ownership_scope = ownership_scope_from_request(request)
    try:
        project = record_project_recent(db, project_id, ownership_scope)
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _project_read(project, db, ownership_scope)


@router.put("/{project_id}/conversations/order", status_code=status.HTTP_204_NO_CONTENT)
def update_project_conversation_order(
    project_id: uuid.UUID,
    payload: ProjectConversationOrderUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    ownership_scope = ownership_scope_from_request(request)
    _get_project_or_404(project_id, db, ownership_scope)
    rows = db.query(ProjectConversation).join(Conversation, Conversation.id == ProjectConversation.conversation_id).filter(
        ProjectConversation.project_id == project_id,
        ProjectConversation.conversation_id.in_(payload.conversation_ids),
        ownership_scope.predicate(Conversation),
    ).all()
    if len(rows) != len(set(payload.conversation_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project conversation not found.")
    by_id = {row.conversation_id: row for row in rows}
    for index, conversation_id in enumerate(payload.conversation_ids):
        by_id[conversation_id].sort_order = index
    db.commit()


@router.post("/{project_id}/conversations/{conversation_id}", response_model=ProjectConversationRead)
def add_project_conversation(
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> ProjectConversationRead:
    ownership_scope = ownership_scope_from_request(request)
    try:
        relation = add_conversation_to_project(
            db, project_id, conversation_id, added_by="user", ownership_scope=ownership_scope
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=_not_found_status(exc), detail=str(exc)) from exc
    return _project_conversation_read(relation)


@router.delete("/{project_id}/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_conversation(
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    ownership_scope = ownership_scope_from_request(request)
    try:
        remove_conversation_from_project(db, project_id, conversation_id, ownership_scope)
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{project_id}/conversations/{conversation_id}/pin", response_model=ProjectConversationRead)
def pin_project_conversation(
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    payload: ProjectConversationPinUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> ProjectConversationRead:
    ownership_scope = ownership_scope_from_request(request)
    try:
        relation = set_project_conversation_pin(
            db, project_id, conversation_id, payload.is_pinned, ownership_scope
        )
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


def _get_project_or_404(project_id: uuid.UUID, db: Session, ownership_scope: OwnershipScope) -> Project:
    project = get_owned(db, Project, project_id, ownership_scope)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return project


def _project_read(project: Project, db: Session, ownership_scope: OwnershipScope, *, counts=None) -> ProjectRead:
    counts = counts or project_counts(db, project.id, ownership_scope)
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
        last_read_at=project.last_read_at,
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
