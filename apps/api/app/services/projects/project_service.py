import uuid
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.import_record import utc_now
from app.models.project import Project
from app.models.project_conversation import ProjectConversation

DEFAULT_PROJECT_NAME = "Inbox"


class ProjectServiceError(ValueError):
    pass


@dataclass(frozen=True)
class ProjectCounts:
    conversation_count: int
    pinned_count: int


def ensure_default_project(db: Session) -> Project:
    project = db.query(Project).filter(Project.is_default.is_(True)).one_or_none()
    if project is not None:
        return project

    project = db.query(Project).filter(Project.name == DEFAULT_PROJECT_NAME).one_or_none()
    if project is not None:
        project.is_default = True
        project.is_archived = False
        project.archived_at = None
        db.flush()
        return project

    project = Project(
        id=uuid.uuid4(),
        name=DEFAULT_PROJECT_NAME,
        description="Default inbox for committed conversations.",
        color="#0f172a",
        icon="inbox",
        is_default=True,
        sort_order=0,
    )
    db.add(project)
    db.flush()
    return project


def list_projects(db: Session, include_archived: bool = False) -> list[Project]:
    ensure_default_project(db)
    query = db.query(Project)
    if not include_archived:
        query = query.filter(Project.is_archived.is_(False))
    return query.order_by(Project.is_default.desc(), Project.sort_order.asc(), Project.created_at.asc()).all()


def create_project(db: Session, *, name: str, description: str | None, color: str | None, icon: str | None) -> Project:
    project = Project(
        id=uuid.uuid4(),
        name=name.strip(),
        description=description,
        color=color,
        icon=icon,
    )
    db.add(project)
    try:
        db.flush()
    except IntegrityError as exc:
        raise ProjectServiceError("Project name already exists.") from exc
    return project


def update_project(db: Session, project: Project, updates: dict) -> Project:
    if project.is_default and updates.get("is_archived") is True:
        raise ProjectServiceError("Default project cannot be archived.")

    for field in ("name", "description", "color", "icon", "sort_order"):
        if field in updates and updates[field] is not None:
            setattr(project, field, updates[field])
    if "is_archived" in updates and updates["is_archived"] is not None:
        project.is_archived = updates["is_archived"]
        project.archived_at = utc_now() if project.is_archived else None
    project.updated_at = utc_now()
    try:
        db.flush()
    except IntegrityError as exc:
        raise ProjectServiceError("Project name already exists.") from exc
    return project


def archive_project(db: Session, project: Project) -> Project:
    return update_project(db, project, {"is_archived": True})


def add_conversation_to_project(
    db: Session,
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    *,
    added_by: str = "system",
) -> ProjectConversation:
    project = db.get(Project, project_id)
    if project is None:
        raise ProjectServiceError("Project not found.")
    conversation = db.get(Conversation, conversation_id)
    if conversation is None or conversation.deleted_at is not None:
        raise ProjectServiceError("Conversation not found.")

    relation = _get_relation(db, project_id, conversation_id)
    if relation is not None:
        return relation

    relation = ProjectConversation(
        id=uuid.uuid4(),
        project_id=project_id,
        conversation_id=conversation_id,
        added_by=added_by,
    )
    db.add(relation)
    db.flush()
    return relation


def remove_conversation_from_project(db: Session, project_id: uuid.UUID, conversation_id: uuid.UUID) -> None:
    relation = _get_relation(db, project_id, conversation_id)
    if relation is None:
        raise ProjectServiceError("Project conversation relation not found.")
    db.delete(relation)
    db.flush()


def list_project_conversations(
    db: Session,
    project_id: uuid.UUID,
    *,
    limit: int,
    offset: int,
) -> list[ProjectConversation]:
    if db.get(Project, project_id) is None:
        raise ProjectServiceError("Project not found.")
    return (
        db.query(ProjectConversation)
        .join(ProjectConversation.conversation)
        .filter(
            ProjectConversation.project_id == project_id,
            Conversation.deleted_at.is_(None),
            Conversation.status.in_(("active", "archived")),
        )
        .order_by(
            ProjectConversation.is_pinned.desc(),
            ProjectConversation.pinned_at.desc(),
            ProjectConversation.sort_order.asc(),
            ProjectConversation.added_at.desc(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )


def set_project_conversation_pin(
    db: Session,
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    pinned: bool,
) -> ProjectConversation:
    relation = _get_relation(db, project_id, conversation_id)
    if relation is None:
        raise ProjectServiceError("Project conversation relation not found.")
    relation.is_pinned = pinned
    relation.pinned_at = utc_now() if pinned else None
    db.flush()
    return relation


def project_counts(db: Session, project_id: uuid.UUID) -> ProjectCounts:
    conversation_count = (
        db.query(func.count(ProjectConversation.id))
        .filter(ProjectConversation.project_id == project_id)
        .scalar()
        or 0
    )
    pinned_count = (
        db.query(func.count(ProjectConversation.id))
        .filter(ProjectConversation.project_id == project_id, ProjectConversation.is_pinned.is_(True))
        .scalar()
        or 0
    )
    return ProjectCounts(conversation_count=conversation_count, pinned_count=pinned_count)


def _get_relation(db: Session, project_id: uuid.UUID, conversation_id: uuid.UUID) -> ProjectConversation | None:
    return (
        db.query(ProjectConversation)
        .filter(
            ProjectConversation.project_id == project_id,
            ProjectConversation.conversation_id == conversation_id,
        )
        .one_or_none()
    )
