import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.content_cleanup import (
    ContentCleanupOccurrence,
    ContentCleanupRule,
    ContentCleanupRuleRevision,
    ContentCleanupScan,
    ContentCleanupScanRule,
    ContentCleanupScanTarget,
)
from app.models.conversation import Conversation
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from app.schemas.content_cleanup import (
    CleanupApplyRead,
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
    create_literal_rule,
    create_scan,
    dismiss_scan,
    ensure_builtin_rules,
    preview_occurrences,
    update_decisions,
    validate_literal_rule,
)

router = APIRouter(prefix="/api/content-cleanup", tags=["content-cleanup"])


@router.post("/rules/scan-existing", response_model=CleanupScanRead, status_code=status.HTTP_202_ACCEPTED)
def scan_existing_conversations(db: Session = Depends(get_db)) -> CleanupScanRead:
    """Queue one explicit review of every active project and unclassified conversation."""
    active_ids = [
        row[0]
        for row in db.query(Conversation.id)
        .filter(Conversation.status == "active", Conversation.deleted_at.is_(None))
        .all()
    ]
    archived_count = db.query(Conversation.id).filter(Conversation.status == "archived", Conversation.deleted_at.is_(None)).count()
    try:
        scan, _job = create_scan(
            db,
            source="BATCH",
            scope_type="ALL_ACTIVE",
            conversation_ids=active_ids,
            excluded_archived_count=archived_count,
        )
        db.commit()
        db.refresh(scan)
        return _scan_read(db, scan)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/rules", response_model=list[CleanupRuleRead])
def list_rules(db: Session = Depends(get_db)) -> list[CleanupRuleRead]:
    ensure_builtin_rules(db)
    db.commit()
    rows: list[tuple[ContentCleanupRule, ContentCleanupRuleRevision]] = []
    rules = db.query(ContentCleanupRule).order_by(ContentCleanupRule.kind, ContentCleanupRule.name).all()
    for rule in rules:
        if rule.detector_id == MANUAL_SELECTION_DETECTOR:
            continue
        revision = (
            db.query(ContentCleanupRuleRevision)
            .filter(ContentCleanupRuleRevision.rule_id == rule.id)
            .order_by(ContentCleanupRuleRevision.revision.desc())
            .first()
        )
        if revision is not None:
            rows.append((rule, revision))
    return [_rule_read(rule, revision) for rule, revision in rows]


@router.post("/rules", response_model=CleanupRuleRead, status_code=status.HTTP_201_CREATED)
def create_rule(payload: CleanupRuleCreate, db: Session = Depends(get_db)) -> CleanupRuleRead:
    try:
        rule = create_literal_rule(db, **payload.model_dump())
        db.commit()
        revision = db.query(ContentCleanupRuleRevision).filter(ContentCleanupRuleRevision.rule_id == rule.id).one()
        return _rule_read(rule, revision)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/rules/{rule_id}", response_model=CleanupRuleRead)
