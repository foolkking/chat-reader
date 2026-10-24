import logging
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.import_record import ImportRecord
from app.services.canonical.persistence import CommitImportError, CommitImportResult, commit_import_preview
from app.services.import_pipeline.draft_store import ImportDraftError
from app.services.retry_policy import MAX_AUTOMATIC_ATTEMPTS
from app.services.content_cleanup import queue_import_scan
from app.services.ownership import OwnershipScope
from app.core.observability import structured_event

logger = logging.getLogger(__name__)

ACTIVE_IMPORT_STATUSES = ("queued", "processing")


def queue_import(record: ImportRecord, db: Session) -> ImportRecord:
    if record.status in ACTIVE_IMPORT_STATUSES or record.status == "committed":
        return record
    now = datetime.now(timezone.utc)
    record.status = "queued"
    record.phase = "queued"
    record.session_state = "READY"
    record.progress = 0
    record.processed_messages = 0
    record.queued_at = now
    record.started_at = None
    record.heartbeat_at = None
    record.completed_at = None
    record.error_message = None
    db.flush()
    structured_event(logger, logging.INFO, "import_queued", import_id=str(record.id))
    return record


def retry_import_manually(record: ImportRecord, db: Session) -> ImportRecord:
    if record.status != "failed":
        return record
    record.attempt_count = 0
    structured_event(logger, logging.INFO, "import_manual_retry", import_id=str(record.id))
    return queue_import(record, db)


def recover_stale_imports(db: Session, stale_after_seconds: int) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=stale_after_seconds)
    stale = (
        db.query(ImportRecord)
        .filter(
            ImportRecord.status == "processing",
            or_(ImportRecord.heartbeat_at.is_(None), ImportRecord.heartbeat_at < cutoff),
        )
        .all()
    )
    now = datetime.now(timezone.utc)
    requeued = 0
    for record in stale:
        if record.attempt_count >= MAX_AUTOMATIC_ATTEMPTS:
            record.status = "failed"
            record.phase = "failed"
            record.session_state = "FAILED"
            record.heartbeat_at = now
            record.completed_at = now
            record.error_message = (
                f"Automatic recovery stopped after {MAX_AUTOMATIC_ATTEMPTS} attempts. "
                "The import can be retried manually."
            )
            structured_event(
                logger,
                logging.WARNING,
                "import_auto_retry_exhausted",
                import_id=str(record.id),
                attempt=record.attempt_count,
            )
            continue
        record.status = "queued"
        record.phase = "queued"
        record.session_state = "READY"
        record.queued_at = now
        record.started_at = None
        record.heartbeat_at = None
        record.error_message = "Previous worker stopped before completing; task requeued."
        structured_event(
            logger,
            logging.WARNING,
            "import_stale_recovered",
            import_id=str(record.id),
            attempt=record.attempt_count,
        )
        requeued += 1
    db.flush()
    return requeued


def claim_next_import(db: Session) -> uuid.UUID | None:
    record = (
        db.query(ImportRecord)
        .filter(ImportRecord.status == "queued")
        .order_by(ImportRecord.queued_at.asc(), ImportRecord.created_at.asc())
        .with_for_update(skip_locked=True)
        .first()
    )
    if record is None:
        return None
    now = datetime.now(timezone.utc)
    record.status = "processing"
    record.phase = "parsing"
    record.session_state = "IMPORTING"
    record.progress = max(record.progress, 1)
    record.started_at = now
    record.heartbeat_at = now
    record.error_message = None
    record.attempt_count += 1
    db.flush()
    structured_event(
        logger,
        logging.INFO,
        "import_started",
        import_id=str(record.id),
        attempt=record.attempt_count,
    )
    return record.id


