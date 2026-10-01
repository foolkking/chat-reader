"""Bounded review filters, cross-page decisions and version-bound full diffs."""
from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.content_cleanup import ContentCleanupOccurrence as Occurrence, ContentCleanupRule as Rule, ContentCleanupRuleRevision as Revision, ContentCleanupRuleAlias as Alias, ContentCleanupScan
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion


def filter_occurrences(query, *, rule_id=None, conversation_id=None, selected_only=False):
    if rule_id:
        from app.services.cleanup_rule_access import related_rule_ids
        query = query.filter(Occurrence.rule_revision_id.in_(query.session.query(Revision.id).filter(Revision.rule_id.in_(related_rule_ids(query.session, rule_id)))))
    if conversation_id:
        query = query.filter(Occurrence.conversation_id == conversation_id)
    if selected_only:
        query = query.filter(Occurrence.decision == "DELETE")
    return query


def groups(db: Session, scan_id: uuid.UUID, *, limit: int, offset: int) -> dict:
    from app.services.cleanup_rule_access import personal_name
    scan = db.get(ContentCleanupScan, scan_id)
    query = db.query(Rule.id, Rule.name, Rule.detector_id, Conversation.id, Conversation.display_title,
        func.count(Occurrence.id),
        func.sum(case((Occurrence.decision == "DELETE", 1), else_=0)),
        func.sum(case((Occurrence.decision == "PROTECTED", 1), else_=0)),
        func.sum(case((Occurrence.decision == "CONFLICT", 1), else_=0)),
    ).select_from(Occurrence).join(Revision, Revision.id == Occurrence.rule_revision_id).outerjoin(Alias, Alias.old_rule_id == Revision.rule_id).join(Rule, Rule.id == func.coalesce(Alias.canonical_rule_id, Revision.rule_id)).join(
        Conversation, Conversation.id == Occurrence.conversation_id).filter(Occurrence.scan_id == scan_id, Occurrence.decision != "APPLIED").group_by(
        Rule.id, Rule.name, Rule.detector_id, Conversation.id, Conversation.display_title)
    total = query.count()
    rows = query.order_by(Rule.name, Rule.id, Conversation.display_title, Conversation.id).offset(offset).limit(limit).all()
    return {"items": [{"rule_id": str(rule_id), "rule_name": personal_name(db, scan.owner_user_id, db.get(Rule, rule_id)), "detector_id": detector,
        "conversation_id": str(conversation_id), "conversation_title": title,
        "count": count, "selected": selected, "protected": protected, "conflicts": conflicts}
        for rule_id, name, detector, conversation_id, title, count, selected, protected, conflicts in rows],
        "total": total, "limit": limit, "offset": offset}


def decide_filter(db: Session, scan_id: uuid.UUID, *, decision: str, rule_id=None, conversation_id=None, selected_only=False) -> dict:
    from app.services.content_cleanup import protected_ranges, update_decisions
    scan = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one()
    if scan.status != "READY":
        raise ValueError("Wait for the scan to finish before changing decisions.")
    query = filter_occurrences(db.query(Occurrence.id).filter(Occurrence.scan_id == scan_id, Occurrence.decision.in_(("KEEP", "DELETE"))),
        rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)
    matched, skipped, cursor = 0, 0, None
    while True:
        chunk = query.filter(Occurrence.id > cursor) if cursor else query
        ids = [row[0] for row in chunk.order_by(Occurrence.id).limit(250)]
        if not ids:
            break
        # Legacy scans may still label a protected range KEEP. Refresh that
        # classification without letting one old row reject the whole batch.
        eligible = []
        for row, version in db.query(Occurrence, MessageVersion).join(
            MessageVersion, MessageVersion.id == Occurrence.message_version_id
        ).filter(Occurrence.id.in_(ids)):
            if any(row.start_offset < end and row.end_offset > start for start, end in protected_ranges(version.display_text)):
                row.decision = "PROTECTED"
                row.decision_updated_at = None
                skipped += 1
            else:
                eligible.append(row.id)
        if eligible:
            update_decisions(db, scan_id, {value: decision for value in eligible})
        db.flush()
        matched += len(eligible)
        cursor = ids[-1]
    return {"matched": matched, "skipped_protected": skipped, "scope": "ALL_MATCHING", "decision": decision}


def preview_token(db: Session, scan_id: uuid.UUID) -> str:
    digest = hashlib.sha256(str(scan_id).encode())
    for row in db.query(Occurrence.id, Occurrence.message_version_id, Message.current_version_id, Occurrence.start_offset,
        Occurrence.end_offset, Occurrence.decision_updated_at, Message.is_deleted, Conversation.status, Conversation.deleted_at).join(
        Message, Message.id == Occurrence.message_id).join(Conversation, Conversation.id == Occurrence.conversation_id).filter(
        Occurrence.scan_id == scan_id, Occurrence.decision == "DELETE").order_by(Occurrence.id).yield_per(250):
        digest.update(("|".join(str(value) for value in row) + "\n").encode())
    return digest.hexdigest()


def preview_changes(db: Session, scan_id: uuid.UUID, *, limit: int, offset: int) -> dict:
    from app.services.content_cleanup import _occurrence_still_matches
    db.query(ContentCleanupScan).filter_by(id=scan_id).with_for_update().one()
    selected = db.query(Occurrence).filter(Occurrence.scan_id == scan_id, Occurrence.decision == "DELETE")
    summary = {"conversations": selected.with_entities(func.count(func.distinct(Occurrence.conversation_id))).scalar(),
        "messages": selected.with_entities(func.count(func.distinct(Occurrence.message_id))).scalar(),
        "fragments": selected.count()}
    message_ids = [row[0] for row in selected.with_entities(Occurrence.message_id).group_by(Occurrence.message_id).order_by(Occurrence.message_id).offset(offset).limit(limit)]
    items = []
    for message_id in message_ids:
        rows = selected.filter(Occurrence.message_id == message_id).order_by(Occurrence.start_offset).all()
        message = db.get(Message, message_id)
        version = db.get(MessageVersion, rows[0].message_version_id)
        conversation = db.get(Conversation, rows[0].conversation_id)
        before = version.display_text
        conflict = message.is_deleted or message.current_version_id != version.id or conversation.status != "active" or conversation.deleted_at is not None
        spans = [(row.start_offset, row.end_offset) for row in rows]
        conflict = conflict or any(spans[index][1] > spans[index + 1][0] for index in range(len(spans) - 1))
        conflict = conflict or any(row.message_version_id != version.id or not _occurrence_still_matches(db, message.role, before, row) for row in rows)
        after = before
        if not conflict:
            for start, end in reversed(spans):
                after = after[:start] + after[end:]
            conflict = not after.strip()
        items.append({"conversation_id": str(conversation.id), "conversation_title": conversation.display_title,
            "message_id": str(message_id), "role": message.role, "before": before, "after": before if conflict else after,
            "conflict": bool(conflict), "fragments": len(rows)})
    return {"summary": summary, "items": items, "limit": limit, "offset": offset,
        "preview_token": preview_token(db, scan_id)}
