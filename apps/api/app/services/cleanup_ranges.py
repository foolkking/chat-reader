"""Version-bound refinements of a detector candidate, not arbitrary source edits."""
from __future__ import annotations

import hashlib
import json
import uuid

from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupOccurrence, ContentCleanupScan
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion

MAX_REVIEWED_RANGES = 20


def validated_ranges(start: int, end: int, ranges: object) -> list[tuple[int, int]]:
    """NULL preserves the original match; malformed persisted data fails closed."""
    if type(start) is not int or type(end) is not int or not 0 <= start < end:
        raise ValueError("The original cleanup range is invalid.")
    if ranges is None:
        return [(start, end)]
    if not isinstance(ranges, list) or not 1 <= len(ranges) <= MAX_REVIEWED_RANGES:
        raise ValueError("Choose between 1 and 20 deletion ranges, or keep this candidate.")
    result: list[tuple[int, int]] = []
    cursor = start
    for item in ranges:
        if not isinstance(item, dict) or set(item) != {"start_offset", "end_offset"}:
            raise ValueError("The deletion range is invalid.")
        left, right = item["start_offset"], item["end_offset"]
        if type(left) is not int or type(right) is not int or not cursor <= left < right <= end:
            raise ValueError("Deletion ranges must be ordered, non-overlapping and inside the candidate.")
        result.append((left, right))
        cursor = right
    return result


def occurrence_ranges(row: ContentCleanupOccurrence) -> list[tuple[int, int]]:
    return validated_ranges(row.start_offset, row.end_offset, row.reviewed_ranges)


def range_edit_token(row: ContentCleanupOccurrence) -> str:
    state = [str(row.id), str(row.message_version_id), row.source_content_hash,
             row.start_offset, row.end_offset, row.decision,
             row.decision_updated_at.isoformat() if row.decision_updated_at else None,
             row.reviewed_ranges, row.protection_review]
    return hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def save_ranges(db: Session, scan_id: uuid.UUID, occurrence_id: uuid.UUID, *,
                base_edit_token: str, ranges: list[dict[str, int]] | None) -> None:
    from app.models.import_record import utc_now
    from app.services.content_cleanup import _MessageValidation, source_fingerprint

    scan = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one_or_none()
    if scan is None or scan.status != "READY":
        raise ValueError("Wait for this scan to be ready before editing ranges.")
    row = db.query(ContentCleanupOccurrence).filter_by(
        id=occurrence_id, scan_id=scan_id).populate_existing().one_or_none()
    if row is None:
        raise ValueError("This candidate is no longer available.")
    if range_edit_token(row) != base_edit_token:
        raise ValueError("The saved choice changed. Reload it before saving again.")
    if row.decision not in {"KEEP", "DELETE"}:
        raise ValueError("This candidate cannot be adjusted. Rescan the source.")
    version = db.get(MessageVersion, row.message_version_id)
    message = db.get(Message, row.message_id)
    conversation = db.get(Conversation, row.conversation_id)
    if (version is None or message is None or message.is_deleted
            or message.current_version_id != row.message_version_id
            or conversation is None or conversation.status != "active" or conversation.deleted_at is not None
            or row.source_content_hash != source_fingerprint(version.display_text)):
        raise ValueError("The source changed. Rescan before adjusting this candidate.")
    if not 0 <= row.start_offset < row.end_offset <= len(version.display_text):
        raise ValueError("The original candidate range is invalid. Rescan the source.")
    validation = _MessageValidation(message.role, version.display_text)
    from app.services.cleanup_protection import requires_review, reviewed
    if requires_review(row, validation.source):
        if not reviewed(row, validation.source):
            raise ValueError("Confirm the protected match before adjusting deletion ranges.")
    detected = validation.matching_ranges(db, row.rule_revision_id)
    if detected is not None and (row.start_offset, row.end_offset) not in detected:
        raise ValueError("The original candidate no longer matches. Rescan the source.")
    validated_ranges(row.start_offset, row.end_offset, ranges)
    # Retain the original detector bounds and provenance. Bulk KEEP/DELETE must
    # not expand a saved refinement back to the complete candidate.
    row.reviewed_ranges = ranges
    row.decision = "DELETE"
    row.decision_updated_at = utc_now()
