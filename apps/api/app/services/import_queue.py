import logging
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.conversation_event import ConversationEvent
from app.models.import_record import ImportRecord
from app.services.canonical.persistence import CommitImportResult, commit_import_preview
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
            result = commit_import_preview(import_id, db, progress_callback=report)
            # Noise review is deliberately best-effort: a scanner outage must
            # never turn a successful canonical import into a failed import.
            try:
                with db.begin_nested():
                    queue_import_scan(
                        db,
                        result.conversation_ids,
                        OwnershipScope(record.owner_user_id, include_legacy_unowned=record.owner_user_id is None),
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
    ids: list[uuid.UUID] = []
    if record.conversation_id:
        ids.append(record.conversation_id)
    if record.status != "committed" or not record.conversation_id:
        return ids
    rows = db.query(ConversationEvent).filter(ConversationEvent.event_type == "conversation_imported").all()
    for row in rows:
        if str(row.payload.get("import_id")) == str(record.id) and row.conversation_id not in ids:
            ids.append(row.conversation_id)
    return ids


def primary_filename(record: ImportRecord) -> str | None:
    return record.md_filename or record.json_filename or record.csv_filename


def _safe_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return message[:2000]
