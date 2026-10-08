"""Durable global/rescan admission using the existing task receipt."""
import hashlib
import uuid

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan, ContentCleanupScanTarget
from app.models.conversation import Conversation
from app.services.ownership import OwnershipScope


def _request_key(request_id: uuid.UUID, scan_id: uuid.UUID | None = None) -> str:
    return str(request_id) if scan_id is None else f"rescan:{scan_id}:{request_id}"


def find_request(db: Session, scope: OwnershipScope, request_id: uuid.UUID, scan_id: uuid.UUID | None = None) -> BackgroundJob | None:
    key = _request_key(request_id, scan_id)
    return db.query(BackgroundJob).filter(
        scope.predicate(BackgroundJob), BackgroundJob.job_type == "content_noise_scan",
        or_(BackgroundJob.idempotency_key == key, BackgroundJob.payload["cleanup_request_key"].as_string() == key),
    ).order_by(BackgroundJob.created_at).first()


def _lock_request(db: Session, scope: OwnershipScope, key: str):
    if db.bind.dialect.name == "postgresql":
        lock = int.from_bytes(hashlib.sha256(f"global-noise:{scope.owner_user_id}:{key}".encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})


def _bind_request(db: Session, job: BackgroundJob, key: str):
    job.idempotency_key = key
    job.payload = {**job.payload, "cleanup_request_key": key}
    db.flush()


def queue_global_scan(db: Session, scope: OwnershipScope, request_id: uuid.UUID | None = None):
    from app.services.content_cleanup import create_scan
    if request_id is not None:
        _lock_request(db, scope, str(request_id))
        existing = find_request(db, scope, request_id)
        if existing is not None:
            return db.query(ContentCleanupScan).filter_by(background_job_id=existing.id).first(), existing
    active_ids = [row[0] for row in db.query(Conversation.id).filter(
        Conversation.status == "active", Conversation.deleted_at.is_(None), scope.predicate(Conversation))]
    excluded = db.query(Conversation.id).filter(
        Conversation.status == "archived", Conversation.deleted_at.is_(None), scope.predicate(Conversation)).count()
    # A new deliberate request re-evaluates current rules/exceptions. Retries of
    # that request always use the receipt, including after the review is closed.
    scan, job = create_scan(db, source="BATCH", scope_type="ALL_ACTIVE", conversation_ids=active_ids,
        excluded_archived_count=excluded, force_new=request_id is not None, ownership_scope=scope)
    if request_id is not None:
        _bind_request(db, job, str(request_id))
    return scan, job


def owned_original(db: Session, scope: OwnershipScope, scan_id: uuid.UUID) -> ContentCleanupScan | None:
    return db.query(ContentCleanupScan).join(ContentCleanupScanTarget, ContentCleanupScanTarget.scan_id == ContentCleanupScan.id).join(
        Conversation, Conversation.id == ContentCleanupScanTarget.conversation_id).filter(
            ContentCleanupScan.id == scan_id, scope.predicate(ContentCleanupScan), scope.predicate(Conversation)).first()


def queue_rescan(db: Session, scope: OwnershipScope, scan_id: uuid.UUID, request_id: uuid.UUID | None = None):
    from app.services.content_cleanup import create_scan
    if request_id is not None:
        _lock_request(db, scope, _request_key(request_id, scan_id))
        existing = find_request(db, scope, request_id, scan_id)
        if existing is not None:
            return db.query(ContentCleanupScan).filter_by(background_job_id=existing.id).first(), existing
    original = owned_original(db, scope, scan_id)
    if original is None:
        raise LookupError("Noise scan not found.")
    ids = [row[0] for row in db.query(Conversation.id).join(ContentCleanupScanTarget, ContentCleanupScanTarget.conversation_id == Conversation.id).filter(
        ContentCleanupScanTarget.scan_id == scan_id, scope.predicate(Conversation), Conversation.status == "active", Conversation.deleted_at.is_(None))]
    original_job = db.query(BackgroundJob).filter(BackgroundJob.id == original.background_job_id, scope.predicate(BackgroundJob)).first()
    parent = original_job.payload.get("parent_task_id") if original_job and original.source == "IMPORT" else None
    scan, job = create_scan(db, source="IMPORT" if parent else "BATCH", scope_type="IMPORT_RESULT" if parent else "SELECTED_CONVERSATIONS",
        conversation_ids=ids, ownership_scope=scope, force_new=True)
    job.payload = {**job.payload, "rescan_of": str(scan_id)}
    if parent:
        job.payload = {**job.payload, "parent_task_id": parent}
        job.result = {**job.result, "parent_task_id": parent}
    if request_id is not None:
        _bind_request(db, job, _request_key(request_id, scan_id))
    db.flush()
    return scan, job
