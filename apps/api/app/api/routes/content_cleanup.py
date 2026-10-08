import uuid

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_
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
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
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
            rule_id=payload.rule_id, base_revision=payload.base_revision, base_revision_id=payload.base_revision_id, base_edit_token=payload.base_edit_token, conversation_id=payload.conversation_id)
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
        base_edit_token = payload.base_edit_token
        if payload.rule_id and base_edit_token is None:
            # Legacy clients may omit the returned base. Recompute it for signature
            # verification; a change since trial must invalidate that signature.
            from app.services.cleanup_rule_access import current_rule, personal_edit_token
            rule, revision, _ = current_rule(db, scope, payload.rule_id)
            base_edit_token = personal_edit_token(db, scope, rule, revision)
        verify_preview(rule_authority(scope, config, payload.rule_id, payload.base_revision, payload.base_revision_id, base_edit_token), payload.preview_token)
        if payload.rule_id:
            return update_rule(payload.rule_id, CleanupRuleUpdate(**config, base_revision=payload.base_revision, base_revision_id=payload.base_revision_id, base_edit_token=base_edit_token), request, db)
        return create_rule(CleanupRuleCreate(**config), request, db)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
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
        preview = preview_exception(db, ownership_scope_from_request(request), scan_id, occurrence_id)
        return {**preview, "scan": _scan_read(db, db.get(ContentCleanupScan, scan_id)).model_dump(mode="json")}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/scans/{scan_id}/occurrences/{occurrence_id}/exception", status_code=201)
