import uuid
from dataclasses import dataclass

from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.import_record import utc_now
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.recent_item import RecentItem
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, OwnershipScope, get_owned, owned_query

DEFAULT_PROJECT_NAME = "Inbox"
PLACEMENT_GAP = 1024


class ProjectServiceError(ValueError):
    pass


@dataclass(frozen=True)
class ProjectCounts:
    conversation_count: int
    pinned_count: int


@dataclass(frozen=True)
class ConversationPlacementResult:
    relation: ProjectConversation
    source_project_id: uuid.UUID | None
    target_project_id: uuid.UUID
    changed: bool


def ensure_default_project(
    db: Session,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> Project:
    project = owned_query(db, Project, ownership_scope).filter(Project.is_default.is_(True)).one_or_none()
    if project is not None:
        return project

    project = owned_query(db, Project, ownership_scope).filter(Project.name == DEFAULT_PROJECT_NAME).one_or_none()
    if project is not None:
        project.is_default = True
        project.is_archived = False
        project.archived_at = None
        db.flush()
        return project

    project = Project(
        id=uuid.uuid4(),
        owner_user_id=ownership_scope.owner_user_id,
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


def list_projects(
    db: Session,
    include_archived: bool = False,
    *,
    sort: str = "recent_read",
    direction: str = "desc",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> list[Project]:
    ensure_default_project(db, ownership_scope)
    query = owned_query(db, Project, ownership_scope)
    if not include_archived:
        query = query.filter(Project.is_archived.is_(False))
    field = {
        "recent_read": Project.last_read_at,
        "updated": Project.updated_at,
        "created": Project.created_at,
        "title": func.lower(Project.name),
        "custom": Project.sort_order,
    }.get(sort)
    if sort == "conversation_count":
        field = (
            db.query(func.count(ProjectConversation.id))
            .join(Conversation, Conversation.id == ProjectConversation.conversation_id)
            .filter(
                ProjectConversation.project_id == Project.id,
                ownership_scope.predicate(Conversation),
                Conversation.deleted_at.is_(None),
                Conversation.status == "active",
            )
            .correlate(Project)
            .scalar_subquery()
        )
    assert field is not None
    ordered_field = field.asc() if sort == "custom" or direction == "asc" else field.desc()
    return query.order_by(
        Project.is_default.desc(),
        case((field.is_(None), 1), else_=0).asc(),
        ordered_field,
        Project.updated_at.desc(),
        Project.id.asc(),
    ).all()


def create_project(
    db: Session,
    *,
    name: str,
    description: str | None,
    color: str | None,
    icon: str | None,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> Project:
    clean_name = name.strip()
    if owned_query(db, Project, ownership_scope).filter(Project.name == clean_name).first() is not None:
        raise ProjectServiceError("Project name already exists.")
    last_sort_order = (
        db.query(func.max(Project.sort_order))
        .filter(
            ownership_scope.predicate(Project),
            Project.is_default.is_(False),
            Project.is_archived.is_(False),
        )
        .scalar()
    )
    project = Project(
        id=uuid.uuid4(),
        owner_user_id=ownership_scope.owner_user_id,
        name=clean_name,
        description=description,
        color=color,
        icon=icon,
        sort_order=int(last_sort_order or 0) + PLACEMENT_GAP,
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

    if "name" in updates and updates["name"] is not None:
        duplicate = db.query(Project).filter(
            Project.owner_user_id == project.owner_user_id,
            Project.name == updates["name"],
            Project.id != project.id,
        ).first()
        if duplicate is not None:
            raise ProjectServiceError("Project name already exists.")

    for field in ("name", "description", "color", "icon", "sort_order"):
        if field in updates and updates[field] is not None:
            setattr(project, field, updates[field])
    if "is_archived" in updates and updates["is_archived"] is not None:
        project.is_archived = updates["is_archived"]
        project.archived_at = utc_now() if project.is_archived else None
    project.updated_at = utc_now()
    if "name" in updates or "is_archived" in updates:
        for relation in project.conversations:
            relation.conversation.offline_revision += 1
    try:
        db.flush()
    except IntegrityError as exc:
        raise ProjectServiceError("Project name already exists.") from exc
    return project


def archive_project(db: Session, project: Project) -> Project:
    return update_project(db, project, {"is_archived": True})


def delete_archived_project(
    db: Session,
    project: Project,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> None:
    """Delete an archived project container without deleting its conversations."""
    if project.is_default:
        raise ProjectServiceError("Default project cannot be deleted.")
    if not project.is_archived:
        raise ProjectServiceError("Project must be archived before deletion.")

    default_project = ensure_default_project(db, ownership_scope)
    relations = (
        db.query(ProjectConversation)
        .filter(ProjectConversation.project_id == project.id)
        .with_for_update()
        .order_by(ProjectConversation.sort_order.asc(), ProjectConversation.id.asc())
        .all()
    )
    next_order = _append_sort_order(db, default_project.id, False)
    now = utc_now()
    for relation in relations:
        relation.project_id = default_project.id
        relation.sort_order = next_order
        relation.is_pinned = False
        relation.pinned_at = None
        relation.added_at = now
        relation.added_by = "project_delete"
        next_order += PLACEMENT_GAP

        conversation = relation.conversation
        conversation.offline_revision += 1
        conversation.updated_at = now
        recent = db.query(RecentItem).filter(RecentItem.conversation_id == conversation.id).one_or_none()
        if recent is not None:
            recent.project_id = None
        db.add(
            ConversationEvent(
                id=uuid.uuid4(),
                conversation_id=conversation.id,
                event_type="project_placement_changed",
                payload={
                    "source_project_id": str(project.id),
                    "target_project_id": None,
                    "target_section": "normal",
                    "sort_order": relation.sort_order,
                    "reason": "project_deleted",
                },
                created_by="user",
            )
        )

    db.query(RecentItem).filter(RecentItem.project_id == project.id).update(
        {RecentItem.project_id: None}, synchronize_session=False
    )
    db.flush()
    db.query(Project).filter(Project.id == project.id).delete(synchronize_session=False)
    db.flush()


def add_conversation_to_project(
    db: Session,
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    *,
    added_by: str = "system",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ProjectConversation:
    return move_conversation_to_project(
        db,
        conversation_id=conversation_id,
        project_id=project_id,
        added_by=added_by,
        ownership_scope=ownership_scope,
    )


def move_conversation_to_project(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    project_id: uuid.UUID | None,
    added_by: str = "user",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ProjectConversation:
    if project_id is None:
        project_id = ensure_default_project(db, ownership_scope).id
    project = get_owned(db, Project, project_id, ownership_scope)
    if project is None or project.is_archived:
        raise ProjectServiceError("Project not found.")
    conversation = get_owned(db, Conversation, conversation_id, ownership_scope)
    if conversation is None or conversation.deleted_at is not None:
        raise ProjectServiceError("Conversation not found.")

    current = (
        db.query(ProjectConversation)
        .filter(ProjectConversation.conversation_id == conversation_id)
        .one_or_none()
    )
    if current is not None and current.project_id == project_id:
        return current
    if conversation.status != "active":
        if added_by not in {"system", "archive"} or conversation.status not in {"importing", "processing"}:
            raise ProjectServiceError("Conversation not found or is not active.")
        if current is not None:
            current.project_id = project.id
            current.is_pinned = False
            current.pinned_at = None
            return current
        relation = ProjectConversation(
            id=uuid.uuid4(),
            project_id=project.id,
            conversation_id=conversation.id,
            added_by=added_by,
            sort_order=_append_sort_order(db, project.id, False),
            is_pinned=False,
        )
        db.add(relation)
        db.flush()
        return relation
    return place_conversation(
        db,
        conversation_id=conversation_id,
        target_project_id=None if project.is_default else project.id,
        target_section="normal",
        before_conversation_id=None,
        after_conversation_id=None,
        expected_offline_revision=None,
        added_by=added_by,
        ownership_scope=ownership_scope,
    ).relation


def place_conversation(
    db: Session,
    *,
    conversation_id: uuid.UUID,
    target_project_id: uuid.UUID | None,
    target_section: str,
    before_conversation_id: uuid.UUID | None,
    after_conversation_id: uuid.UUID | None,
    expected_offline_revision: int | None,
    added_by: str = "user",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ConversationPlacementResult:
    conversation = (
        db.query(Conversation)
        .filter(ownership_scope.predicate(Conversation), Conversation.id == conversation_id)
        .with_for_update()
        .one_or_none()
    )
    if conversation is None or conversation.deleted_at is not None or conversation.status != "active":
        raise ProjectServiceError("Conversation not found or is not active.")
    if expected_offline_revision is not None and conversation.offline_revision != expected_offline_revision:
        raise ProjectServiceError("Conversation revision conflict.")
    if target_section not in {"pinned", "normal"}:
        raise ProjectServiceError("Invalid target section.")

    default_project = ensure_default_project(db, ownership_scope)
    resolved_project_id = target_project_id or default_project.id
    project = get_owned(db, Project, resolved_project_id, ownership_scope)
    if project is None or project.is_archived:
        raise ProjectServiceError("Project not found.")

    relation = (
        db.query(ProjectConversation)
        .filter(ProjectConversation.conversation_id == conversation_id)
        .with_for_update()
        .one_or_none()
    )
    source_project_id = relation.project_id if relation is not None else None
    cross_project = source_project_id != resolved_project_id
    if cross_project and target_section == "pinned":
        raise ProjectServiceError("Cross-project moves must target the normal section.")
    desired_pinned = target_section == "pinned"

    if (
        relation is not None
        and not cross_project
        and not before_conversation_id
        and not after_conversation_id
    ):
        return ConversationPlacementResult(
            relation=relation,
            source_project_id=source_project_id,
            target_project_id=resolved_project_id,
            changed=False,
        )
    if relation is not None and not cross_project and relation.is_pinned != desired_pinned:
        raise ProjectServiceError("Pinned state must be changed with the pin action.")

    sort_order = _resolve_conversation_sort_order(
        db,
        project_id=resolved_project_id,
        is_pinned=desired_pinned,
        moving_conversation_id=conversation_id,
        before_conversation_id=before_conversation_id,
        after_conversation_id=after_conversation_id,
        ownership_scope=ownership_scope,
    )
    if relation is None:
        relation = ProjectConversation(
            id=uuid.uuid4(),
            project_id=resolved_project_id,
            conversation_id=conversation_id,
            added_by=added_by,
            sort_order=sort_order,
            is_pinned=desired_pinned,
            pinned_at=utc_now() if desired_pinned else None,
        )
        db.add(relation)
    else:
        relation.project_id = resolved_project_id
        relation.sort_order = sort_order
        if cross_project:
            relation.is_pinned = False
            relation.pinned_at = None
            relation.added_at = utc_now()
            relation.added_by = added_by

    recent = db.query(RecentItem).filter(RecentItem.conversation_id == conversation_id).one_or_none()
    if recent is not None:
        recent.project_id = None if project.is_default else project.id
    conversation.offline_revision += 1
    conversation.updated_at = utc_now()
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation.id,
            event_type="project_placement_changed",
            payload={
                "source_project_id": str(source_project_id) if source_project_id else None,
                "target_project_id": None if project.is_default else str(project.id),
                "target_section": target_section,
                "sort_order": sort_order,
            },
            created_by=added_by,
        )
    )
    db.flush()
    return ConversationPlacementResult(
        relation=relation,
        source_project_id=source_project_id,
        target_project_id=resolved_project_id,
        changed=True,
    )


def remove_conversation_from_project(
    db: Session,
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> None:
    relation = _get_relation(db, project_id, conversation_id, ownership_scope)
    if relation is None:
        raise ProjectServiceError("Project conversation relation not found.")
    default_project = ensure_default_project(db, ownership_scope)
    if relation.project_id == default_project.id:
        return
    move_conversation_to_project(
        db,
        conversation_id=conversation_id,
        project_id=default_project.id,
        added_by="user",
        ownership_scope=ownership_scope,
    )


def list_project_conversations(
    db: Session,
    project_id: uuid.UUID,
    *,
    limit: int,
    offset: int,
    sort: str = "recent_read",
    direction: str = "desc",
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> list[ProjectConversation]:
    if get_owned(db, Project, project_id, ownership_scope) is None:
        raise ProjectServiceError("Project not found.")
    query = (
        db.query(ProjectConversation)
        .options(
            selectinload(ProjectConversation.conversation).selectinload(Conversation.recent_item),
            selectinload(ProjectConversation.conversation)
            .selectinload(Conversation.project_links)
            .selectinload(ProjectConversation.project),
        )
        .join(ProjectConversation.conversation)
        .outerjoin(RecentItem, RecentItem.conversation_id == Conversation.id)
        .filter(
            ProjectConversation.project_id == project_id,
            ownership_scope.predicate(Conversation),
            Conversation.deleted_at.is_(None),
            Conversation.status == "active",
        )
    )
    field = {
        "recent_read": RecentItem.last_opened_at,
        "updated": Conversation.updated_at,
        "created": Conversation.created_at,
        "imported": Conversation.imported_at,
        "title": func.lower(Conversation.display_title),
        "message_count": Conversation.message_count,
        "custom": ProjectConversation.sort_order,
    }[sort]
    ordered_field = field.asc() if sort == "custom" or direction == "asc" else field.desc()
    return (
        query.order_by(*(
            (
                ProjectConversation.is_pinned.desc(),
                ProjectConversation.sort_order.asc(),
                Conversation.id.asc(),
            )
            if sort == "custom"
            else (
                ProjectConversation.is_pinned.desc(),
                ProjectConversation.pinned_at.desc(),
                case((field.is_(None), 1), else_=0).asc(),
                ordered_field,
                Conversation.sort_time.desc(),
                Conversation.id.asc(),
            )
        ))
        .offset(offset)
        .limit(limit)
        .all()
    )


def record_project_recent(
    db: Session,
    project_id: uuid.UUID,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> Project:
    project = get_owned(db, Project, project_id, ownership_scope)
    if project is None or project.is_archived:
        raise ProjectServiceError("Project not found.")
    project.last_read_at = utc_now()
    db.flush()
    return project


def set_project_conversation_pin(
    db: Session,
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    pinned: bool,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ProjectConversation:
    relation = _get_relation(db, project_id, conversation_id, ownership_scope)
    if relation is None:
        raise ProjectServiceError("Project conversation relation not found.")
    relation.is_pinned = pinned
    relation.pinned_at = utc_now() if pinned else None
    db.flush()
    return relation


def project_counts(
    db: Session,
    project_id: uuid.UUID,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ProjectCounts:
    if get_owned(db, Project, project_id, ownership_scope) is None:
        return ProjectCounts(conversation_count=0, pinned_count=0)
    conversation_count = (
        db.query(func.count(ProjectConversation.id))
        .join(Conversation, Conversation.id == ProjectConversation.conversation_id)
        .filter(
            ProjectConversation.project_id == project_id,
            ownership_scope.predicate(Conversation),
            Conversation.deleted_at.is_(None),
            Conversation.status == "active",
        )
        .scalar()
        or 0
    )
    pinned_count = (
        db.query(func.count(ProjectConversation.id))
        .join(Conversation, Conversation.id == ProjectConversation.conversation_id)
        .filter(
            ProjectConversation.project_id == project_id,
            ownership_scope.predicate(Conversation),
            ProjectConversation.is_pinned.is_(True),
            Conversation.deleted_at.is_(None),
            Conversation.status == "active",
        )
        .scalar()
        or 0
    )
    return ProjectCounts(conversation_count=conversation_count, pinned_count=pinned_count)


def project_counts_many(
    db: Session,
    project_ids: list[uuid.UUID],
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> dict[uuid.UUID, ProjectCounts]:
    """Load active conversation and pinned counts for several projects in one query."""
    if not project_ids:
        return {}
    rows = (
        db.query(
            ProjectConversation.project_id,
            func.count(ProjectConversation.id),
            func.count(case((ProjectConversation.is_pinned.is_(True), ProjectConversation.id))),
        )
        .join(Conversation, Conversation.id == ProjectConversation.conversation_id)
        .filter(
            ProjectConversation.project_id.in_(project_ids),
            ownership_scope.predicate(Conversation),
            Conversation.deleted_at.is_(None),
            Conversation.status == "active",
        )
        .group_by(ProjectConversation.project_id)
        .all()
    )
    counts = {
        project_id: ProjectCounts(conversation_count=int(conversation_count or 0), pinned_count=int(pinned_count or 0))
        for project_id, conversation_count, pinned_count in rows
    }
    return {
        project_id: counts.get(project_id, ProjectCounts(conversation_count=0, pinned_count=0))
        for project_id in project_ids
    }


def _get_relation(
    db: Session,
    project_id: uuid.UUID,
    conversation_id: uuid.UUID,
    ownership_scope: OwnershipScope,
) -> ProjectConversation | None:
    return (
        db.query(ProjectConversation)
        .join(Project, Project.id == ProjectConversation.project_id)
        .join(Conversation, Conversation.id == ProjectConversation.conversation_id)
        .filter(
            ProjectConversation.project_id == project_id,
            ProjectConversation.conversation_id == conversation_id,
            ownership_scope.predicate(Project),
            ownership_scope.predicate(Conversation),
        )
        .one_or_none()
    )


def _append_sort_order(db: Session, project_id: uuid.UUID, is_pinned: bool) -> int:
    current = db.query(func.max(ProjectConversation.sort_order)).filter(
        ProjectConversation.project_id == project_id,
        ProjectConversation.is_pinned.is_(is_pinned),
    ).scalar()
    return int(current or 0) + PLACEMENT_GAP


def place_project(
    db: Session,
    *,
    project_id: uuid.UUID,
    before_project_id: uuid.UUID | None,
    after_project_id: uuid.UUID | None,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> Project:
    project = (
        owned_query(db, Project, ownership_scope)
        .filter(Project.id == project_id)
        .with_for_update()
        .one_or_none()
    )
    if project is None or project.is_default or project.is_archived:
        raise ProjectServiceError("Project not found or cannot be reordered.")
    project.sort_order = _resolve_project_sort_order(
        db,
        moving_project_id=project.id,
        before_project_id=before_project_id,
        after_project_id=after_project_id,
        ownership_scope=ownership_scope,
    )
    project.updated_at = utc_now()
    db.flush()
    return project


def _resolve_conversation_sort_order(
    db: Session,
    *,
    project_id: uuid.UUID,
    is_pinned: bool,
    moving_conversation_id: uuid.UUID,
    before_conversation_id: uuid.UUID | None,
    after_conversation_id: uuid.UUID | None,
    ownership_scope: OwnershipScope,
) -> int:
    def rows() -> list[ProjectConversation]:
        return (
            db.query(ProjectConversation)
            .join(Conversation, Conversation.id == ProjectConversation.conversation_id)
            .filter(
                ProjectConversation.project_id == project_id,
                ProjectConversation.is_pinned.is_(is_pinned),
                ProjectConversation.conversation_id != moving_conversation_id,
                ownership_scope.predicate(Conversation),
                Conversation.status == "active",
                Conversation.deleted_at.is_(None),
            )
            .order_by(ProjectConversation.sort_order.asc(), ProjectConversation.conversation_id.asc())
            .with_for_update()
            .all()
        )

    ordered = rows()
    lower, upper = _anchor_bounds(
        ordered,
        before_id=before_conversation_id,
        after_id=after_conversation_id,
        id_getter=lambda row: row.conversation_id,
        order_getter=lambda row: row.sort_order,
    )
    if lower is not None and upper is not None and upper - lower <= 1:
        for index, row in enumerate(ordered, start=1):
            row.sort_order = index * PLACEMENT_GAP
        db.flush()
        ordered = rows()
        lower, upper = _anchor_bounds(
            ordered,
            before_id=before_conversation_id,
            after_id=after_conversation_id,
            id_getter=lambda row: row.conversation_id,
            order_getter=lambda row: row.sort_order,
        )
    return _order_between(lower, upper)


def _resolve_project_sort_order(
    db: Session,
    *,
    moving_project_id: uuid.UUID,
    before_project_id: uuid.UUID | None,
    after_project_id: uuid.UUID | None,
    ownership_scope: OwnershipScope,
) -> int:
    def rows() -> list[Project]:
        return (
            db.query(Project)
            .filter(
                ownership_scope.predicate(Project),
                Project.id != moving_project_id,
                Project.is_default.is_(False),
                Project.is_archived.is_(False),
            )
            .order_by(Project.sort_order.asc(), Project.id.asc())
            .with_for_update()
            .all()
        )

    ordered = rows()
    lower, upper = _anchor_bounds(
        ordered,
        before_id=before_project_id,
        after_id=after_project_id,
        id_getter=lambda row: row.id,
        order_getter=lambda row: row.sort_order,
    )
    if lower is not None and upper is not None and upper - lower <= 1:
        for index, row in enumerate(ordered, start=1):
            row.sort_order = index * PLACEMENT_GAP
        db.flush()
        ordered = rows()
        lower, upper = _anchor_bounds(
            ordered,
            before_id=before_project_id,
            after_id=after_project_id,
            id_getter=lambda row: row.id,
            order_getter=lambda row: row.sort_order,
        )
    return _order_between(lower, upper)


def _anchor_bounds(rows, *, before_id, after_id, id_getter, order_getter) -> tuple[int | None, int | None]:
    by_id = {id_getter(row): row for row in rows}
    if before_id is not None and before_id not in by_id:
        raise ProjectServiceError("Before anchor is not in the target section.")
    if after_id is not None and after_id not in by_id:
        raise ProjectServiceError("After anchor is not in the target section.")
    before_order = order_getter(by_id[before_id]) if before_id is not None else None
    after_order = order_getter(by_id[after_id]) if after_id is not None else None
    if before_order is not None and after_order is not None and after_order >= before_order:
        raise ProjectServiceError("Placement anchors are out of order.")
    if before_order is not None and after_order is None:
        earlier = [order_getter(row) for row in rows if order_getter(row) < before_order]
        after_order = max(earlier, default=None)
    if after_order is not None and before_order is None:
        later = [order_getter(row) for row in rows if order_getter(row) > after_order]
        before_order = min(later, default=None)
    if before_order is None and after_order is None and rows:
        after_order = max(order_getter(row) for row in rows)
    return after_order, before_order


def _order_between(lower: int | None, upper: int | None) -> int:
    if lower is None and upper is None:
        return PLACEMENT_GAP
    if lower is None:
        assert upper is not None
        return upper - PLACEMENT_GAP
    if upper is None:
        return lower + PLACEMENT_GAP
    if upper - lower <= 1:
        raise ProjectServiceError("Unable to allocate a stable sort position.")
    return lower + (upper - lower) // 2
