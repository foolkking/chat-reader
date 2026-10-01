import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.content_cleanup import (
    ContentCleanupException,
    ContentCleanupOccurrence,
    ContentCleanupScan,
    ContentCleanupScanRule,
    ContentCleanupScanTarget,
)
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.schemas.content_cleanup import (
    CleanupExceptionConfirm,
    CleanupRuleTrial,
    CleanupRuleLearn,
    CleanupApplyRead,
    CleanupApplyInput,
    CleanupFilteredDecision,
    CleanupDecisionBatch,
    CleanupOccurrenceRead,
    CleanupRuleCreate,
    CleanupRuleRead,
    CleanupRuleUpdate,
    CleanupScanCreate,
    CleanupScanRead,
)
from app.services.content_cleanup import (
    MANUAL_SELECTION_DETECTOR,
    apply_scan,
    create_scan,
    dismiss_scan,
    ensure_builtin_rules,
    preview_occurrences,
    recover_expired_apply,
    update_decisions,
)
from app.services.ownership import ownership_scope_from_request

router = APIRouter(prefix="/api/content-cleanup", tags=["content-cleanup"])


@router.post("/rules/trial")
def preview_rule(payload: CleanupRuleTrial, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_learning import rule_config, trial_rule
    try:
        return trial_rule(db, ownership_scope_from_request(request), rule_config(payload.model_dump()),
            rule_id=payload.rule_id, base_revision=payload.base_revision, base_revision_id=payload.base_revision_id, conversation_id=payload.conversation_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/rules/learn", response_model=CleanupRuleRead)
def learn_rule(payload: CleanupRuleLearn, request: Request, db: Session = Depends(get_db)) -> CleanupRuleRead:
    from app.services.cleanup_learning import rule_authority, rule_config, verify_preview
    scope = ownership_scope_from_request(request)
    config = rule_config(payload.model_dump())
    try:
        verify_preview(rule_authority(scope, config, payload.rule_id, payload.base_revision, payload.base_revision_id), payload.preview_token)
        if payload.rule_id:
            return update_rule(payload.rule_id, CleanupRuleUpdate(**config, base_revision=payload.base_revision, base_revision_id=payload.base_revision_id), request, db)
        return create_rule(CleanupRuleCreate(**config), request, db)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/exceptions")
def get_exceptions(request: Request, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_learning import list_exceptions
    return list_exceptions(db, ownership_scope_from_request(request), limit=limit, offset=offset)


@router.delete("/exceptions/{exception_id}", status_code=204)
def revoke_exception(exception_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> Response:
    scope = ownership_scope_from_request(request)
    item = db.query(ContentCleanupException).filter_by(id=exception_id, owner_user_id=scope.owner_user_id).first()
    if item is not None:
        db.delete(item)
        db.commit()
    return Response(status_code=204)


@router.get("/scans/{scan_id}/occurrences/{occurrence_id}/exception")
def get_exception_preview(scan_id: uuid.UUID, occurrence_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_learning import preview_exception
    try:
        return preview_exception(db, ownership_scope_from_request(request), scan_id, occurrence_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/scans/{scan_id}/occurrences/{occurrence_id}/exception", status_code=201)
def confirm_exception(scan_id: uuid.UUID, occurrence_id: uuid.UUID, payload: CleanupExceptionConfirm, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_learning import save_exception
    try:
        item = save_exception(db, ownership_scope_from_request(request), scan_id, occurrence_id, payload.preview_token)
        db.commit()
        return {"id": str(item.id)}
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/rules/scan-existing", response_model=CleanupScanRead, status_code=status.HTTP_202_ACCEPTED)
def scan_existing_conversations(request: Request, db: Session = Depends(get_db)) -> CleanupScanRead:
    """Queue one explicit review of every active project and unclassified conversation."""
    scope = ownership_scope_from_request(request)
    active_ids = [
        row[0]
        for row in db.query(Conversation.id)
        .filter(Conversation.status == "active", Conversation.deleted_at.is_(None), scope.predicate(Conversation))
        .all()
    ]
    archived_count = db.query(Conversation.id).filter(
        Conversation.status == "archived",
        Conversation.deleted_at.is_(None),
        scope.predicate(Conversation),
    ).count()
    try:
        scan, _job = create_scan(
            db,
            source="BATCH",
            scope_type="ALL_ACTIVE",
            conversation_ids=active_ids,
            excluded_archived_count=archived_count,
            ownership_scope=scope,
        )
        db.commit()
        db.refresh(scan)
        return _scan_read(db, scan)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/rules", response_model=list[CleanupRuleRead])
def list_rules(request: Request, db: Session = Depends(get_db)) -> list[CleanupRuleRead]:
    from app.services.cleanup_rule_access import available_versions, effective_revision, rule_payload
    scope = ownership_scope_from_request(request)
    ensure_builtin_rules(db)
    db.commit()
    return [CleanupRuleRead(**rule_payload(db, scope, rule, effective_revision(revisions, preference)))
        for rule, revisions, preference in available_versions(db, scope, include_disabled=True).values()]


@router.post("/rules", response_model=CleanupRuleRead, status_code=status.HTTP_201_CREATED)
def create_rule(payload: CleanupRuleCreate, request: Request, db: Session = Depends(get_db)) -> CleanupRuleRead:
    from app.services.cleanup_rule_access import learn_literal, rule_payload
    scope = ownership_scope_from_request(request)
    try:
        rule, revision = learn_literal(db, scope, **payload.model_dump())
        db.commit()
        return CleanupRuleRead(**rule_payload(db, scope, rule, revision))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/rules/{rule_id}", response_model=CleanupRuleRead)
def update_rule(rule_id: uuid.UUID, payload: CleanupRuleUpdate, request: Request, db: Session = Depends(get_db)) -> CleanupRuleRead:
    from app.services.cleanup_rule_access import rule_payload, update_personal_rule
    scope = ownership_scope_from_request(request)
    try:
        rule, revision = update_personal_rule(db, scope, rule_id, payload.model_dump(exclude_unset=True))
        db.commit()
        return CleanupRuleRead(**rule_payload(db, scope, rule, revision))
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        db.rollback()
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> Response:
    from app.services.cleanup_rule_access import hide_personal_rule
    try:
        hide_personal_rule(db, ownership_scope_from_request(request), rule_id)
        db.commit()
        return Response(status_code=204)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/rules/{rule_id}/revisions", response_model=list[CleanupRuleRead])
def rule_revisions(rule_id: uuid.UUID, request: Request, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)) -> list[CleanupRuleRead]:
    from app.services.cleanup_rule_access import available_versions, canonical_rule_id, effective_revision, rule_payload
    scope = ownership_scope_from_request(request)
    group = available_versions(db, scope, include_disabled=True).get(canonical_rule_id(db, rule_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Noise rule not found.")
    rule, revisions, preference = group
    selected = effective_revision(revisions, preference)
    unique = {}
    for revision in sorted(revisions, key=lambda item: (item.id == selected.id, item.revision, item.created_at), reverse=True):
        unique.setdefault(revision.configuration_digest or str(revision.id), revision)
    return [CleanupRuleRead(**rule_payload(db, scope, rule, revision)) for revision in list(unique.values())[offset:offset + limit]]


@router.post("/scans", response_model=CleanupScanRead, status_code=status.HTTP_202_ACCEPTED)
def start_scan(payload: CleanupScanCreate, request: Request, db: Session = Depends(get_db)) -> CleanupScanRead:
    scope = ownership_scope_from_request(request)
    conversation_ids = payload.conversation_ids
    if payload.scope_type == "ALL_ACTIVE":
        conversation_ids = [row[0] for row in db.query(Conversation.id).filter(Conversation.status == "active", Conversation.deleted_at.is_(None), scope.predicate(Conversation)).all()]
    else:
        owned_ids = {row[0] for row in db.query(Conversation.id).filter(Conversation.id.in_(conversation_ids), scope.predicate(Conversation)).all()}
        if len(owned_ids) != len(set(conversation_ids)):
            raise HTTPException(status_code=404, detail="Conversation not found.")
    if payload.scope_type == "CURRENT_CONVERSATION" and len(conversation_ids) != 1:
        raise HTTPException(status_code=422, detail="Current-conversation scans require exactly one conversation.")
    try:
        scan, _job = create_scan(
            db,
            source=payload.source,
            scope_type=payload.scope_type,
            conversation_ids=conversation_ids,
            selection_message_id=payload.message_id,
            selection_start_offset=payload.selection_start_offset,
            selection_end_offset=payload.selection_end_offset,
            selection_text=payload.selection_text,
            ownership_scope=scope,
        )
        db.commit()
        db.refresh(scan)
        return _scan_read(db, scan)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/scans/pending", response_model=list[CleanupScanRead])
def pending_scans(request: Request, db: Session = Depends(get_db)) -> list[CleanupScanRead]:
    rows = _owned_scan_query(db, request).filter(ContentCleanupScan.status.in_(("QUEUED", "SCANNING", "READY", "FAILED", "STALE", "APPLYING"))).order_by(ContentCleanupScan.created_at.desc()).all()
    return [_scan_read(db, row) for row in rows]


@router.get("/scans/{scan_id}", response_model=CleanupScanRead)
def get_scan(scan_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> CleanupScanRead:
    scan = _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first()
    if scan is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    return _scan_read(db, scan)


@router.get("/scans/{scan_id}/occurrences", response_model=list[CleanupOccurrenceRead])
def get_occurrences(
    scan_id: uuid.UUID,
    request: Request,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    rule_id: uuid.UUID | None = None,
    conversation_id: uuid.UUID | None = None,
    selected_only: bool = False,
    db: Session = Depends(get_db),
) -> list[CleanupOccurrenceRead]:
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    return [CleanupOccurrenceRead(**item) for item in preview_occurrences(db, scan_id, limit=limit, offset=offset, rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)]


@router.get("/scans/{scan_id}/groups")
def get_review_groups(scan_id: uuid.UUID, request: Request, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_review import groups
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    return groups(db, scan_id, limit=limit, offset=offset)


@router.get("/scans/{scan_id}/review")
def get_review_page(scan_id: uuid.UUID, request: Request, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), rule_id: uuid.UUID | None = None, conversation_id: uuid.UUID | None = None, selected_only: bool = False, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_review import filter_occurrences
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    query = filter_occurrences(db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id), rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)
    return {"items": [CleanupOccurrenceRead(**item) for item in preview_occurrences(db, scan_id, limit=limit, offset=offset, rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)],
        "total": query.count(), "limit": limit, "offset": offset}


@router.post("/scans/{scan_id}/rescan", response_model=CleanupScanRead, status_code=202)
def rescan_review(scan_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> CleanupScanRead:
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    scope = ownership_scope_from_request(request)
    ids = [row[0] for row in db.query(Conversation.id).join(ContentCleanupScanTarget, ContentCleanupScanTarget.conversation_id == Conversation.id).filter(
        ContentCleanupScanTarget.scan_id == scan_id, scope.predicate(Conversation), Conversation.status == "active", Conversation.deleted_at.is_(None))]
    try:
        scan, _ = create_scan(db, source="BATCH", scope_type="SELECTED_CONVERSATIONS", conversation_ids=ids, ownership_scope=scope, force_new=True)
        db.commit()
        return _scan_read(db, scan)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/scans/{scan_id}/decisions/filter")
def patch_filtered_decisions(scan_id: uuid.UUID, payload: CleanupFilteredDecision, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_review import decide_filter
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    try:
        result = decide_filter(db, scan_id, **payload.model_dump(exclude={"all_matching"}))
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/scans/{scan_id}/preview")
def get_review_preview(scan_id: uuid.UUID, request: Request, limit: int = Query(10, ge=1, le=20), offset: int = Query(0, ge=0), db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_review import preview_changes
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    return preview_changes(db, scan_id, limit=limit, offset=offset)


@router.patch("/scans/{scan_id}/decisions", response_model=CleanupScanRead)
def patch_decisions(scan_id: uuid.UUID, payload: CleanupDecisionBatch, request: Request, db: Session = Depends(get_db)) -> CleanupScanRead:
    scan = _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first()
    if scan is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    try:
        update_decisions(db, scan_id, {item.occurrence_id: item.decision for item in payload.decisions})
        db.commit()
        return _scan_read(db, scan)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/scans/{scan_id}/apply", response_model=CleanupApplyRead)
def apply(scan_id: uuid.UUID, request: Request, payload: CleanupApplyInput | None = Body(default=None), db: Session = Depends(get_db)) -> CleanupApplyRead:
    try:
        if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
            raise ValueError("Noise scan not found.")
        db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one()
        if payload and payload.preview_token:
            from app.services.cleanup_review import preview_token
            if payload.preview_token != preview_token(db, scan_id):
                raise ValueError("Review selection or source version changed. Preview the changes again.")
        result = apply_scan(db, scan_id)
        db.commit()
        return CleanupApplyRead(**result)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/scans/{scan_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(scan_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> Response:
    try:
        if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
            raise ValueError("Noise scan not found.")
        dismiss_scan(db, scan_id)
        db.commit()
        return Response(status_code=204)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _owned_scan_query(db: Session, request: Request):
    scope = ownership_scope_from_request(request)
    return (
        db.query(ContentCleanupScan)
        .join(ContentCleanupScanTarget, ContentCleanupScanTarget.scan_id == ContentCleanupScan.id)
        .join(Conversation, Conversation.id == ContentCleanupScanTarget.conversation_id)
        .filter(scope.predicate(Conversation))
        .distinct()
    )


def _scan_read(db: Session, scan: ContentCleanupScan) -> CleanupScanRead:
    scan = recover_expired_apply(db, scan)
    counts = dict(
        db.query(ContentCleanupOccurrence.decision, func.count(ContentCleanupOccurrence.id))
        .filter(ContentCleanupOccurrence.scan_id == scan.id)
        .group_by(ContentCleanupOccurrence.decision)
        .all()
    )
    return CleanupScanRead(
        id=scan.id,
        source=scan.source,
        status=scan.status,
        scope_type=scan.scope_type,
        background_job_id=scan.background_job_id,
        progress=scan.progress,
        processed_messages=scan.processed_messages,
        total_messages=scan.total_messages,
        excluded_archived_count=scan.excluded_archived_count,
        target_count=db.query(ContentCleanupScanTarget).filter(ContentCleanupScanTarget.scan_id == scan.id).count(),
        project_target_count=(
            db.query(ContentCleanupScanTarget)
            .join(ProjectConversation, ProjectConversation.conversation_id == ContentCleanupScanTarget.conversation_id)
            .join(Project, Project.id == ProjectConversation.project_id)
            .filter(ContentCleanupScanTarget.scan_id == scan.id)
            .filter(Project.is_default.is_(False))
            .count()
        ),
        unassigned_target_count=(
            db.query(ContentCleanupScanTarget)
            .filter(ContentCleanupScanTarget.scan_id == scan.id)
            .filter(~ContentCleanupScanTarget.conversation_id.in_(
                db.query(ProjectConversation.conversation_id)
                .join(Project, Project.id == ProjectConversation.project_id)
                .filter(Project.is_default.is_(False))
            ))
            .count()
        ),
        occurrence_count=sum(counts.values()),
        delete_count=counts.get("DELETE", 0),
        keep_count=counts.get("KEEP", 0),
        protected_count=counts.get("PROTECTED", 0),
        created_at=scan.created_at,
        completed_at=scan.completed_at,
        error_message=scan.error_message,
    )
