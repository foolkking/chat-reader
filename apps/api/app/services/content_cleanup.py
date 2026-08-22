from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.background_job import BackgroundJob
from app.models.content_cleanup import (
    ContentCleanupOccurrence,
    ContentCleanupRule,
    ContentCleanupRuleRevision,
    ContentCleanupScan,
    ContentCleanupScanTarget,
)
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.import_record import utc_now
from app.services.editing.message_edit_service import (
    _create_version,
    _get_current_version,
    _write_event,
)
from app.services.import_pipeline.thinking_cleaner import clean_thinking_summary
from app.services.search.search_indexer import rebuild_search_and_toc_for_conversation

BUILTIN_RULES = (
    ("openai-private-citation-v1", "ChatGPT 私有引用标记", "citation", "PRIVATE_CITATION"),
    ("visible-turn-citation-v1", "导出器可见引用标记", "citation", "VISIBLE_CITATION"),
    ("chatgpt-exporter-footer-v1", "ChatGPT Exporter 页脚", "footer", "EXPORTER_FOOTER"),
    ("thinking-summary-v1", "导出的思考摘要", "thinking_summary", "THINKING_SUMMARY"),
    ("manual-selection-v1", "手动选择的内容", "manual_selection", "MANUAL_SELECTION"),
)
MANUAL_SELECTION_DETECTOR = "manual-selection-v1"

PRIVATE_CITATION = re.compile(r"\ue200(?:cite\ue202[^\ue201\r\n]+|memcite)\ue201")
VISIBLE_CITATION = re.compile(
    r"(?i)\bCite\s+(?:[☆★]\s*)?turn\d+(?:search|news|view)\d+"
    r"(?:[☆★]\s*turn\d+(?:search|news|view)\d+)*[☆★]?"
)
EXPORTER_FOOTER = re.compile(
    r"(?s)(?:\n[ \t]*){0,2}(?:---[ \t]*\n)?[ \t]*Powered by "
    r"(?:\[ChatGPT Exporter\]\(https://www\.chatgptexporter\.com\)|ChatGPT Exporter"
    r" \(https://www\.chatgptexporter\.com\))[ \t]*\Z"
)


@dataclass(frozen=True)
class DetectedOccurrence:
    start: int
    end: int
    kind: str
    reason_code: str
    confidence: str
    decision: str


def ensure_builtin_rules(db: Session) -> list[ContentCleanupRuleRevision]:
    revisions: list[ContentCleanupRuleRevision] = []
    for detector_id, name, kind, reason_code in BUILTIN_RULES:
        rule = db.query(ContentCleanupRule).filter(ContentCleanupRule.detector_id == detector_id).first()
        if rule is None:
            rule = ContentCleanupRule(
                name=name,
                kind="BUILTIN",
                status="ACTIVE",
                scope="ASSISTANT_ONLY" if kind in {"citation", "footer", "thinking_summary"} else "MESSAGE",
                detector_id=detector_id,
            )
            db.add(rule)
            db.flush()
        revision = (
            db.query(ContentCleanupRuleRevision)
            .filter(ContentCleanupRuleRevision.rule_id == rule.id)
            .order_by(ContentCleanupRuleRevision.revision.desc())
            .first()
        )
        if revision is None:
            revision = ContentCleanupRuleRevision(
                rule_id=rule.id,
                revision=1,
                matcher_version="noise-v1",
                default_decision="DELETE",
            )
            db.add(revision)
            db.flush()
        revisions.append(revision)
    return revisions


def create_literal_rule(
    db: Session,
    *,
    name: str,
    match_value: str,
    case_sensitive: bool = True,
    role_filter: str | None = None,
) -> ContentCleanupRule:
    value = match_value.strip()
    if not value or len(value) > 500:
        raise ValueError("Noise rule text must contain 1-500 characters.")
    rule = ContentCleanupRule(name=name.strip()[:200], kind="USER_LITERAL", status="ACTIVE", scope="MESSAGE")
    db.add(rule)
    db.flush()
    db.add(ContentCleanupRuleRevision(
        rule_id=rule.id,
        revision=1,
        matcher_version="noise-v1",
        match_value=value,
        case_sensitive=case_sensitive,
        role_filter=role_filter,
        default_decision="DELETE",
    ))
    db.flush()
    return rule