def confirm_exception(scan_id: uuid.UUID, occurrence_id: uuid.UUID, payload: CleanupExceptionConfirm, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_learning import save_exception
    try:
        item = save_exception(db, ownership_scope_from_request(request), scan_id, occurrence_id, payload.preview_token)
        result = {"id": str(item.id), "scan": _scan_read(db, db.get(ContentCleanupScan, scan_id)).model_dump(mode="json")}
        db.commit()
        return result
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/rules/scan-existing", response_model=CleanupScanRead, status_code=status.HTTP_202_ACCEPTED)
def scan_existing_conversations(request: Request, db: Session = Depends(get_db), idempotency_key: uuid.UUID | None = Header(default=None)) -> CleanupScanRead:
    """Queue one explicit review of every active project and unclassified conversation."""
    from app.services.cleanup_scan_requests import queue_global_scan
    try:
        scan, _job = queue_global_scan(db, ownership_scope_from_request(request), idempotency_key)
        if scan is None:
            raise HTTPException(status_code=409, detail="This scan request already has a task. Check its result in the task center.")
        result = _scan_read(db, scan)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/rules/scan-existing/requests/{request_id}")
def get_scan_request(request_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_scan_requests import find_request
    job = find_request(db, ownership_scope_from_request(request), request_id)
    if job is None:
        return {"found": False}
    scan = db.query(ContentCleanupScan).filter_by(background_job_id=job.id).first()
    return {"found": True, "job_id": str(job.id), "status": job.status,
        "scan": _scan_read(db, scan).model_dump(mode="json") if scan else None}


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
        result = CleanupRuleRead(**rule_payload(db, scope, rule, revision))
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/rules/{rule_id}", response_model=CleanupRuleRead)
def update_rule(rule_id: uuid.UUID, payload: CleanupRuleUpdate, request: Request, db: Session = Depends(get_db)) -> CleanupRuleRead:
    from app.services.cleanup_rule_access import rule_payload, update_personal_rule
    scope = ownership_scope_from_request(request)
    try:
        rule, revision = update_personal_rule(db, scope, rule_id, payload.model_dump(exclude_unset=True))
        result = CleanupRuleRead(**rule_payload(db, scope, rule, revision))
        db.commit()
        return result
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
def pending_scans(request: Request, import_id: uuid.UUID | None = None, db: Session = Depends(get_db)) -> list[CleanupScanRead]:
    query = _owned_scan_query(db, request).filter(ContentCleanupScan.status.in_(("QUEUED", "SCANNING", "READY", "FAILED", "STALE", "APPLYING")))
    if import_id is not None:
        scope = ownership_scope_from_request(request)
        if not db.query(ImportRecord.id).filter(ImportRecord.id == import_id, scope.predicate(ImportRecord)).first():
            raise HTTPException(status_code=404, detail="Import record not found.")
        latest_job = db.query(BackgroundJob.id).filter(
            scope.predicate(BackgroundJob), BackgroundJob.job_type == "content_noise_scan",
            BackgroundJob.payload["parent_task_id"].as_string() == str(import_id),
        ).order_by(BackgroundJob.created_at.desc(), BackgroundJob.id.desc()).limit(1).scalar_subquery()
        query = query.filter(ContentCleanupScan.background_job_id == latest_job)
    else:
        from app.core.config import get_settings
        from app.services.task_retention import terminal_result_cutoff
        query = query.outerjoin(BackgroundJob, BackgroundJob.id == ContentCleanupScan.background_job_id).filter(
            or_(BackgroundJob.id.is_(None), BackgroundJob.status != "cancelled", BackgroundJob.completed_at >= terminal_result_cutoff(get_settings().task_terminal_result_retention_seconds)))
    query = query.order_by(ContentCleanupScan.created_at.desc())
    rows = (query.limit(1) if import_id is not None else query).all()
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
def get_review_groups(scan_id: uuid.UUID, request: Request, limit: int = Query(100, ge=1, le=200), offset: int = Query(0, ge=0), q: str = Query("", max_length=200), db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_review import groups
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    return groups(db, scan_id, limit=limit, offset=offset, q=q)


@router.get("/scans/{scan_id}/review")
def get_review_page(scan_id: uuid.UUID, request: Request, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), rule_id: uuid.UUID | None = None, conversation_id: uuid.UUID | None = None, selected_only: bool = False, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_review import review_counts
    if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    counts = review_counts(db, scan_id, rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)
    return {"items": [CleanupOccurrenceRead(**item) for item in preview_occurrences(db, scan_id, limit=limit, offset=offset, rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)],
        **counts, "limit": limit, "offset": offset}


@router.post("/scans/{scan_id}/rescan", response_model=CleanupScanRead, status_code=202)
def rescan_review(scan_id: uuid.UUID, request: Request, db: Session = Depends(get_db), idempotency_key: uuid.UUID | None = Header(default=None)) -> CleanupScanRead:
    from app.services.cleanup_scan_requests import queue_rescan
    try:
        scan, _job = queue_rescan(db, ownership_scope_from_request(request), scan_id, idempotency_key)
        if scan is None:
            raise HTTPException(status_code=409, detail="This rescan request already has a task. Check its result before starting another scan.")
        result = _scan_read(db, scan)
        db.commit()
        return result
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/scans/{scan_id}/rescan-requests/{request_id}")
def get_rescan_request(scan_id: uuid.UUID, request_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_scan_requests import find_request, owned_original
    scope = ownership_scope_from_request(request)
    job = find_request(db, scope, request_id, scan_id)
    if job is None:
        if owned_original(db, scope, scan_id) is None:
            raise HTTPException(status_code=404, detail="Noise scan not found.")
        return {"found": False}
    scan = db.query(ContentCleanupScan).filter_by(background_job_id=job.id).first()
    return {"found": True, "job_id": str(job.id), "status": job.status,
        "scan": _scan_read(db, scan).model_dump(mode="json") if scan else None}


@router.patch("/scans/{scan_id}/decisions/filter")
def patch_filtered_decisions(scan_id: uuid.UUID, payload: CleanupFilteredDecision, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_review import decide_filter
    scan = _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first()
    if scan is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    try:
        result = decide_filter(db, scan_id, **payload.model_dump(exclude={"all_matching"}))
        result["scan"] = _scan_read(db, scan).model_dump(mode="json")
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
    try:
        return preview_changes(db, scan_id, limit=limit, offset=offset)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/scans/{scan_id}/decisions", response_model=CleanupScanRead)
def patch_decisions(scan_id: uuid.UUID, payload: CleanupDecisionBatch, request: Request, db: Session = Depends(get_db)) -> CleanupScanRead:
    scan = _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first()
    if scan is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    try:
        update_decisions(db, scan_id, {item.occurrence_id: item.decision for item in payload.decisions})
        db.flush()
        result = _scan_read(db, scan)
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/scans/{scan_id}/apply", response_model=CleanupApplyRead)
def apply(scan_id: uuid.UUID, request: Request, payload: CleanupApplyInput | None = Body(default=None), db: Session = Depends(get_db)) -> CleanupApplyRead:
    try:
        from app.services.cleanup_outcomes import completed_job
        scope = ownership_scope_from_request(request)
        receipt = completed_job(db, scan_id, scope)
        if receipt is not None:
            return CleanupApplyRead(**receipt.result["cleanup_apply"]["response"])
        if _owned_scan_query(db, request).filter(ContentCleanupScan.id == scan_id).first() is None:
            receipt = completed_job(db, scan_id, scope)
            if receipt is not None:
                return CleanupApplyRead(**receipt.result["cleanup_apply"]["response"])
            raise ValueError("Noise scan not found.")
        locked = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one_or_none()
        if locked is None:
            receipt = completed_job(db, scan_id, scope)
            if receipt is not None:
                return CleanupApplyRead(**receipt.result["cleanup_apply"]["response"])
            raise ValueError("Noise scan not found.")
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


@router.get("/scans/{scan_id}/outcome")
def get_apply_outcome(scan_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_outcomes import read_outcome
    result = read_outcome(db, scan_id, ownership_scope_from_request(request))
    if result is None:
        raise HTTPException(status_code=404, detail="Noise cleanup result not found.")
    return result


@router.delete("/scans/{scan_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(scan_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> Response:
    try:
        dismiss_scan(db, scan_id, ownership_scope=ownership_scope_from_request(request))
        db.commit()
        return Response(status_code=204)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/scans/{scan_id}/dismissal")
def get_dismissal(scan_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> dict:
    from app.services.cleanup_outcomes import dismissed_job
    scope = ownership_scope_from_request(request)
    job = dismissed_job(db, scan_id, scope)
    if job:
        return job.result["cleanup_dismissal"]
    scan = db.query(ContentCleanupScan).filter(ContentCleanupScan.id == scan_id, scope.predicate(ContentCleanupScan)).one_or_none()
    if scan is None:
        raise HTTPException(status_code=404, detail="Noise review or dismissal result not found.")
    return {"status": "REVIEW", "scan": _scan_read(db, scan).model_dump(mode="json")}


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
    from app.services.cleanup_scan_state import scan_job, scan_status
    job = scan_job(db, scan)
    effective_status = scan_status(scan, job)
    previous_scan_id = None
    if job and job.owner_user_id == scan.owner_user_id and job.job_type == "content_noise_scan":
        try:
            previous_scan_id = uuid.UUID((job.payload or {}).get("rescan_of", ""))
        except (ValueError, TypeError, AttributeError):
            pass
    counts = dict(
        db.query(ContentCleanupOccurrence.decision, func.count(ContentCleanupOccurrence.id))
        .filter(ContentCleanupOccurrence.scan_id == scan.id)
        .group_by(ContentCleanupOccurrence.decision)
        .all()
    )
    return CleanupScanRead(
        id=scan.id,
        source=scan.source,
        status=effective_status,
        scope_type=scan.scope_type,
        background_job_id=scan.background_job_id,
        background_job_status=job.status if job else None,
        previous_scan_id=previous_scan_id,
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
        completed_at=job.completed_at if job and effective_status in {"FAILED", "CANCELLED"} else scan.completed_at,
        error_message=job.error_message if job and effective_status == "FAILED" and job.status == "failed" else scan.error_message,
    )
