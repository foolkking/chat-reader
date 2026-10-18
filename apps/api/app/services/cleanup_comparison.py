"""Metadata-only, paged comparison of explicitly related scans."""
import uuid
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import aliased

from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupOccurrence as Occurrence, ContentCleanupRuleRevision as Revision, ContentCleanupRule as Rule, ContentCleanupScan
from app.models.message import Message
from app.services.cleanup_scan_requests import owned_original


def compare_scans(db, scope, scan_id, *, limit=20, offset=0):
    scan = owned_original(db, scope, scan_id)
    if not scan:
        raise LookupError("Noise scan not found.")
    job = db.get(BackgroundJob, scan.background_job_id)
    try:
        previous_id = uuid.UUID((job.payload or {}).get("rescan_of", "")) if job else None
    except (ValueError, TypeError):
        previous_id = None
    if not previous_id or not owned_original(db, scope, previous_id):
        raise ValueError("Comparison requires an accessible related previous scan.")
    previous = db.get(ContentCleanupScan, previous_id)
    if scan.status != "READY" or previous.status not in {"READY", "COMPLETED", "STALE"}:
        raise ValueError("Wait for both scans to finish before comparing.")
    used = db.query(Revision.rule_id).join(Occurrence, Occurrence.rule_revision_id == Revision.id).filter(
        Occurrence.scan_id.in_([scan_id, previous_id])).distinct().subquery()
    rules = db.query(Rule).filter(Rule.id.in_(select(used.c.rule_id))).order_by(Rule.id)
    items = []
    for rule in rules.offset(offset).limit(limit):
        base = db.query(Occurrence).filter(Occurrence.rule_revision_id.in_(db.query(Revision.id).filter_by(rule_id=rule.id)))
        old, new = base.filter(Occurrence.scan_id == previous_id), base.filter(Occurrence.scan_id == scan_id)
        peer = aliased(Occurrence)
        same_source = and_(peer.message_id == Occurrence.message_id,
            peer.message_version_id == Occurrence.message_version_id, peer.source_content_hash == Occurrence.source_content_hash)
        # A candidate on a changed/deleted source is not a rule removal.
        old_changed = old.join(Message, Message.id == Occurrence.message_id).filter(
            or_(Message.current_version_id != Occurrence.message_version_id, Message.is_deleted.is_(True))).count()
        new_changed = new.filter(exists(select(peer.id).where(
            peer.scan_id == previous_id, peer.message_id == Occurrence.message_id,
            or_(peer.message_version_id != Occurrence.message_version_id, peer.source_content_hash != Occurrence.source_content_hash)))).count()
        unchanged = new.filter(exists(select(peer.id).where(peer.scan_id == previous_id,
            peer.rule_revision_id.in_(db.query(Revision.id).filter_by(rule_id=rule.id)), same_source,
            peer.start_offset == Occurrence.start_offset, peer.end_offset == Occurrence.end_offset))).count()
        old_count, new_count = old.count(), new.count()
        items.append({"rule_id": str(rule.id), "rule_name": rule.name, "before": old_count, "after": new_count,
            "added": max(0, new_count - unchanged - new_changed),
            "removed": max(0, old_count - unchanged - old_changed), "unchanged": unchanged,
            "source_changed_before": old_changed, "source_changed_after": new_changed,
            "before_revisions": [value[0] for value in old.join(Revision, Revision.id == Occurrence.rule_revision_id).with_entities(Revision.revision).distinct()],
            "after_revisions": [value[0] for value in new.join(Revision, Revision.id == Occurrence.rule_revision_id).with_entities(Revision.revision).distinct()]})
    return {"previous_scan_id": str(previous_id), "scan_id": str(scan_id), "items": items,
            "total": rules.count(), "limit": limit, "offset": offset,
            "excluded_targets": (job.payload or {}).get("rescan_excluded_count", 0)}