def active_revisions(db: Session) -> list[ContentCleanupRuleRevision]:
    ensure_builtin_rules(db)
    latest_revision = (
        select(ContentCleanupRuleRevision.rule_id, func.max(ContentCleanupRuleRevision.revision).label("revision"))
        .group_by(ContentCleanupRuleRevision.rule_id)
        .subquery()
    )
    return (
        db.query(ContentCleanupRuleRevision)
        .join(ContentCleanupRule, ContentCleanupRule.id == ContentCleanupRuleRevision.rule_id)
        .join(
            latest_revision,
            and_(
                latest_revision.c.rule_id == ContentCleanupRuleRevision.rule_id,
                latest_revision.c.revision == ContentCleanupRuleRevision.revision,
            ),
        )
        .filter(
            ContentCleanupRule.status == "ACTIVE",
            ContentCleanupRule.detector_id != MANUAL_SELECTION_DETECTOR,
        )
        .order_by(ContentCleanupRule.id)
        .all()
    )


def create_scan(
    db: Session,
    *,
    source: str,
    scope_type: str,
    conversation_ids: list[uuid.UUID],
    selection_message_id: uuid.UUID | None = None,
    selection_start_offset: int | None = None,
    selection_end_offset: int | None = None,
) -> tuple[ContentCleanupScan, BackgroundJob]:
    if not conversation_ids:
        raise ValueError("At least one active conversation is required.")
    conversations = (
        db.query(Conversation)
        .filter(
            Conversation.id.in_(conversation_ids),
            Conversation.status == "active",
            Conversation.deleted_at.is_(None),
        )
        .all()
    )
    if len(conversations) != len(set(conversation_ids)):
        raise ValueError("Noise scans only support active conversations.")
    selection_values = (selection_message_id, selection_start_offset, selection_end_offset)
    has_selection = any(value is not None for value in selection_values)
    if has_selection and not all(value is not None for value in selection_values):
        raise ValueError("A source selection requires a message and both offsets.")
    if has_selection:
        if scope_type != "CURRENT_CONVERSATION" or len(conversations) != 1:
            raise ValueError("Source selections only support the current conversation.")
        selected_message = db.get(Message, selection_message_id)
        if (
            selected_message is None
            or selected_message.is_deleted
            or selected_message.conversation_id != conversations[0].id
            or selected_message.current_version_id is None
        ):
            raise ValueError("The selected source message is not available in this conversation.")
        selected_version = db.get(MessageVersion, selected_message.current_version_id)
        assert selection_start_offset is not None and selection_end_offset is not None
        if (
            selected_version is None
            or selection_start_offset >= selection_end_offset
            or selection_end_offset > len(selected_version.display_text)
        ):
            raise ValueError("The selected source range is invalid or empty.")
    wanted_ids = set(conversation_ids)
    for existing in (
        db.query(ContentCleanupScan)
        .filter(ContentCleanupScan.status.in_(("QUEUED", "SCANNING", "READY", "APPLYING")))
        .order_by(ContentCleanupScan.created_at.desc())
        .limit(50)
        .all()
    ):
        existing_ids = {
            row[0]
            for row in db.query(ContentCleanupScanTarget.conversation_id)
            .filter(ContentCleanupScanTarget.scan_id == existing.id)
            .all()
        }
        same_selection = (
            existing.selection_message_id == selection_message_id
            and existing.selection_start_offset == selection_start_offset
            and existing.selection_end_offset == selection_end_offset
        )
        if existing_ids == wanted_ids and same_selection and existing.background_job_id is not None:
            existing_job = db.get(BackgroundJob, existing.background_job_id)
            if existing_job is not None:
                return existing, existing_job
    scan = ContentCleanupScan(
        source=source,
        scope_type=scope_type,
        status="QUEUED",
        total_messages=1 if has_selection else db.query(func.count(Message.id)).filter(
            Message.conversation_id.in_(conversation_ids),
            Message.is_deleted.is_(False),
        ).scalar() or 0,
        selection_message_id=selection_message_id,
        selection_start_offset=selection_start_offset,
        selection_end_offset=selection_end_offset,
    )
    db.add(scan)
    db.flush()
    for conversation in conversations:
        db.add(ContentCleanupScanTarget(
            scan_id=scan.id,
            conversation_id=conversation.id,
            base_conversation_revision=conversation.offline_revision,
            status="PENDING",
        ))
    job = BackgroundJob(
        job_type="content_noise_scan",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=scan.total_messages,
        payload={"scan_id": str(scan.id), "cursor_message_id": None},
        result={"scan_id": str(scan.id), "conversation_ids": [str(item.id) for item in conversations]},
    )
    db.add(job)
    db.flush()
    scan.background_job_id = job.id
    return scan, job