def process_import(
    import_id: uuid.UUID,
    session_factory: sessionmaker = SessionLocal,
) -> CommitImportResult | None:
    def report(phase: str, progress: int, processed: int, total: int) -> None:
        with session_factory() as progress_db:
            record = progress_db.get(ImportRecord, import_id)
            if record is None or record.status != "processing":
                return
            record.phase = phase
            record.progress = max(0, min(progress, 99))
            record.processed_messages = processed
            record.total_messages = total
            record.heartbeat_at = datetime.now(timezone.utc)
            progress_db.commit()

    try:
        with session_factory() as db:
            record = db.get(ImportRecord, import_id)
            if record is None:
                raise ValueError(f"Import record {import_id} not found.")
            result = commit_import_preview(import_id, db, progress_callback=report)
            # Noise review is deliberately best-effort: a scanner outage must
            # never turn a successful canonical import into a failed import.
            try:
                with db.begin_nested():
                    queue_import_scan(
                        db,
                        result.conversation_ids,
                        OwnershipScope(record.owner_user_id, include_legacy_unowned=record.owner_user_id is None),
                        source_import_id=record.id,
                    )
            except Exception as exc:  # pragma: no cover - operational guard
                structured_event(logger, logging.WARNING, "post_import_noise_scan_queue_failed", import_id=str(import_id), error_class=type(exc).__name__)
            db.commit()
            structured_event(logger, logging.INFO, "import_committed", import_id=str(import_id))
            return result
    except Exception as exc:
        structured_event(
            logger,
            logging.ERROR,
            "import_failed",
            import_id=str(import_id),
            error_class=type(exc).__name__,
        )
        with session_factory() as db:
            record = db.get(ImportRecord, import_id)
            if record is not None:
                record.status = "failed"
                record.phase = "failed"
                record.session_state = "FAILED"
                record.error_message = _safe_error(exc)
                record.heartbeat_at = datetime.now(timezone.utc)
                record.completed_at = datetime.now(timezone.utc)
                db.commit()
        return None


def run_worker_forever() -> None:
    settings = get_settings()
    structured_event(logger, logging.INFO, "import_worker_started", concurrency=1)
    while True:
        with SessionLocal() as db:
            recovered = recover_stale_imports(db, settings.import_stale_after_seconds)
            import_id = claim_next_import(db)
            db.commit()
        if recovered:
            structured_event(logger, logging.WARNING, "import_stale_recovery_batch", recovered_count=recovered)
        if import_id is None:
            time.sleep(settings.import_worker_poll_seconds)
            continue
        process_import(import_id)


def conversation_ids_for_import(db: Session, record: ImportRecord) -> list[uuid.UUID]:
    if record.status != "committed":
        return [record.conversation_id] if record.conversation_id else []
    scope = OwnershipScope(record.owner_user_id, include_legacy_unowned=record.owner_user_id is None)
    available = (
        scope.predicate(Conversation),
        Conversation.status != "deleted",
        Conversation.deleted_at.is_(None),
    )
    # Deleting the primary result clears this nullable FK, but a committed
    # batch may still have other results. Events can also outlive the committed
    # tombstone before its cascade, or an ownership change.
    rows = (
        db.query(ConversationEvent.conversation_id)
        .join(Conversation, Conversation.id == ConversationEvent.conversation_id)
        .filter(
            ConversationEvent.event_type == "conversation_imported",
            ConversationEvent.payload["import_id"].as_string() == str(record.id),
            *available,
        )
        .order_by(ConversationEvent.created_at.asc(), ConversationEvent.id.asc())
        .all()
    )
    ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for (conversation_id,) in rows:
        if conversation_id not in seen:
            ids.append(conversation_id)
            seen.add(conversation_id)
    primary_id = record.conversation_id
    if primary_id is not None and primary_id in seen:
        ids.remove(primary_id)
        ids.insert(0, primary_id)
    elif primary_id is not None and db.query(Conversation.id).filter(
        Conversation.id == primary_id, *available,
    ).first() is not None:
        # Legacy imports need not have an event for their primary. Only that
        # fallback needs an extra ID-only lookup; never trust the FK alone.
        ids.insert(0, primary_id)
    return ids


def primary_filename(record: ImportRecord) -> str | None:
    return record.md_filename or record.json_filename or record.csv_filename


def _safe_error(exc: Exception) -> str:
    # Durable ImportRecord errors are returned directly by Task Center and
    # import-status APIs. Keep only authored draft diagnostics; CommitImportError
    # may wrap an arbitrary persistence exception and echo its text.
    if isinstance(exc, ImportDraftError):
        return (str(exc).strip() or "IMPORT_FAILED")[:2000]
    if isinstance(exc, CommitImportError):
        if isinstance(exc.__cause__, ImportDraftError):
            return (str(exc.__cause__).strip() or "IMPORT_FAILED")[:2000]
        return "IMPORT_COMMIT_FAILED"
    return "IMPORT_FAILED"
