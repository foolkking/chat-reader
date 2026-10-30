import hashlib
import json
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Request, status
from sqlalchemy import case, func, or_, text
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.conversation_split import ConversationSplitReceipt
from app.models.annotation import ConversationAnnotation
from app.models.attachment import Attachment
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.models.render_block import RenderBlock
from app.models.recent_item import RecentItem
from app.schemas.conversation import (
    ConversationCreateRequest,
    ConversationCreateResponse,
    ConversationDetail,
    ConversationListItem,
    ConversationOrderUpdate,
    ConversationPlacementRead,
    ConversationPlacementRequest,
    ConversationPlacementResponse,
    DuplicateReviewGroup,
    DuplicateReviewResponse,
    DuplicateReviewConversation,
    ConversationUpdate,
    MessageInsertRequest,
    MessageInsertResponse,
)
from app.schemas.editing import (
    ConversationEventListResponse,
    ConversationEventRead,
    ConversationMergeRequest,
    ConversationSplitRequest,
    ConversationSplitGroupPreview,
    ConversationSplitWorkspacePreview,
    ConversationSplitWorkspaceRequest,
    ConversationSplitWorkspaceResponse,
    ConversationTransformResponse,
)
from app.schemas.message import (
    DialogueIndexItem,
    DialogueIndexResponse,
    LocatorTargetRequest,
    MessageListItem,
    MessageVersionRead,
    RenderBlockRead,
    ResolvedLocatorResponse,
    ReaderTurnResponse,
)
from app.schemas.project import ConversationPinUpdate
from app.schemas.search import MessageWindowResponse
from app.schemas.task import BackgroundTaskRead, ConversationBatchDeleteRequest, ConversationBatchDeleteRequestRead, ConversationMergeRequestRead, ConversationProjectMoveRequest
from app.models.import_record import utc_now
from app.services.conversation_revision import bump_offline_revision
from app.services.editing.message_edit_service import (
    MessageEditError,
    create_manual_conversation,
    execute_conversation_split,
    insert_manual_messages,
    plan_conversation_split,
    split_conversation,
)
from app.services.background_jobs import find_conversation_batch_delete_request, find_conversation_merge_request, queue_conversation_batch_delete, queue_conversation_merge, queue_conversation_derived_rebuild
from app.services.projects.project_service import (
    ProjectServiceError,
    add_conversation_to_project,
    ensure_default_project,
    move_conversation_to_project,
    place_conversation,
    project_counts,
    remove_conversation_from_project,
)
from app.services.reader_preview import dialogue_preview
from app.services.reader_turns import ReaderTurnHydrationError, load_reader_turn
from app.services.reader_locator import resolve_reader_locator
from app.api.routes.tasks import background_job_read
from app.services.conversations.conversation_deletion import delete_conversation_record
from app.services.ownership import OwnershipScope, get_owned, ownership_scope_from_request, subject_key_from_request

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.post("", response_model=ConversationCreateResponse, status_code=status.HTTP_201_CREATED)
def create_conversation_endpoint(
    payload: ConversationCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationCreateResponse:
    ownership_scope = ownership_scope_from_request(request)
    try:
        result = create_manual_conversation(
            db,
            title=payload.title,
            user_text=payload.messages[0].content_markdown,
            assistant_text=payload.messages[1].content_markdown,
            project_id=payload.project_id,
            ownership_scope=ownership_scope,
        )
        db.commit()
        db.refresh(result.conversation)
    except (MessageEditError, ProjectServiceError) as exc:
        db.rollback()
        detail = exc.detail if isinstance(exc, MessageEditError) else str(exc)
        raise HTTPException(status_code=getattr(exc, "status_code", 422), detail=detail) from exc
    return ConversationCreateResponse(
        conversation=_conversation_detail(result.conversation),
        messages=[_message_item(message, True, db, ordinal=index + 1) for index, message in enumerate(result.messages)],
    )


@router.post("/{conversation_id}/messages/insert", response_model=MessageInsertResponse, status_code=status.HTTP_201_CREATED)
def insert_message_endpoint(
    conversation_id: uuid.UUID,
    payload: MessageInsertRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MessageInsertResponse:
    scope = ownership_scope_from_request(request)
    _managed_conversation_or_404(db, conversation_id, scope)
    try:
        messages = [
            (item.role or "", item.content_markdown)
            for item in payload.messages
        ]
        result = insert_manual_messages(
            db,
            conversation_id=conversation_id,
            anchor_message_id=payload.anchor_message_id,
            position=payload.position,
            mode=payload.mode,
            messages=messages,
            expected_offline_revision=payload.expected_offline_revision,
        )
        queue_conversation_derived_rebuild(db, conversation_id=conversation_id,
            idempotency_key=f"message-insert:{result.messages[0].id}", ownership_scope=scope, rebuild_versions=False)
        db.commit()
        db.refresh(result.conversation)
    except (MessageEditError, ProjectServiceError) as exc:
        db.rollback()
        detail = exc.detail if isinstance(exc, MessageEditError) else str(exc)
        raise HTTPException(status_code=getattr(exc, "status_code", 422), detail=detail) from exc
    return MessageInsertResponse(
        conversation=_conversation_detail(result.conversation),
        messages=[_message_item(message, True, db) for message in result.messages],
    )


@router.get("", response_model=list[ConversationListItem])
def list_conversations(
    request: Request,
    limit: int = Query(default=50, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    source_type: str | None = None,
    source_profile: str | None = None,
    q: str = Query(default="", max_length=200),
    include_archived: bool = False,
    status_scope: str | None = Query(default=None, pattern="^(active|archived|all)$"),
    scope: str = Query(default="all", pattern="^(all|history)$"),
    sort: str = Query(
        default="recent_read",
        pattern="^(recent_read|updated|created|imported|title|message_count|custom)$",
    ),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> list[ConversationListItem]:
    ownership_scope = ownership_scope_from_request(request)
    query = (
        db.query(Conversation)
        .filter(ownership_scope.predicate(Conversation))
        .outerjoin(RecentItem, RecentItem.conversation_id == Conversation.id)
        .options(
            selectinload(Conversation.recent_item),
            selectinload(Conversation.project_links).selectinload(ProjectConversation.project),
        )
    )
    if q.strip():
        query = query.filter(or_(
            Conversation.display_title.icontains(q.strip(), autoescape=True),
            Conversation.title.icontains(q.strip(), autoescape=True),
        ))
    if status_scope == "active":
        query = query.filter(Conversation.status == "active", Conversation.deleted_at.is_(None))
    elif status_scope == "archived":
        query = query.filter(Conversation.status == "archived", Conversation.deleted_at.is_(None))
    elif status_scope == "all":
        query = query.filter(Conversation.status.in_(("active", "archived")), Conversation.deleted_at.is_(None))
    else:
        query = query.filter(
            Conversation.deleted_at.is_(None),
            Conversation.status.in_(("active", "archived")),
        )
        if not include_archived:
            query = query.filter(Conversation.status != "archived")
    if scope == "history":
        query = (
            query.outerjoin(ProjectConversation, ProjectConversation.conversation_id == Conversation.id)
            .outerjoin(Project, Project.id == ProjectConversation.project_id)
            .filter(
                (ProjectConversation.id.is_(None))
                | (Project.is_default.is_(True))
                | (Project.is_archived.is_(True))
            )
        )
    if source_type:
        query = query.filter(Conversation.source_type == source_type)
    if source_profile:
        query = query.filter(Conversation.source_profile == source_profile)
    conversations = (
        query.order_by(*_conversation_sort_order(sort, direction))
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_conversation_item(conversation) for conversation in conversations]


@router.get("/duplicates", response_model=DuplicateReviewResponse)
def list_duplicate_reviews(
    request: Request,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_scope: str = Query(default="all", pattern="^(active|archived|all)$"),
    db: Session = Depends(get_db),
) -> DuplicateReviewResponse:
    """Return exact content-hash groups for review without merge/delete actions."""
    scope = ownership_scope_from_request(request)
    base_filters = [
        scope.predicate(Conversation),
        Conversation.deleted_at.is_(None),
        Conversation.content_hash.is_not(None),
    ]
    if status_scope == "active":
        base_filters.append(Conversation.status == "active")
    elif status_scope == "archived":
        base_filters.append(Conversation.status == "archived")
    else:
        base_filters.append(Conversation.status.in_(("active", "archived")))

    grouped = (
        db.query(
            Conversation.content_hash.label("content_hash"),
            func.count(Conversation.id).label("group_count"),
        )
        .filter(*base_filters)
        .group_by(Conversation.content_hash)
        .having(func.count(Conversation.id) > 1)
        .order_by(func.count(Conversation.id).desc(), Conversation.content_hash.asc())
    )
    group_summary = grouped.order_by(None).subquery()
    total_groups, total_conversations = db.query(
        func.count(), func.coalesce(func.sum(group_summary.c.group_count), 0)
    ).select_from(group_summary).one()
    total_groups, total_conversations = int(total_groups), int(total_conversations)
    page_rows = grouped.offset(offset).limit(limit).all()
    page_hashes = [row.content_hash for row in page_rows]
    if not page_hashes:
        return DuplicateReviewResponse(
            groups=[],
            total_groups=total_groups,
            total_conversations=total_conversations,
            limit=limit,
            offset=offset,
            has_more=offset < total_groups,
        )

    conversations = (
        db.query(Conversation)
        .filter(*base_filters, Conversation.content_hash.in_(page_hashes))
        .options(selectinload(Conversation.project_links).selectinload(ProjectConversation.project))
        .order_by(
            Conversation.content_hash.asc(),
            Conversation.updated_at.desc().nullslast(),
            Conversation.imported_at.desc(),
            Conversation.id.asc(),
        )
        .all()
    )
    conversation_ids = [conversation.id for conversation in conversations]
    attachment_counts = dict(
        db.query(Attachment.conversation_id, func.count(Attachment.id))
        .filter(
            Attachment.conversation_id.in_(conversation_ids),
            Attachment.deleted_at.is_(None),
            Attachment.status != "detached",
        )
        .group_by(Attachment.conversation_id)
        .all()
    )
    annotation_counts = dict(
        db.query(ConversationAnnotation.conversation_id, func.count(ConversationAnnotation.id))
        .filter(
            ConversationAnnotation.conversation_id.in_(conversation_ids),
            ConversationAnnotation.subject_key == subject_key_from_request(request),
            ConversationAnnotation.is_deleted.is_(False),
        )
        .group_by(ConversationAnnotation.conversation_id)
        .all()
    )
    by_hash: dict[str, list[DuplicateReviewConversation]] = {str(value): [] for value in page_hashes}
    for conversation in conversations:
        project_id, project_name = _conversation_project_summary(conversation)
        by_hash[str(conversation.content_hash)].append(
            DuplicateReviewConversation(
                id=conversation.id,
                title=conversation.title,
                display_title=conversation.display_title,
                status=conversation.status,
                content_hash=conversation.content_hash,
                message_count=conversation.message_count,
                turn_count=conversation.turn_count,
                created_at=conversation.created_at,
                updated_at=conversation.updated_at,
                imported_at=conversation.imported_at,
                project_id=project_id,
                project_name=project_name,
                attachment_count=int(attachment_counts.get(conversation.id, 0)),
                annotation_count=int(annotation_counts.get(conversation.id, 0)),
            )
        )
    groups = [
        DuplicateReviewGroup(
            content_hash=str(row.content_hash),
            count=int(row.group_count),
            conversations=by_hash.get(str(row.content_hash), []),
        )
        for row in page_rows
    ]
    return DuplicateReviewResponse(
        groups=groups,
        total_groups=total_groups,
        total_conversations=total_conversations,
        limit=limit,
        offset=offset,
        has_more=offset + len(page_rows) < total_groups,
    )


@router.put("/order", status_code=status.HTTP_204_NO_CONTENT)
def update_conversation_order(
    payload: ConversationOrderUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    ownership_scope = ownership_scope_from_request(request)
    rows = db.query(Conversation).filter(
        ownership_scope.predicate(Conversation), Conversation.id.in_(payload.conversation_ids)
    ).all()
    if len(rows) != len(set(payload.conversation_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    by_id = {row.id: row for row in rows}
    for index, conversation_id in enumerate(payload.conversation_ids):
        by_id[conversation_id].manual_sort_order = index
    db.commit()


@router.post("/merge", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def merge_conversations_endpoint(
    payload: ConversationMergeRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
) -> BackgroundTaskRead:
    ownership_scope = ownership_scope_from_request(request)
    try:
        job = queue_conversation_merge(
            db=db,
            conversation_ids=payload.conversation_ids,
            title=payload.title,
            project_id=payload.project_id,
            idempotency_key=idempotency_key,
            ownership_scope=ownership_scope,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return background_job_read(job)


@router.get("/merge/requests/{request_key}", response_model=ConversationMergeRequestRead)
def get_conversation_merge_request(
    request: Request,
    request_key: str = Path(min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> ConversationMergeRequestRead:
    job = find_conversation_merge_request(db, request_key, ownership_scope_from_request(request))
    return ConversationMergeRequestRead(
        found=job is not None, task=background_job_read(job) if job is not None else None,
    )


@router.get("/batch-delete/requests/{request_key}", response_model=ConversationBatchDeleteRequestRead)
def get_conversation_batch_delete_request(
    request: Request,
    request_key: str = Path(min_length=1, max_length=200),
    db: Session = Depends(get_db),
) -> ConversationBatchDeleteRequestRead:
    job = find_conversation_batch_delete_request(db, request_key, ownership_scope_from_request(request))
    return ConversationBatchDeleteRequestRead(
        found=job is not None, task=background_job_read(job) if job is not None else None,
    )


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)
) -> ConversationDetail:
    conversation = _managed_conversation_or_404(
        db, conversation_id, ownership_scope_from_request(request)
    )
    return ConversationDetail(
        **_conversation_item(conversation).model_dump(),
        external_source_id=conversation.external_source_id,
        parser_version=conversation.parser_version,
        render_version=conversation.render_version,
        content_hash=conversation.content_hash,
        sort_time=conversation.sort_time,
    )


@router.patch("/{conversation_id}", response_model=ConversationDetail)
def update_conversation(
    conversation_id: uuid.UUID,
    payload: ConversationUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = _managed_conversation_or_404(
        db, conversation_id, ownership_scope_from_request(request)
    )

    event_payload: dict[str, object] = {}
    if "description_markdown" in payload.model_fields_set:
        description = payload.description_markdown.strip() or None if payload.description_markdown else None
        if description != conversation.description_markdown:
            conversation.description_markdown = description
            bump_offline_revision(conversation)
            conversation.updated_at = utc_now()
            _add_conversation_event(
                db,
                conversation.id,
                "conversation_description_updated",
                {"description_markdown": description},
            )
    if payload.title is not None or payload.display_title is not None:
        title = (payload.title if payload.title is not None else payload.display_title or "").strip()
        display_title = (payload.display_title if payload.display_title is not None else payload.title or "").strip()
        if not title and not display_title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Conversation title cannot be empty.")
        previous_title = conversation.title
        previous_display_title = conversation.display_title
        conversation.title = title or display_title
        conversation.display_title = display_title or title
        conversation.updated_at = utc_now()
        bump_offline_revision(conversation)
        event_payload.update(
            {
                "previous_title": previous_title,
                "previous_display_title": previous_display_title,
                "title": conversation.title,
                "display_title": conversation.display_title,
            }
        )

    if payload.status is not None:
        if payload.status not in {"active", "archived"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid conversation status.")
        _set_conversation_status(db, conversation, payload.status)

    if event_payload:
        _add_conversation_event(db, conversation.id, "conversation_renamed", event_payload)
    db.commit()
    return _conversation_detail(conversation)


@router.post("/{conversation_id}/archive", response_model=ConversationDetail)
def archive_conversation(
    conversation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)
) -> ConversationDetail:
    conversation = _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    _set_conversation_status(db, conversation, "archived")
    db.commit()
    return _conversation_detail(conversation)


@router.post("/{conversation_id}/unarchive", response_model=ConversationDetail)
def unarchive_conversation(
    conversation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)
) -> ConversationDetail:
    ownership_scope = ownership_scope_from_request(request)
    conversation = _managed_conversation_or_404(db, conversation_id, ownership_scope)
    _set_conversation_status(db, conversation, "active")
    _ensure_active_project_membership(db, conversation, ownership_scope)
    db.commit()
    return _conversation_detail(conversation)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: uuid.UUID, request: Request, db: Session = Depends(get_db)
) -> None:
    try:
        delete_conversation_record(db, conversation_id, ownership_scope_from_request(request))
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/batch-delete", response_model=BackgroundTaskRead, status_code=status.HTTP_202_ACCEPTED)
def queue_batch_delete(
    payload: ConversationBatchDeleteRequest,
    request: Request,
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> BackgroundTaskRead:
    ownership_scope = ownership_scope_from_request(request)
    try:
        job = queue_conversation_batch_delete(
            db,
            conversation_ids=payload.conversation_ids,
            idempotency_key=idempotency_key,
            ownership_scope=ownership_scope,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return background_job_read(job)


@router.put("/{conversation_id}/placement", response_model=ConversationPlacementResponse)
def place_conversation_route(
    conversation_id: uuid.UUID,
    payload: ConversationPlacementRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationPlacementResponse:
    ownership_scope = ownership_scope_from_request(request)
    try:
        result = place_conversation(
            db,
            conversation_id=conversation_id,
            target_project_id=payload.target_project_id,
            target_section=payload.target_section,
            before_conversation_id=payload.before_conversation_id,
            after_conversation_id=payload.after_conversation_id,
            expected_offline_revision=payload.expected_offline_revision,
            ownership_scope=ownership_scope,
        )
        default_project = ensure_default_project(db, ownership_scope)
        source_count = (
            project_counts(db, result.source_project_id, ownership_scope).conversation_count
            if result.source_project_id
            else 0
        )
        target_count = project_counts(db, result.target_project_id, ownership_scope).conversation_count
        unclassified_count = project_counts(db, default_project.id, ownership_scope).conversation_count
        conversation = result.relation.conversation
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        message = str(exc)
        code = status.HTTP_409_CONFLICT if "revision conflict" in message.lower() else status.HTTP_422_UNPROCESSABLE_ENTITY
        raise HTTPException(status_code=code, detail=message) from exc
    target_project = result.relation.project
    public_project_id = None if target_project.is_default else target_project.id
    return ConversationPlacementResponse(
        conversation=_conversation_item(conversation),
        placement=ConversationPlacementRead(
            project_id=public_project_id,
            target_section="pinned" if result.relation.is_pinned else "normal",
            sort_order=result.relation.sort_order,
            is_pinned=result.relation.is_pinned,
            offline_revision=conversation.offline_revision,
        ),
        source_project_count=source_count,
        target_project_count=target_count,
        unclassified_count=unclassified_count,
    )


@router.post("/{conversation_id}/split", response_model=ConversationTransformResponse)
def split_conversation_endpoint(
    conversation_id: uuid.UUID,
    payload: ConversationSplitRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationTransformResponse:
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    try:
        result = split_conversation(
            db=db,
            conversation_id=conversation_id,
            start_message_id=payload.start_message_id,
            end_message_id=payload.end_message_id,
            title=payload.title,
            project_id=payload.project_id,
        )
        db.commit()
    except MessageEditError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return ConversationTransformResponse(
        conversation_id=result.conversation.id,
        title=result.conversation.title,
        display_title=result.conversation.display_title,
        message_count=result.message_count,
    )


@router.post("/{conversation_id}/split-workspace/preview", response_model=ConversationSplitWorkspacePreview)
def preview_split_workspace(
    conversation_id: uuid.UUID,
    payload: ConversationSplitWorkspaceRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationSplitWorkspacePreview:
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    try:
        groups = plan_conversation_split(
            db,
            conversation_id=conversation_id,
            mode=payload.mode,
            start_message_id=payload.start_message_id,
            end_message_id=payload.end_message_id,
            boundary_message_id=payload.boundary_message_id,
            message_ids=payload.message_ids,
        )
    except MessageEditError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return ConversationSplitWorkspacePreview(
        mode=payload.mode,
        groups=[ConversationSplitGroupPreview(
            message_ids=[message.id for message in group.messages],
            message_count=len(group.messages),
            suggested_title=group.suggested_title,
        ) for group in groups],
    )


@router.post("/{conversation_id}/split-workspace/requests", response_model=ConversationSplitWorkspaceResponse)
def execute_keyed_split_workspace(
    conversation_id: uuid.UUID,
    payload: ConversationSplitWorkspaceRequest,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=128),
    db: Session = Depends(get_db),
) -> ConversationSplitWorkspaceResponse:
    # A distinct endpoint fails closed on older API images instead of silently
    # ignoring a new client's key and creating a duplicate during rollback.
    return execute_split_workspace(conversation_id, payload, request, idempotency_key=idempotency_key, db=db)


@router.post("/{conversation_id}/split-workspace", response_model=ConversationSplitWorkspaceResponse)
def execute_split_workspace(
    conversation_id: uuid.UUID,
    payload: ConversationSplitWorkspaceRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", min_length=1, max_length=128),
    db: Session = Depends(get_db),
) -> ConversationSplitWorkspaceResponse:
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    try:
        payload_data = payload.model_dump(mode="json", exclude_none=True)
        request_digest = hashlib.sha256(
            json.dumps(payload_data, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        if idempotency_key:
            if db.bind is not None and db.bind.dialect.name == "postgresql":
                lock_material = f"conversation-split:{conversation_id}:{idempotency_key}"
                lock_id = int.from_bytes(hashlib.sha256(lock_material.encode("utf-8")).digest()[:8], "big", signed=True)
                db.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": lock_id})
            # A competing write may have retired access while this request
            # waited for the operation lock. Never disclose a stale receipt.
            _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
            receipt = db.query(ConversationSplitReceipt).filter_by(
                conversation_id=conversation_id,
                idempotency_key=idempotency_key,
            ).one_or_none()
            if receipt is not None:
                if receipt.request_digest != request_digest:
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail={
                        "code": "SPLIT_IDEMPOTENCY_CONFLICT",
                        "message": "Idempotency key was already used for a different split request.",
                    })
                return ConversationSplitWorkspaceResponse.model_validate(receipt.response)
        groups = plan_conversation_split(
            db,
            conversation_id=conversation_id,
            mode=payload.mode,
            start_message_id=payload.start_message_id,
            end_message_id=payload.end_message_id,
            boundary_message_id=payload.boundary_message_id,
            message_ids=payload.message_ids,
        )
        results = execute_conversation_split(
            db,
            conversation_id=conversation_id,
            mode=payload.mode,
            groups=groups,
            titles=payload.titles,
            project_id=payload.project_id,
        )
        response = ConversationSplitWorkspaceResponse(
            mode=payload.mode,
            conversations=[ConversationTransformResponse(
                conversation_id=result.conversation.id,
                title=result.conversation.title,
                display_title=result.conversation.display_title,
                message_count=result.message_count,
            ) for result in results],
        )
        if idempotency_key:
            db.add(ConversationSplitReceipt(
                conversation_id=conversation_id,
                idempotency_key=idempotency_key,
                request_digest=request_digest,
                response=response.model_dump(mode="json"),
            ))
        db.commit()
    except (MessageEditError, ProjectServiceError) as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    return response


@router.post("/{conversation_id}/projects/{project_id}", response_model=ConversationDetail)
def add_conversation_project_membership(
    conversation_id: uuid.UUID,
    project_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    ownership_scope = ownership_scope_from_request(request)
    conversation = _managed_conversation_or_404(db, conversation_id, ownership_scope)
    try:
        add_conversation_to_project(
            db, project_id, conversation_id, added_by="user", ownership_scope=ownership_scope
        )
        _add_conversation_event(
            db,
            conversation_id,
            "project_changed",
            {"action": "added", "project_id": str(project_id)},
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _conversation_detail(conversation)


@router.put("/{conversation_id}/project", response_model=ConversationDetail)
def move_conversation_project(
    conversation_id: uuid.UUID,
    payload: ConversationProjectMoveRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    ownership_scope = ownership_scope_from_request(request)
    conversation = _managed_conversation_or_404(db, conversation_id, ownership_scope)
    if conversation.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only active conversations can be moved.",
        )
    try:
        relation = move_conversation_to_project(
            db,
            conversation_id=conversation_id,
            project_id=payload.project_id,
            added_by="user",
            ownership_scope=ownership_scope,
        )
        _add_conversation_event(
            db,
            conversation_id,
            "project_changed",
            {"action": "moved", "project_id": str(relation.project_id)},
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return _conversation_detail(conversation)


@router.delete("/{conversation_id}/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_conversation_project_membership(
    conversation_id: uuid.UUID,
    project_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    ownership_scope = ownership_scope_from_request(request)
    _managed_conversation_or_404(db, conversation_id, ownership_scope)
    try:
        remove_conversation_from_project(db, project_id, conversation_id, ownership_scope)
        _add_conversation_event(
            db,
            conversation_id,
            "project_changed",
            {"action": "removed", "project_id": str(project_id)},
        )
        db.commit()
    except ProjectServiceError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{conversation_id}/events", response_model=ConversationEventListResponse)
def list_conversation_events(
    conversation_id: uuid.UUID,
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    event_type: str | None = None,
    lineage_only: bool = False,
    db: Session = Depends(get_db),
) -> ConversationEventListResponse:
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    query = db.query(ConversationEvent).filter(ConversationEvent.conversation_id == conversation_id)
    if event_type:
        query = query.filter(ConversationEvent.event_type == event_type)
    if lineage_only:
        query = query.filter(ConversationEvent.event_type.in_([
            "conversation_merged", "conversation_merged_into",
            "conversation_split", "conversation_created_from_split",
        ]))
    total = query.count()
    events = (
        query.order_by(ConversationEvent.created_at.desc(), ConversationEvent.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return ConversationEventListResponse(
        items=[
            ConversationEventRead(
                id=event.id,
                event_type=event.event_type,
                target_message_id=event.target_message_id,
                target_version_id=event.target_version_id,
                payload=event.payload,
                created_at=event.created_at,
                created_by=event.created_by,
            )
            for event in events
        ],
        limit=limit,
        offset=offset,
        total=total,
    )


@router.patch("/{conversation_id}/pin", response_model=ConversationDetail)
def set_conversation_pin(
    conversation_id: uuid.UUID,
    payload: ConversationPinUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> ConversationDetail:
    conversation = _managed_conversation_or_404(
        db, conversation_id, ownership_scope_from_request(request)
    )
    conversation.is_global_pinned = payload.is_pinned
    conversation.global_pinned_at = utc_now() if payload.is_pinned else None
    _add_conversation_event(
        db,
        conversation.id,
        "pin_changed",
        {"scope": "global", "is_pinned": payload.is_pinned},
    )
    db.commit()
    return _conversation_detail(conversation)


@router.get("/{conversation_id}/messages", response_model=list[MessageListItem])
def list_conversation_messages(
    conversation_id: uuid.UUID,
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_blocks: bool = False,
    db: Session = Depends(get_db),
) -> list[MessageListItem]:
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_message_item(message, include_blocks, db) for message in messages]


@router.get("/{conversation_id}/dialogue-index", response_model=DialogueIndexResponse)
def get_dialogue_index(
    conversation_id: uuid.UUID,
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=80, ge=1, le=5000),
    anchor_message_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
) -> DialogueIndexResponse:
    conversation = _managed_conversation_or_404(
        db, conversation_id, ownership_scope_from_request(request)
    )
    base_query = db.query(Message).filter(
        Message.conversation_id == conversation_id,
        Message.is_deleted.is_(False),
    )
    total = base_query.count()
    if anchor_message_id is not None:
        anchor = base_query.filter(Message.id == anchor_message_id).one_or_none()
        if anchor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anchor message not found.")
        before_anchor = base_query.filter(Message.order_key < anchor.order_key).count()
        offset = max(0, min(max(total - limit, 0), before_anchor - limit // 2))
    rows = (
        db.query(
            Message.id,
            Message.role,
            Message.order_key,
            Message.turn_index,
            func.substr(MessageVersion.display_text, 1, 8000).label("display_preview"),
        )
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
        .order_by(Message.order_key.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    role_counts: dict[str, int] = {}
    if rows and offset > 0:
        role_counts = {
            role: count
            for role, count in (
                db.query(Message.role, func.count(Message.id))
                .filter(
                    Message.conversation_id == conversation_id,
                    Message.is_deleted.is_(False),
                    Message.order_key < rows[0].order_key,
                )
                .group_by(Message.role)
                .all()
            )
        }
    items: list[DialogueIndexItem] = []
    for ordinal, row in enumerate(rows, start=offset + 1):
        role_counts[row.role] = role_counts.get(row.role, 0) + 1
        items.append(
            DialogueIndexItem(
                message_id=row.id,
                role=row.role,
                role_number=role_counts[row.role],
                ordinal=ordinal,
                order_key=row.order_key,
                turn_index=row.turn_index,
                preview=dialogue_preview(row.display_preview or "", row.role),
            )
        )
    return DialogueIndexResponse(
        conversation_id=conversation_id,
        items=items,
        message_count=total,
        turn_count=conversation.turn_count,
        limit=limit,
        offset=offset,
        total=total,
        has_previous=offset > 0,
        has_more=offset + len(items) < total,
    )


@router.get("/{conversation_id}/message-window", response_model=MessageWindowResponse)
def get_message_window(
    conversation_id: uuid.UUID,
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    include_blocks: bool = False,
    after_order_key: str | None = None,
    before_order_key: str | None = None,
    anchor_message_id: uuid.UUID | None = None,
    anchor_order_key: str | None = None,
    anchor_before: int | None = Query(default=None, ge=0, le=199),
    content_mode: str = Query(default="full", pattern="^(full|preview)$"),
    db: Session = Depends(get_db),
) -> MessageWindowResponse:
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    query = db.query(Message).filter(Message.conversation_id == conversation_id, Message.is_deleted.is_(False))
    if after_order_key:
        query = query.filter(Message.order_key > after_order_key)
    if before_order_key:
        query = query.filter(Message.order_key < before_order_key)
    total = query.count()
    if anchor_message_id is not None or anchor_order_key is not None:
        if anchor_before is not None and anchor_before >= limit:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="anchor_before must be smaller than limit.",
            )
        anchor_order = _anchor_order_key(
            db=db,
            conversation_id=conversation_id,
            anchor_message_id=anchor_message_id,
            anchor_order_key=anchor_order_key,
            after_order_key=after_order_key,
            before_order_key=before_order_key,
        )
        before_anchor = query.filter(Message.order_key < anchor_order).count()
        effective_anchor_before = min(anchor_before if anchor_before is not None else 12, limit - 1)
        offset = max(0, min(max(total - limit, 0), before_anchor - effective_anchor_before))
    messages = query.order_by(Message.order_key.asc()).offset(offset).limit(limit).all()
    return MessageWindowResponse(
        items=[
            _message_item(message, include_blocks, db, ordinal=offset + index + 1, content_mode=content_mode)
            for index, message in enumerate(messages)
        ],
        limit=limit,
        offset=offset,
        total=total,
        has_previous=offset > 0,
        has_more=offset + len(messages) < total,
    )


def _anchor_order_key(
    db: Session,
    conversation_id: uuid.UUID,
    anchor_message_id: uuid.UUID | None,
    anchor_order_key: str | None,
    after_order_key: str | None,
    before_order_key: str | None,
) -> str:
    base_query = db.query(Message).filter(
        Message.conversation_id == conversation_id,
        Message.is_deleted.is_(False),
    )
    if after_order_key:
        base_query = base_query.filter(Message.order_key > after_order_key)
    if before_order_key:
        base_query = base_query.filter(Message.order_key < before_order_key)

    if anchor_message_id is not None:
        message = base_query.filter(Message.id == anchor_message_id).one_or_none()
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anchor message not found.")
        return message.order_key

    assert anchor_order_key is not None
    exists = base_query.filter(Message.order_key == anchor_order_key).first()
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anchor message not found.")
    return anchor_order_key


def _conversation_item(conversation: Conversation) -> ConversationListItem:
    project_id, project_name = _conversation_project_summary(conversation)
    return ConversationListItem(
        id=conversation.id,
        title=conversation.title,
        display_title=conversation.display_title,
        source_type=conversation.source_type,
        source_profile=conversation.source_profile,
        message_count=conversation.message_count,
        turn_count=conversation.turn_count,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        imported_at=conversation.imported_at,
        first_user_message=conversation.first_user_message,
        description_markdown=conversation.description_markdown,
        project_id=project_id,
        project_name=project_name,
        offline_revision=conversation.offline_revision,
        status=conversation.status,
        is_global_pinned=conversation.is_global_pinned,
        global_pinned_at=conversation.global_pinned_at,
        last_read_at=conversation.recent_item.last_opened_at if conversation.recent_item else None,
        reading_progress=_reading_progress(conversation.recent_item.context) if conversation.recent_item else None,
        manual_sort_order=conversation.manual_sort_order,
    )


def _conversation_project_summary(conversation: Conversation) -> tuple[uuid.UUID | None, str | None]:
    for relation in conversation.project_links:
        project = relation.project
        if project is not None and not project.is_default and not project.is_archived:
            return project.id, project.name
    return None, None


@router.get("/{conversation_id}/reader-turn", response_model=ReaderTurnResponse)
def get_reader_turn(
    conversation_id: uuid.UUID,
    request: Request,
    anchor_message_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
) -> ReaderTurnResponse:
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    try:
        return load_reader_turn(db, conversation_id, anchor_message_id)
    except ReaderTurnHydrationError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.post("/{conversation_id}/resolve-locator", response_model=ResolvedLocatorResponse)
def resolve_locator_endpoint(
    conversation_id: uuid.UUID,
    payload: LocatorTargetRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ResolvedLocatorResponse:
    """Resolve a navigation target against canonical message/version/block rows."""
    _managed_conversation_or_404(db, conversation_id, ownership_scope_from_request(request))
    return resolve_reader_locator(db, conversation_id, payload)


def _reading_progress(context: dict | None) -> float | None:
    raw = (context or {}).get("progress")
    if not isinstance(raw, (int, float)):
        return None
    return max(0.0, min(100.0, float(raw)))


def _conversation_sort_order(sort: str, direction: str) -> tuple:
    field = {
        "recent_read": RecentItem.last_opened_at,
        "updated": Conversation.updated_at,
        "created": Conversation.created_at,
        "imported": Conversation.imported_at,
        "title": func.lower(Conversation.display_title),
        "message_count": Conversation.message_count,
        "custom": Conversation.manual_sort_order,
    }[sort]
    ordered_field = field.asc() if direction == "asc" else field.desc()
    return (
        Conversation.is_global_pinned.desc(),
        Conversation.global_pinned_at.desc(),
        case((field.is_(None), 1), else_=0).asc(),
        ordered_field,
        Conversation.sort_time.desc(),
        Conversation.imported_at.desc(),
        Conversation.id.asc(),
    )


def _conversation_detail(conversation: Conversation) -> ConversationDetail:
    return ConversationDetail(
        **_conversation_item(conversation).model_dump(),
        external_source_id=conversation.external_source_id,
        parser_version=conversation.parser_version,
        render_version=conversation.render_version,
        content_hash=conversation.content_hash,
        sort_time=conversation.sort_time,
    )


def _add_conversation_event(
    db: Session,
    conversation_id: uuid.UUID,
    event_type: str,
    payload: dict,
) -> None:
    db.add(
        ConversationEvent(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            event_type=event_type,
            payload=payload,
            created_by="user",
        )
    )


def _managed_conversation_or_404(
    db: Session,
    conversation_id: uuid.UUID,
    ownership_scope: OwnershipScope,
) -> Conversation:
    conversation = get_owned(db, Conversation, conversation_id, ownership_scope)
    if conversation is None or conversation.deleted_at is not None or conversation.status == "deleted":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return conversation


def _set_conversation_status(
    db: Session,
    conversation: Conversation,
    next_status: str,
) -> None:
    if next_status not in {"active", "archived"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid conversation status.")
    if conversation.status == "deleted" or conversation.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    if conversation.status == next_status and (next_status != "active" or conversation.deleted_at is None):
        return
    previous_status = conversation.status
    conversation.status = next_status
    if next_status == "active":
        conversation.deleted_at = None
    conversation.updated_at = utc_now()
    bump_offline_revision(conversation)
    _add_conversation_event(
        db,
        conversation.id,
        "conversation_archived" if next_status == "archived" else "conversation_restored",
        {"previous_status": previous_status, "status": next_status},
    )


def _ensure_active_project_membership(
    db: Session,
    conversation: Conversation,
    ownership_scope: OwnershipScope,
) -> None:
    relation = (
        db.query(ProjectConversation)
        .filter(ProjectConversation.conversation_id == conversation.id)
        .one_or_none()
    )
    if relation is not None and relation.project is not None and not relation.project.is_archived:
        return
    move_conversation_to_project(
        db,
        conversation_id=conversation.id,
        project_id=None,
        added_by="system",
        ownership_scope=ownership_scope,
    )


def _message_item(
    message: Message,
    include_blocks: bool,
    db: Session,
    *,
    ordinal: int | None = None,
    content_mode: str = "full",
) -> MessageListItem:
    version = _current_version(message, db)
    blocks = _render_blocks(version.id, db) if include_blocks and version else []
    truncate_content = bool(version and content_mode == "preview" and message.is_heavy and not include_blocks)
    preview = " ".join((version.display_text if version else "").split())[:500] if truncate_content else None
    return MessageListItem(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        order_key=message.order_key,
        turn_index=message.turn_index,
        created_at=message.created_at,
        current_version=_version_read(version, truncate=truncate_content) if version else None,
        render_blocks=blocks,
        block_count=message.block_count,
        char_count=message.char_count,
        is_heavy=message.is_heavy,
        ordinal=ordinal,
        content_preview=preview,
        content_truncated=truncate_content,
    )


def _current_version(message: Message, db: Session) -> MessageVersion | None:
    if message.current_version_id is None:
        return None
    return db.get(MessageVersion, message.current_version_id)


def _version_read(version: MessageVersion, *, truncate: bool = False) -> MessageVersionRead:
    return MessageVersionRead(
        id=version.id,
        version_number=version.version_number,
        plain_text=version.plain_text[:500] if truncate else version.plain_text,
        display_text=version.display_text[:500] if truncate else version.display_text,
        blocks=[] if truncate else version.blocks,
        edit_type=version.edit_type,
        created_at=version.created_at,
        created_by=version.created_by,
        content_hash=version.content_hash,
    )


def _render_blocks(version_id: uuid.UUID, db: Session) -> list[RenderBlockRead]:
    blocks = (
        db.query(RenderBlock)
        .filter(RenderBlock.message_version_id == version_id)
        .order_by(RenderBlock.block_index.asc())
        .all()
    )
    return [_block_read(block) for block in blocks]


def _block_read(block: RenderBlock) -> RenderBlockRead:
    return RenderBlockRead(
        id=block.id,
        block_index=block.block_index,
        block_type=block.block_type,
        plain_text=block.plain_text,
        data=block.data,
        char_count=block.char_count,
        collapsed_by_default=block.collapsed_by_default,
        render_priority=block.render_priority,
    )