def process_scan_chunk(db: Session, scan_id: uuid.UUID, *, chunk_size: int = 250) -> dict[str, object]:
    scan = db.get(ContentCleanupScan, scan_id)
    if scan is None:
        raise ValueError("Noise scan not found.")
    revisions = active_revisions(db)
    manual_revision = _manual_selection_revision(db) if scan.selection_message_id is not None else None
    if manual_revision is not None:
        revisions = []
    target_ids = [row[0] for row in db.query(ContentCleanupScanTarget.conversation_id).filter(ContentCleanupScanTarget.scan_id == scan_id).all()]
    cursor = scan.cursor_message_id
    query = (
        db.query(Message, MessageVersion, Conversation)
        .join(MessageVersion, MessageVersion.id == Message.current_version_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .filter(
            Message.conversation_id.in_(target_ids),
            Message.is_deleted.is_(False),
            Conversation.status == "active",
            Conversation.deleted_at.is_(None),
        )
    )
    if cursor is not None:
        query = query.filter(Message.id > cursor)
    if scan.selection_message_id is not None:
        query = query.filter(Message.id == scan.selection_message_id)
    rows = query.order_by(Message.id.asc()).limit(chunk_size).all()
    if not rows:
        occurrence_count = db.query(ContentCleanupOccurrence).filter(ContentCleanupOccurrence.scan_id == scan_id).count()
        if occurrence_count == 0:
            processed_messages = scan.processed_messages
            total_messages = scan.total_messages
            db.query(ContentCleanupScanTarget).filter(ContentCleanupScanTarget.scan_id == scan_id).delete(
                synchronize_session=False,
            )
            db.delete(scan)
            return {
                "done": True,
                "processed": processed_messages,
                "total": total_messages,
                "occurrences": 0,
            }
        scan.status = "READY"
        scan.progress = 100
        scan.completed_at = utc_now()
        scan.cursor_message_id = None
        db.query(ContentCleanupScanTarget).filter(ContentCleanupScanTarget.scan_id == scan_id).update(
            {ContentCleanupScanTarget.status: "READY"},
            synchronize_session=False,
        )
        return {"done": True, "processed": scan.processed_messages, "total": scan.total_messages, "occurrences": occurrence_count}

    for message, version, _conversation in rows:
        db.query(ContentCleanupScanTarget).filter(
            ContentCleanupScanTarget.scan_id == scan_id,
            ContentCleanupScanTarget.conversation_id == message.conversation_id,
        ).update({ContentCleanupScanTarget.status: "SCANNING"}, synchronize_session=False)
        if manual_revision is not None:
            assert scan.selection_start_offset is not None and scan.selection_end_offset is not None
            start = scan.selection_start_offset
            end = scan.selection_end_offset
            protected = any(
                start < protected_end and end > protected_start
                for protected_start, protected_end in protected_ranges(version.display_text)
            )
            deletes_entire_message = not (version.display_text[:start] + version.display_text[end:]).strip()
            db.add(ContentCleanupOccurrence(
                scan_id=scan.id,
                rule_revision_id=manual_revision.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                message_version_id=version.id,
                start_offset=start,
                end_offset=end,
                line_start=version.display_text.count("\n", 0, start) + 1,
                column_start=start - version.display_text.rfind("\n", 0, start),
                line_end=version.display_text.count("\n", 0, end) + 1,
                column_end=end - version.display_text.rfind("\n", 0, end),
                kind="manual_selection",
                confidence="HIGH",
                reason_code="MANUAL_SELECTION",
                decision="PROTECTED" if protected or deletes_entire_message else "DELETE",
            ))
            manual_revision.rule.last_used_at = utc_now()
        for revision in revisions:
            rule = revision.rule
            if rule.scope == "ASSISTANT_ONLY" and message.role != "assistant":
                continue
            if revision.role_filter and revision.role_filter != message.role:
                continue
            for detected in detect_occurrences(message.role, version.display_text, rule, revision):
                db.add(ContentCleanupOccurrence(
                    scan_id=scan.id,
                    rule_revision_id=revision.id,
                    conversation_id=message.conversation_id,
                    message_id=message.id,
                    message_version_id=version.id,
                    start_offset=detected.start,
                    end_offset=detected.end,
                    line_start=version.display_text.count("\n", 0, detected.start) + 1,
                    column_start=detected.start - version.display_text.rfind("\n", 0, detected.start),
                    line_end=version.display_text.count("\n", 0, detected.end) + 1,
                    column_end=detected.end - version.display_text.rfind("\n", 0, detected.end),
                    kind=detected.kind,
                    confidence=detected.confidence,
                    reason_code=detected.reason_code,
                    decision=detected.decision,
                ))
                rule.last_used_at = utc_now()
    scan.cursor_message_id = rows[-1][0].id
    scan.processed_messages += len(rows)
    scan.progress = min(99, int(scan.processed_messages * 100 / max(scan.total_messages, 1)))
    scan.status = "SCANNING"
    return {"done": False, "processed": scan.processed_messages, "total": scan.total_messages, "occurrences": 0}


def detect_occurrences(
    role: str,
    text: str,
    rule: ContentCleanupRule,
    revision: ContentCleanupRuleRevision,
) -> list[DetectedOccurrence]:
    values: list[tuple[int, int, str, str, str]] = []
    detector_id = rule.detector_id
    if detector_id == "openai-private-citation-v1":
        values.extend((match.start(), match.end(), "citation", "PRIVATE_CITATION", "HIGH") for match in PRIVATE_CITATION.finditer(text))
    elif detector_id == "visible-turn-citation-v1":
        values.extend((match.start(), match.end(), "citation", "VISIBLE_CITATION", "HIGH") for match in VISIBLE_CITATION.finditer(text))
    elif detector_id == "chatgpt-exporter-footer-v1":
        match = EXPORTER_FOOTER.search(text)
        if match:
            values.append((match.start(), match.end(), "footer", "EXPORTER_FOOTER", "HIGH"))
    elif detector_id == "thinking-summary-v1":
        cleaned = clean_thinking_summary(role, text)
        if cleaned.removed and cleaned.removed_text:
            start = text.find(cleaned.removed_text)
            if start >= 0:
                values.append((start, start + len(cleaned.removed_text), "thinking_summary", "THINKING_SUMMARY", "HIGH"))
    elif revision.match_value:
        flags = 0 if revision.case_sensitive else re.IGNORECASE
        pattern = re.compile(re.escape(revision.match_value), flags)
        values.extend((match.start(), match.end(), "custom", "USER_LITERAL", "MEDIUM") for match in pattern.finditer(text))
    protected = protected_ranges(text)
    result: list[DetectedOccurrence] = []
    for start, end, kind, reason, confidence in values:
        is_protected = any(start < protected_end and end > protected_start for protected_start, protected_end in protected)
        result.append(DetectedOccurrence(start, end, kind, reason, confidence, "PROTECTED" if is_protected else "DELETE"))
    return result


def protected_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    for pattern in (
        re.compile(r"(?ms)^\s*(?:```|~~~).*?^\s*(?:```|~~~)\s*"),
        re.compile(r"(?s)(?<!`)`[^`\n]+`(?!`)|\$\$.*?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)"),
        re.compile(r"\]\((?:cr-asset://|https?://)[^)]*\)"),
    ):
        ranges.extend((match.start(), match.end()) for match in pattern.finditer(text))
    return ranges


def preview_occurrences(
    db: Session,
    scan_id: uuid.UUID,
    *,
    context: int = 120,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, object]]:
    rows = (
        db.query(
            ContentCleanupOccurrence,
            MessageVersion,
            Message,
            Conversation,
            ContentCleanupRule,
            ContentCleanupRuleRevision,
        )
        .join(MessageVersion, MessageVersion.id == ContentCleanupOccurrence.message_version_id)
        .join(Message, Message.id == ContentCleanupOccurrence.message_id)
        .join(Conversation, Conversation.id == ContentCleanupOccurrence.conversation_id)
        .join(ContentCleanupRuleRevision, ContentCleanupRuleRevision.id == ContentCleanupOccurrence.rule_revision_id)
        .join(ContentCleanupRule, ContentCleanupRule.id == ContentCleanupRuleRevision.rule_id)
        .filter(ContentCleanupOccurrence.scan_id == scan_id)
        .order_by(ContentCleanupOccurrence.conversation_id, ContentCleanupOccurrence.message_id, ContentCleanupOccurrence.start_offset)
        .offset(offset)
        .limit(limit)
        .all()
    )
    result: list[dict[str, object]] = []
    for occurrence, version, message, conversation, rule, revision in rows:
        text = version.display_text
        start = max(0, occurrence.start_offset - context)
        end = min(len(text), occurrence.end_offset + context)
        result.append({
            "id": str(occurrence.id),
            "conversation_id": str(occurrence.conversation_id),
            "conversation_title": conversation.display_title,
            "message_id": str(occurrence.message_id),
            "message_version_id": str(occurrence.message_version_id),
            "role": message.role,
            "rule_id": str(rule.id),
            "rule_name": rule.name,
            "detector_id": rule.detector_id,
            "kind": occurrence.kind,
            "reason_code": occurrence.reason_code,
            "confidence": occurrence.confidence,
            "decision": occurrence.decision,
            "start_offset": occurrence.start_offset,
            "end_offset": occurrence.end_offset,
            "line_start": occurrence.line_start,
            "column_start": occurrence.column_start,
            "match_text": text[occurrence.start_offset:occurrence.end_offset],
            "context_before": text[start:occurrence.start_offset],
            "context_after": text[occurrence.end_offset:end],
            "stale": message.current_version_id != version.id,
            "match_value": revision.match_value,
        })
    return result


