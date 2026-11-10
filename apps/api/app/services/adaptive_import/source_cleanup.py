"""Durable receipts for explicitly discarded sources, not a retention purge."""
import hashlib
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.observability import structured_event
from app.models.import_record import ImportRecord
from app.services.worker_maintenance import bound_worker_transaction

KEY = "_source_cleanup"
UNFINISHED = ("pending", "failed", "blocked")
logger = logging.getLogger(__name__)


class SourceCleanupBlocked(ValueError):
    """The configured target cannot be proven to be the discarded directory."""


def root_digest(root: Path) -> str:
    return hashlib.sha256(str(root.resolve()).encode("utf-8")).hexdigest()


def eligible(record: ImportRecord) -> bool:
    return (record.status in {"canceled", "cancelled"} and record.session_state == "CANCELED"
            and record.committed_at is None and record.conversation_id is None)


def public_receipt(record: ImportRecord) -> dict | None:
    receipt = (record.analysis_summary or {}).get(KEY)
    if not eligible(record) or not isinstance(receipt, dict) or receipt.get("version") != 1:
        return None
    if receipt.get("state") not in {*UNFINISHED, "completed"}:
        return None
    try:
        revision = str(uuid.UUID(receipt["revision"]))
    except (KeyError, TypeError, ValueError, AttributeError):
        return None
    return {"state": receipt["state"], "revision": revision, "retryable": receipt["state"] in UNFINISHED}


def schedule_receipt(record: ImportRecord, root: Path) -> str:
    previous = (record.analysis_summary or {}).get(KEY)
    digest = (previous.get("root_digest") if isinstance(previous, dict) and previous.get("version") == 1 else None)
    revision = str(uuid.uuid4())
    record.analysis_summary = {
        **(record.analysis_summary or {}),
        KEY: {"version": 1, "state": "pending", "revision": revision,
              "root_digest": digest or root_digest(root),
              "requested_at": datetime.now(timezone.utc).isoformat()},
    }
    return revision


def finish_receipt(bind, import_id: uuid.UUID, root: Path, revision: str, remove_files) -> None:
    """Cancellation is already committed; errors must retain a visible receipt."""
    try:
        with Session(bind=bind) as db:
            bound_worker_transaction(db)
            record = db.query(ImportRecord).filter_by(id=import_id).with_for_update().one_or_none()
            if record is None or not eligible(record):
                return
            receipt = dict((record.analysis_summary or {}).get(KEY) or {})
            if receipt.get("version") != 1 or receipt.get("revision") != revision:
                return
            try:
                if receipt.get("root_digest") != root_digest(root):
                    raise SourceCleanupBlocked()
                remove_files(import_id, storage_root=root)
                state = "completed"
            except (OSError, RuntimeError, ValueError) as exc:
                state = "blocked" if isinstance(exc, SourceCleanupBlocked) else "failed"
                structured_event(logger, logging.WARNING, "adaptive_import_cancel_cleanup_failed",
                                 error_class=type(exc).__name__)
            record.analysis_summary = {
                **record.analysis_summary, KEY: {**receipt, "state": state,
                    "checked_at": datetime.now(timezone.utc).isoformat()},
            }
            db.commit()
    except Exception as exc:
        # Includes unknown receipt COMMIT outcome. The durable pending marker
        # survives; checking/retrying never restarts the cancelled import.
        structured_event(logger, logging.WARNING, "adaptive_import_cleanup_receipt_failed",
                         error_class=type(exc).__name__)


def transfer_discarded_receipts(db: Session, previous_owner: uuid.UUID, cleanup_owner: uuid.UUID) -> None:
    """Keep only minimal disposal receipts when the approved account is deleted."""
    from app.models.import_profile import ImportInputGroup, ImportStructureFamily
    from app.models.source_artifact import SourceArtifact

    while True:
        rows = db.query(ImportRecord).filter(
            ImportRecord.owner_user_id == previous_owner,
            ImportRecord.status.in_(("canceled", "cancelled")), ImportRecord.session_state == "CANCELED",
            ImportRecord.committed_at.is_(None), ImportRecord.conversation_id.is_(None),
            ImportRecord.analysis_summary[KEY]["version"].as_integer() == 1,
            ImportRecord.analysis_summary[KEY]["state"].as_string().in_(UNFINISHED),
        ).order_by(ImportRecord.id).limit(50).with_for_update().all()
        if not rows:
            return
        ids = [row.id for row in rows]
        for model in (ImportInputGroup, ImportStructureFamily, SourceArtifact):
            db.query(model).filter(model.import_id.in_(ids)).delete(synchronize_session=False)
        for row in rows:
            receipt = row.analysis_summary[KEY]
            row.owner_user_id = cleanup_owner
            row.analysis_summary = {KEY: receipt}
            row.source_profile, row.source_fingerprint = "discarded-cleanup", ""
            row.json_filename = row.md_filename = row.csv_filename = row.detected_title = None
            row.draft_storage_uri = row.draft_sha256 = row.error_message = None
            row.warnings, row.draft_summary = [], {}
            row.file_count = row.total_bytes = row.total_messages = row.processed_messages = row.progress = 0
        db.flush()
