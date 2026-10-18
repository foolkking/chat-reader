"""Short-lived set previews and durable, source-bound protected-match consent."""
from __future__ import annotations

import hashlib
import json
import uuid

from app.models.content_cleanup import ContentCleanupOccurrence as Occurrence, ContentCleanupScan
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.import_record import utc_now
from app.services.cleanup_learning import issue_preview, verify_preview


def binding(row):
    return {
        "version": 1, "scan_id": str(row.scan_id), "candidate_id": str(row.id),
        "rule_revision_id": str(row.rule_revision_id), "message_version_id": str(row.message_version_id),
        "source_hash": row.source_content_hash, "start": row.start_offset, "end": row.end_offset,
    }


def reviewed(row, source) -> bool:
    return reviewed_fingerprint(row, source.fingerprint)


def reviewed_fingerprint(row, fingerprint: str) -> bool:
    """Read consent against exact bytes without rebuilding protection syntax."""
    saved = row.protection_review
    return bool(isinstance(saved, dict) and all(saved.get(key) == value for key, value in binding(row).items())
                and saved.get("confirmed_at") and fingerprint == row.source_content_hash)


def confirm(row, source, *, set_digest):
    if source.fingerprint != row.source_content_hash:
        raise ValueError("Source changed. Preview the protected matches again.")
    row.protection_review = {
        **binding(row), "confirmed_at": utc_now().isoformat(), "set_digest": set_digest,
        "protected_ranges": [[max(row.start_offset, left), min(row.end_offset, right)]
                             for left, right in source.protected
                             if left < row.end_offset and right > row.start_offset],
        "protection_types": ["markdown_code_link_or_math"],
    }


def candidate_query(db, scan_id, *, occurrence_ids=None, rule_id=None, conversation_id=None, selected_only=False):
    from app.services.cleanup_review import filter_occurrences
    query = db.query(Occurrence).filter(Occurrence.scan_id == scan_id,
        Occurrence.decision.in_(("KEEP", "DELETE", "PROTECTED")))
    if occurrence_ids is not None:
        query = query.filter(Occurrence.id.in_(occurrence_ids))
    else:
        # Group consent cannot accidentally become a whole-scan/global switch.
        if rule_id is None:
            raise ValueError("Choose a rule group before confirming protected matches.")
        query = filter_occurrences(query, rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)
    return query


def preview_set(db, scan_id, *, occurrence_ids=None, rule_id=None, conversation_id=None,
                selected_only=False, limit=20, offset=0):
    from app.services.content_cleanup import _SourceAnalysis
    scan = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one_or_none()
    if scan is None or scan.status != "READY":
        raise ValueError("Wait for the scan to finish before reviewing protected matches.")
    query = candidate_query(db, scan_id, occurrence_ids=occurrence_ids, rule_id=rule_id,
                            conversation_id=conversation_id, selected_only=selected_only)
    digest = hashlib.sha256()
    count = protected = 0
    samples = []
    # The digest binds actual source bytes as well as persisted candidate/version
    # identity. Only one body is retained at a time; samples are bounded slices.
    rows = query.add_entity(Message).add_entity(Conversation).join(
        Message, Message.id == Occurrence.message_id).join(
        Conversation, Conversation.id == Occurrence.conversation_id).order_by(
            Occurrence.message_version_id, Occurrence.id,
        ).yield_per(1)
    source_version_id = None
    source = None
    source_text = None
    for row, message, conversation in rows:
        if source_version_id != row.message_version_id:
            source_text = None
            source_text = db.query(MessageVersion.display_text).filter(
                MessageVersion.id == row.message_version_id,
            ).scalar()
            source_version_id = row.message_version_id
            source = _SourceAnalysis(source_text) if source_text is not None else None
        if source is None or source_text is None:
            raise ValueError("A source changed or left this range. Refresh before confirming.")
        if (message.is_deleted or message.current_version_id != row.message_version_id
                or conversation.status != "active" or conversation.deleted_at
                or source.fingerprint != row.source_content_hash):
            raise ValueError("A source changed or left this range. Refresh before confirming.")
        protected_item = source.protects(row.start_offset, row.end_offset) or row.decision == "PROTECTED"
        state = [binding(row), source.fingerprint, str(message.current_version_id), row.decision,
                 str(row.decision_updated_at), row.reviewed_ranges, row.protection_review]
        digest.update(json.dumps(state, sort_keys=True, separators=(",", ":"), default=str).encode())
        protected += int(protected_item)
        if offset <= count < offset + limit:
            samples.append({"id": str(row.id), "rule_revision_id": str(row.rule_revision_id),
                "conversation_id": str(row.conversation_id), "conversation_title": conversation.display_title,
                "match_text": source_text[row.start_offset:min(row.end_offset, row.start_offset + 2000)],
                "match_truncated": row.end_offset - row.start_offset > 2000,
                "protected": protected_item, "protection_types": ["markdown_code_link_or_math"] if protected_item else []})
        count += 1
    if occurrence_ids is not None and count != len(set(occurrence_ids)):
        raise ValueError("One or more candidates are no longer available.")
    authority = {"purpose": "cleanup-protection", "owner": str(scan.owner_user_id), "scan_id": str(scan_id),
        "occurrence_ids": sorted(str(value) for value in occurrence_ids) if occurrence_ids is not None else None,
        "rule_id": str(rule_id) if rule_id else None, "conversation_id": str(conversation_id) if conversation_id else None,
        "selected_only": selected_only, "set_digest": digest.hexdigest(), "count": count, "protected": protected}
    return {"total": count, "protected": protected, "items": samples, "limit": limit, "offset": offset,
            "preview_token": issue_preview(authority), "_authority": authority}


def authorize(db, scan_id, token, **filters):
    preview = preview_set(db, scan_id, limit=0, **filters)
    verify_preview(preview["_authority"], token)
    return preview["_authority"]["set_digest"]