def update_decisions(db: Session, scan_id: uuid.UUID, decisions: dict[uuid.UUID, str]) -> None:
    rows = db.query(ContentCleanupOccurrence).filter(ContentCleanupOccurrence.scan_id == scan_id, ContentCleanupOccurrence.id.in_(list(decisions))).all()
    if len(rows) != len(decisions):
        raise ValueError("One or more cleanup candidates do not belong to this scan.")
    for row in rows:
        decision = decisions[row.id]
        if decision not in {"DELETE", "KEEP"}:
            raise ValueError("Noise decision must be DELETE or KEEP.")
        if row.decision in {"PROTECTED", "CONFLICT"} and decision == "DELETE":
            raise ValueError("Protected or conflicted cleanup candidates cannot be deleted.")
        if row.decision in {"PROTECTED", "CONFLICT"}:
            continue
        row.decision = decision


def apply_scan(db: Session, scan_id: uuid.UUID) -> dict[str, object]:
    scan = db.get(ContentCleanupScan, scan_id)
    if scan is None or scan.status not in {"READY", "APPLYING"}:
        raise ValueError("Noise scan is not ready to apply.")
    scan.status = "APPLYING"
    grouped: dict[uuid.UUID, list[ContentCleanupOccurrence]] = {}
    for occurrence in db.query(ContentCleanupOccurrence).filter(ContentCleanupOccurrence.scan_id == scan_id, ContentCleanupOccurrence.decision == "DELETE").all():
        grouped.setdefault(occurrence.conversation_id, []).append(occurrence)
    applied = 0
    conflicts = db.query(ContentCleanupOccurrence).filter(
        ContentCleanupOccurrence.scan_id == scan_id,
        ContentCleanupOccurrence.decision == "CONFLICT",
    ).count()
    for conversation_id, occurrences in grouped.items():
        conversation = db.get(Conversation, conversation_id)
        if conversation is None or conversation.status != "active" or conversation.deleted_at is not None:
            conflicts += len(occurrences)
            for occurrence in occurrences:
                occurrence.decision = "CONFLICT"
            db.commit()
            continue
        conversation_applied = False
        by_message: dict[uuid.UUID, list[ContentCleanupOccurrence]] = {}
        for occurrence in occurrences:
            by_message.setdefault(occurrence.message_id, []).append(occurrence)
        for message_id, message_occurrences in by_message.items():
            message = db.get(Message, message_id)
            if message is None or message.is_deleted:
                conflicts += len(message_occurrences)
                continue
            version = _get_current_version(db, message)
            if version.id != message_occurrences[0].message_version_id:
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
            text = version.display_text
            ranges = sorted((item.start_offset, item.end_offset) for item in message_occurrences)
            if any(start < 0 or end > len(text) or start >= end for start, end in ranges):
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
            if any(ranges[index][1] > ranges[index + 1][0] for index in range(len(ranges) - 1)):
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
            if any(not _occurrence_still_matches(db, text, item) for item in message_occurrences):
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
            for start, end in reversed(ranges):
                text = text[:start] + text[end:]
            if not text.strip():
                conflicts += len(message_occurrences)
                continue
            new_version = _create_version(
                db=db,
                message=message,
                text=text,
                edit_type="content_cleanup",
                edit_reason="Apply reviewed content cleanup rules",
                created_by="user",
                based_on_version_id=version.id,
            )
            _write_event(
                db=db,
                message=message,
                event_type="message_edited",
                target_version_id=new_version.id,
                created_by="user",
                payload={"message_id": str(message.id), "previous_version_id": str(version.id), "new_version_id": str(new_version.id), "edit_type": "content_cleanup"},
            )
            applied += len(message_occurrences)
            conversation_applied = True
        if conversation_applied:
            rebuild_search_and_toc_for_conversation(db, conversation_id)
        # Each conversation is its own durable unit. A later conflict cannot
        # roll back content already reviewed and applied to another target.
        db.commit()
        scan = db.get(ContentCleanupScan, scan_id)
        if scan is None:
            raise ValueError("Noise scan disappeared while applying decisions.")
    scan.status = "READY" if conflicts else "COMPLETED"
    scan.completed_at = utc_now()
    if conflicts:
        scan.error_message = f"{conflicts} noise matches need review because their message version changed or the deletion was unsafe."
    else:
        db.query(ContentCleanupOccurrence).filter(ContentCleanupOccurrence.scan_id == scan_id).delete(synchronize_session=False)
        db.query(ContentCleanupScanTarget).filter(ContentCleanupScanTarget.scan_id == scan_id).delete(synchronize_session=False)
        db.delete(scan)
    return {"applied": applied, "conflicts": conflicts}