def update_rule(rule_id: uuid.UUID, payload: CleanupRuleUpdate, db: Session = Depends(get_db)) -> CleanupRuleRead:
    rule = db.get(ContentCleanupRule, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Noise rule not found.")
    if payload.name is not None:
        rule.name = payload.name.strip()
    if payload.status is not None:
        rule.status = payload.status
    revision = db.query(ContentCleanupRuleRevision).filter(ContentCleanupRuleRevision.rule_id == rule.id).order_by(ContentCleanupRuleRevision.revision.desc()).first()
    if revision is None:
        raise HTTPException(status_code=409, detail="Noise rule has no revision.")
    if payload.match_value is not None or payload.case_sensitive is not None or payload.role_filter is not None or payload.matcher_mode is not None or payload.boundary_mode is not None:
        if rule.kind != "USER_LITERAL":
            raise HTTPException(status_code=409, detail="Built-in detector configuration is read-only.")
        next_value = payload.match_value.strip() if payload.match_value is not None else revision.match_value
        next_mode = payload.matcher_mode if payload.matcher_mode is not None else revision.matcher_mode
        try:
            validate_literal_rule(next_value or "", next_mode)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        revision = ContentCleanupRuleRevision(
            rule_id=rule.id,
            revision=revision.revision + 1,
            matcher_version="noise-v2",
            match_value=next_value,
            case_sensitive=payload.case_sensitive if payload.case_sensitive is not None else revision.case_sensitive,
            role_filter=payload.role_filter if payload.role_filter is not None else revision.role_filter,
            matcher_mode=next_mode,
            normalization_profile="NFKC_CASEFOLD_WHITESPACE" if next_mode in {"NORMALIZED", "APPROXIMATE"} else "NONE",
            max_edit_distance=1 if next_mode == "APPROXIMATE" else None,
            boundary_mode=payload.boundary_mode if payload.boundary_mode is not None else revision.boundary_mode,
            default_decision="DELETE",
            supersedes_revision_id=revision.id,
        )
        db.add(revision)
    db.commit()
    db.refresh(rule)
    db.refresh(revision)
    return _rule_read(rule, revision)


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(rule_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    rule = db.get(ContentCleanupRule, rule_id)
    if rule is None:
        return Response(status_code=204)
    if rule.kind == "BUILTIN":
        raise HTTPException(status_code=409, detail="Built-in noise rules cannot be deleted.")
    active_occurrences = (
        db.query(ContentCleanupOccurrence.id)
        .join(ContentCleanupRuleRevision, ContentCleanupRuleRevision.id == ContentCleanupOccurrence.rule_revision_id)
        .filter(ContentCleanupRuleRevision.rule_id == rule.id)
        .first()
    )
    if active_occurrences:
        raise HTTPException(status_code=409, detail="Dismiss or finish pending reviews before deleting this rule.")
    active_snapshot = (
        db.query(ContentCleanupScanRule.id)
        .join(ContentCleanupScan, ContentCleanupScan.id == ContentCleanupScanRule.scan_id)
        .join(ContentCleanupRuleRevision, ContentCleanupRuleRevision.id == ContentCleanupScanRule.rule_revision_id)
        .filter(
            ContentCleanupRuleRevision.rule_id == rule.id,
            ContentCleanupScan.status.in_(("QUEUED", "SCANNING", "READY", "APPLYING")),
        )
        .first()
    )
    if active_snapshot:
        raise HTTPException(status_code=409, detail="Dismiss or finish the existing-conversation scan before deleting this rule.")
    db.delete(rule)
    db.commit()
    return Response(status_code=204)


@router.post("/scans", response_model=CleanupScanRead, status_code=status.HTTP_202_ACCEPTED)
def start_scan(payload: CleanupScanCreate, db: Session = Depends(get_db)) -> CleanupScanRead:
    conversation_ids = payload.conversation_ids
    if payload.scope_type == "ALL_ACTIVE":
        conversation_ids = [row[0] for row in db.query(Conversation.id).filter(Conversation.status == "active", Conversation.deleted_at.is_(None)).all()]
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
        )
        db.commit()
        db.refresh(scan)
        return _scan_read(db, scan)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/scans/pending", response_model=list[CleanupScanRead])
def pending_scans(db: Session = Depends(get_db)) -> list[CleanupScanRead]:
    rows = db.query(ContentCleanupScan).filter(ContentCleanupScan.status.in_(("QUEUED", "SCANNING", "READY", "FAILED", "STALE"))).order_by(ContentCleanupScan.created_at.desc()).all()
    return [_scan_read(db, row) for row in rows]


@router.get("/scans/{scan_id}", response_model=CleanupScanRead)
def get_scan(scan_id: uuid.UUID, db: Session = Depends(get_db)) -> CleanupScanRead:
    scan = db.get(ContentCleanupScan, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    return _scan_read(db, scan)


@router.get("/scans/{scan_id}/occurrences", response_model=list[CleanupOccurrenceRead])
def get_occurrences(
    scan_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[CleanupOccurrenceRead]:
    if db.get(ContentCleanupScan, scan_id) is None:
        raise HTTPException(status_code=404, detail="Noise scan not found.")
    return [CleanupOccurrenceRead(**item) for item in preview_occurrences(db, scan_id, limit=limit, offset=offset)]


@router.patch("/scans/{scan_id}/decisions", response_model=CleanupScanRead)
def patch_decisions(scan_id: uuid.UUID, payload: CleanupDecisionBatch, db: Session = Depends(get_db)) -> CleanupScanRead:
    scan = db.get(ContentCleanupScan, scan_id)
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
def apply(scan_id: uuid.UUID, db: Session = Depends(get_db)) -> CleanupApplyRead:
    try:
        result = apply_scan(db, scan_id)
        db.commit()
        return CleanupApplyRead(**result)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/scans/{scan_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(scan_id: uuid.UUID, db: Session = Depends(get_db)) -> Response:
    try:
        dismiss_scan(db, scan_id)
        db.commit()
        return Response(status_code=204)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _rule_read(rule: ContentCleanupRule, revision: ContentCleanupRuleRevision) -> CleanupRuleRead:
    return CleanupRuleRead(
        id=rule.id,
        name=rule.name,
        kind=rule.kind,
        status=rule.status,
        scope=rule.scope,
        detector_id=rule.detector_id,
        revision=revision.revision,
        match_value=revision.match_value,
        case_sensitive=revision.case_sensitive,
        role_filter=revision.role_filter,
        matcher_mode=revision.matcher_mode,
        normalization_profile=revision.normalization_profile,
        boundary_mode=revision.boundary_mode,
        last_used_at=rule.last_used_at,
    )


def _scan_read(db: Session, scan: ContentCleanupScan) -> CleanupScanRead:
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