def dismiss_scan(db: Session, scan_id: uuid.UUID) -> None:
    scan = db.get(ContentCleanupScan, scan_id)
    if scan is None:
        return
    if scan.status in {"QUEUED", "SCANNING", "APPLYING"}:
        raise ValueError("Wait for the cleanup scan to finish before dismissing it.")
    db.delete(scan)


def _occurrence_still_matches(db: Session, text: str, occurrence: ContentCleanupOccurrence) -> bool:
    revision = db.get(ContentCleanupRuleRevision, occurrence.rule_revision_id)
    rule = db.get(ContentCleanupRule, revision.rule_id) if revision is not None else None
    if revision is None or rule is None:
        return False
    if rule.detector_id == MANUAL_SELECTION_DETECTOR:
        return 0 <= occurrence.start_offset < occurrence.end_offset <= len(text)
    return any(
        item.start == occurrence.start_offset and item.end == occurrence.end_offset
        for item in detect_occurrences("assistant" if rule.scope == "ASSISTANT_ONLY" else revision.role_filter or "user", text, rule, revision)
    )


def _manual_selection_revision(db: Session) -> ContentCleanupRuleRevision:
    for revision in ensure_builtin_rules(db):
        if revision.rule.detector_id == MANUAL_SELECTION_DETECTOR:
            return revision
    raise ValueError("The manual selection cleanup rule is unavailable.")


def queue_import_scan(db: Session, conversation_ids: list[uuid.UUID]) -> ContentCleanupScan | None:
    """Queue a post-import review without delaying the canonical import commit."""
    if not conversation_ids:
        return None
    scan, _job = create_scan(
        db,
        source="IMPORT",
        scope_type="IMPORT_RESULT",
        conversation_ids=conversation_ids,
    )
    return scan
