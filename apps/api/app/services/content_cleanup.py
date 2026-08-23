from __future__ import annotations

import unicodedata
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
    ("openai-private-marker-v1", "ChatGPT 私有标记（待确认）", "marker", "PRIVATE_MARKER"),
    ("visible-turn-citation-v1", "导出器可见引用标记", "citation", "VISIBLE_CITATION"),
    ("chatgpt-exporter-footer-v1", "ChatGPT Exporter 页脚", "footer", "EXPORTER_FOOTER"),
    ("thinking-summary-v1", "导出的思考摘要", "thinking_summary", "THINKING_SUMMARY"),
    ("manual-selection-v1", "手动选择的内容", "manual_selection", "MANUAL_SELECTION"),
)
MANUAL_SELECTION_DETECTOR = "manual-selection-v1"
MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE = 256
PRIVATE_REFERENCE_TOKEN = r"turn\d+[A-Za-z][A-Za-z0-9_-]*\d+"

PRIVATE_CITATION = re.compile(
    r"\ue200\s*(?:cite|memcite)\s*(?:"
    r"\ue201"
    r"|"
    rf"(?:(?:\ue202)?[☆★\u200b\s]*)?{PRIVATE_REFERENCE_TOKEN}"
    rf"(?:(?:[☆★\u200b\s]*\ue202)?[☆★\u200b\s]*{PRIVATE_REFERENCE_TOKEN})*"
    r"[\u200b☆★\s]*\ue201"
    r")",
    re.IGNORECASE,
)
PRIVATE_CITATION_BROKEN = re.compile(
    r"(?:\ue200\s*)?(?:cite|memcite)[\u200b\s]*(?:\ue202[\u200b\s]*)?"
    rf"(?:[☆★\u200b\s]*{PRIVATE_REFERENCE_TOKEN}){{1,}}"
    r"[\u200b☆★\s]*(?:\ue201)?",
    re.IGNORECASE,
)
# Some exporters wrap non-citation metadata in the same private Unicode
# envelope. Surface those complete envelopes for review instead of silently
# discarding an unknown marker or guessing that it is safe to delete.
PRIVATE_MARKER_ENVELOPE = re.compile(
    r"\ue200(?:(?!\ue200|\ue201)[\s\S]){1,4096}\ue201",
)
# Exporters have emitted the same private citation protocol with a damaged
# opener/closer or a different private-use wrapper over time. Keep this
# detector deliberately narrow: it requires a citation verb and at least one
# stable turn reference, but does not require every wrapper code point to be
# present. These candidates are review-only by default.
PRIVATE_CITATION_FRAGMENT = re.compile(
    r"(?is)(?:(?:[\ue000-\uf8ff]\s*)?(?:cite|memcite)|(?:cite|memcite)\s*[\ue000-\uf8ff])"
    rf"[\ue000-\uf8ff\u200b\s:]*{PRIVATE_REFERENCE_TOKEN}"
    rf"(?:[\ue000-\uf8ff\u200b\s:]*{PRIVATE_REFERENCE_TOKEN})*"
    r"[\ue000-\uf8ff\u200b\s]*",
)
VISIBLE_CITATION = re.compile(
    r"(?i)\bcite\b[\s\u200b]*(?:[☆★]\s*)?turn\d+(?:search|news|view)\d+"
    r"(?:[☆★\s\u200b]*turn\d+(?:search|news|view)\d+)*[☆★]?"
)
REFERENCE_SEQUENCE = re.compile(
    r"turn\d+(?:search|news|view)\d+"
    r"(?:[\s\u200b\ue000-\uf8ff*]*turn\d+(?:search|news|view)\d+)*",
    re.IGNORECASE,
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
    match_mode: str = "RAW_EXACT"
    evidence_codes: tuple[str, ...] = ()
    similarity_score: float | None = None


def ensure_builtin_rules(db: Session) -> list[ContentCleanupRuleRevision]:
    revisions: list[ContentCleanupRuleRevision] = []
    for detector_id, name, kind, reason_code in BUILTIN_RULES:
        rule = db.query(ContentCleanupRule).filter(ContentCleanupRule.detector_id == detector_id).first()
        expected_scope = "ASSISTANT_ONLY" if kind in {"citation", "footer", "thinking_summary"} else "MESSAGE"
        if rule is None:
            rule = ContentCleanupRule(
                name=name,
                kind="BUILTIN",
                status="ACTIVE",
                scope=expected_scope,
                detector_id=detector_id,
            )
            db.add(rule)
            db.flush()
        elif rule.scope != expected_scope:
            # Older deployments created the generic marker detector with the
            # assistant-only scope. Repair that metadata in place so a full
            # conversation scan cannot silently skip user/system messages.
            rule.scope = expected_scope
        revision = (
            db.query(ContentCleanupRuleRevision)
            .filter(ContentCleanupRuleRevision.rule_id == rule.id)
            .order_by(ContentCleanupRuleRevision.revision.desc())
            .first()
        )
        if revision is None or revision.matcher_version != "noise-v3":
            revision = ContentCleanupRuleRevision(
                rule_id=rule.id,
                revision=(revision.revision + 1) if revision is not None else 1,
                matcher_version="noise-v3",
                matcher_mode="EXACT",
                normalization_profile="NONE",
                default_decision="DELETE",
                supersedes_revision_id=revision.id if revision is not None else None,
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
    matcher_mode: str = "EXACT",
    boundary_mode: str = "ANYWHERE",
) -> ContentCleanupRule:
    value = match_value.strip()
    validate_literal_rule(value, matcher_mode)
    rule = ContentCleanupRule(name=name.strip()[:200], kind="USER_LITERAL", status="ACTIVE", scope="MESSAGE")
    db.add(rule)
    db.flush()
    db.add(ContentCleanupRuleRevision(
        rule_id=rule.id,
        revision=1,
        matcher_version="noise-v3",
        match_value=value,
        case_sensitive=case_sensitive,
        role_filter=role_filter,
        matcher_mode=matcher_mode,
        normalization_profile="NFKC_CASEFOLD_WHITESPACE" if matcher_mode in {"NORMALIZED", "APPROXIMATE"} else "NONE",
        max_edit_distance=1 if matcher_mode == "APPROXIMATE" else None,
        boundary_mode=boundary_mode,
        default_decision="DELETE",
    ))
    db.flush()
    return rule


def validate_literal_rule(value: str, matcher_mode: str) -> None:
    if not value or len(value) > 500:
        raise ValueError("Noise rule text must contain 1-500 characters.")
    if matcher_mode == "APPROXIMATE" and len(value) < 6:
        raise ValueError("Approximate noise rules require at least 6 characters.")


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
        if existing.source != source or existing.scope_type != scope_type:
            continue
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
            current_revisions = {
                conversation.id: conversation.offline_revision
                for conversation in conversations
            }
            target_revisions = {
                row.conversation_id: row.base_conversation_revision
                for row in db.query(ContentCleanupScanTarget)
                .filter(ContentCleanupScanTarget.scan_id == existing.id)
                .all()
            }
            if any(target_revisions.get(conversation_id) != revision for conversation_id, revision in current_revisions.items()):
                continue
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
            Message.current_version_id.is_not(None),
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
        detected_rows: list[tuple[ContentCleanupRuleRevision, DetectedOccurrence]] = []
        partial_rows: list[tuple[ContentCleanupRuleRevision, DetectedOccurrence]] = []
        for revision in revisions:
            rule = revision.rule
            if rule.scope == "ASSISTANT_ONLY" and message.role != "assistant":
                continue
            if revision.role_filter and revision.role_filter != message.role:
                continue
            for detected in detect_occurrences(message.role, version.display_text, rule, revision):
                if scan.selection_message_id is not None:
                    assert scan.selection_start_offset is not None and scan.selection_end_offset is not None
                    selected_start, selected_end = scan.selection_start_offset, scan.selection_end_offset
                    if detected.end <= selected_start or detected.start >= selected_end:
                        continue
                    if not (selected_start <= detected.start and detected.end <= selected_end):
                        partial_rows.append((revision, DetectedOccurrence(
                            detected.start,
                            detected.end,
                            detected.kind,
                            "PARTIAL_SELECTION",
                            "LOW",
                            "KEEP",
                            detected.match_mode,
                            (*detected.evidence_codes, "PARTIAL_SELECTION"),
                            detected.similarity_score,
                        )))
                        continue
                detected_rows.append((revision, detected))
        if scan.selection_message_id is not None:
            assert scan.selection_start_offset is not None and scan.selection_end_offset is not None
            selected_start, selected_end = scan.selection_start_offset, scan.selection_end_offset
            if not detected_rows and partial_rows:
                detected_rows.extend(partial_rows)
            elif not detected_rows and manual_revision is not None:
                protected = any(
                    selected_start < protected_end and selected_end > protected_start
                    for protected_start, protected_end in protected_ranges(version.display_text)
                )
                deletes_entire_message = not (version.display_text[:selected_start] + version.display_text[selected_end:]).strip()
                detected_rows.append((manual_revision, DetectedOccurrence(
                    selected_start,
                    selected_end,
                    "manual_selection",
                    "MANUAL_SELECTION",
                    "HIGH",
                    "PROTECTED" if protected or deletes_entire_message else "DELETE",
                    "MANUAL",
                    ("MANUAL_SELECTION",),
                    None,
                )))
        deduped: list[tuple[ContentCleanupRuleRevision, DetectedOccurrence]] = []
        for revision, detected in detected_rows:
            overlapping = [
                index
                for index, (_previous_revision, previous) in enumerate(deduped)
                if detected.start < previous.end and previous.start < detected.end
            ]
            if not overlapping:
                deduped.append((revision, detected))
                continue
            if all(_prefer_detected_occurrence(detected, deduped[index][1]) for index in overlapping):
                deduped = [item for index, item in enumerate(deduped) if index not in overlapping]
                deduped.append((revision, detected))
        for revision, detected in sorted(deduped, key=lambda item: (item[1].start, item[1].end)):
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
                match_mode=detected.match_mode,
                evidence_codes=list(detected.evidence_codes),
                similarity_score=detected.similarity_score,
            ))
            revision.rule.last_used_at = utc_now()
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
    values: list[DetectedOccurrence] = []
    detector_id = rule.detector_id
    if detector_id == "openai-private-citation-v1":
        values.extend(_detected(match.start(), match.end(), "citation", "PRIVATE_CITATION", "HIGH", "STRUCTURAL", ("PUA_WRAPPER", "REFERENCE_SEQUENCE")) for match in PRIVATE_CITATION.finditer(text))
        if "\ue200" in text or "\ue201" in text:
            values.extend(
                _detected(match.start(), match.end(), "citation", "PRIVATE_CITATION_BROKEN", "MEDIUM", "STRUCTURAL", ("REFERENCE_SEQUENCE", "MISSING_WRAPPER"))
                for match in PRIVATE_CITATION_BROKEN.finditer(text)
                if any(marker in match.group(0) for marker in ("\ue200", "\ue201", "\ue202"))
                and not _covered(match.start(), match.end(), values)
            )
        values.extend(
            _detected(
                match.start(),
                match.end(),
                "citation",
                "PRIVATE_CITATION_FRAGMENT",
                "MEDIUM",
                "BOUNDED_FUZZY",
                ("PRIVATE_USE_MARKER", "REFERENCE_SEQUENCE", "PARTIAL_WRAPPER"),
            )
            for match in PRIVATE_CITATION_FRAGMENT.finditer(text)
            if _contains_private_use(match.group(0)) and not _overlaps(match.start(), match.end(), values)
        )
    elif detector_id == "openai-private-marker-v1":
        values.extend(
            _detected(
                match.start(),
                match.end(),
                "marker",
                "PRIVATE_MARKER",
                "MEDIUM",
                "STRUCTURAL",
                ("PUA_ENVELOPE", "UNCLASSIFIED_MARKER"),
            )
            for match in PRIVATE_MARKER_ENVELOPE.finditer(text)
        )
    elif detector_id == "visible-turn-citation-v1":
        values.extend(_detected(match.start(), match.end(), "citation", "VISIBLE_CITATION", "HIGH", "STRUCTURAL", ("REFERENCE_SEQUENCE",)) for match in VISIBLE_CITATION.finditer(text))
        values.extend(_tolerant_visible_citations(text, values))
    elif detector_id == "chatgpt-exporter-footer-v1":
        match = EXPORTER_FOOTER.search(text)
        if match:
            values.append(_detected(match.start(), match.end(), "footer", "EXPORTER_FOOTER", "HIGH", "STRUCTURAL", ("BLOCK_END",)))
    elif detector_id == "thinking-summary-v1":
        cleaned = clean_thinking_summary(role, text)
        if cleaned.removed and cleaned.removed_text:
            start = text.find(cleaned.removed_text)
            if start >= 0:
                values.append(_detected(start, start + len(cleaned.removed_text), "thinking_summary", "THINKING_SUMMARY", "HIGH", "STRUCTURAL", ("PREFIX_BOUNDARY", "ANSWER_BOUNDARY")))
    elif revision.match_value:
        values.extend(_literal_occurrences(text, revision))
    protected = protected_ranges(text)
    result: list[DetectedOccurrence] = []
    for item in values:
        is_protected = any(item.start < protected_end and item.end > protected_start for protected_start, protected_end in protected)
        decision = "PROTECTED" if is_protected else (item.decision if item.confidence == "HIGH" else "KEEP")
        result.append(DetectedOccurrence(item.start, item.end, item.kind, item.reason_code, item.confidence, decision, item.match_mode, item.evidence_codes, item.similarity_score))
    return result


def protected_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    lines = list(re.finditer(r".*(?:\n|$)", text))
    index = 0
    while index < len(lines):
        line = lines[index]
        value = line.group(0)
        fence = re.match(r"^[ ]{0,3}(`{3,}|~{3,})[^\n]*", value)
        if fence:
            marker = fence.group(1)
            start = line.start()
            end = line.end()
            index += 1
            while index < len(lines):
                candidate = lines[index].group(0)
                end = lines[index].end()
                index += 1
                closing_pattern = rf"^[ ]{{0,3}}{re.escape(marker[0])}{{{len(marker)},}}[ \t]*$"
                closing = re.match(closing_pattern, candidate.rstrip("\n"))
                if closing:
                    end = lines[index - 1].start() + closing.end()
                    break
            ranges.append((start, end))
            continue
        if re.match(r"^(?: {4}|\t)", value):
            start = line.start()
            end = line.end()
            index += 1
            while index < len(lines) and re.match(r"^(?: {4}|\t|\s*$)", lines[index].group(0)):
                end = lines[index].end()
                index += 1
            ranges.append((start, end))
            continue
        index += 1
    inline_runs = list(re.finditer(r"`+", text))
    run_index = 0
    while run_index < len(inline_runs):
        opening = inline_runs[run_index]
        if any(start <= opening.start() < end for start, end in ranges):
            run_index += 1
            continue
        closing_index = run_index + 1
        while closing_index < len(inline_runs):
            closing = inline_runs[closing_index]
            if len(closing.group(0)) == len(opening.group(0)):
                ranges.append((opening.start(), closing.end()))
                run_index = closing_index + 1
                break
            closing_index += 1
        else:
            run_index += 1
    for pattern in (
        re.compile(r"(?s)\$\$.*?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)"),
        re.compile(r"\]\((?:<[^>\n]+>|[^)\n]+)\)"),
        re.compile(r"(?m)^\s*\[[^\]]+\]:\s*(?:<[^>]+>|\S+)(?:\s+.*)?$"),
        re.compile(r"<(?:https?://|mailto:)[^>\n]+>"),
        re.compile(r"cr-asset://[0-9a-f-]{36}", re.IGNORECASE),
    ):
        ranges.extend((match.start(), match.end()) for match in pattern.finditer(text))
    return _merge_ranges(ranges)


def _detected(start: int, end: int, kind: str, reason_code: str, confidence: str, match_mode: str, evidence_codes: tuple[str, ...], similarity_score: float | None = None) -> DetectedOccurrence:
    return DetectedOccurrence(start, end, kind, reason_code, confidence, "DELETE", match_mode, evidence_codes, similarity_score)


def _covered(start: int, end: int, values: list[DetectedOccurrence]) -> bool:
    return any(item.start <= start and end <= item.end for item in values)


def _overlaps(start: int, end: int, values: list[DetectedOccurrence]) -> bool:
    return any(start < item.end and item.start < end for item in values)


def _contains_private_use(value: str) -> bool:
    return any("\ue000" <= character <= "\uf8ff" for character in value)


def _prefer_detected_occurrence(candidate: DetectedOccurrence, current: DetectedOccurrence) -> bool:
    """Choose one authority when detectors report overlapping views of one marker."""
    if (candidate.decision == "PROTECTED") != (current.decision == "PROTECTED"):
        return candidate.decision == "PROTECTED"
    confidence_rank = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}
    candidate_rank = (
        confidence_rank.get(candidate.confidence, 0),
        candidate.match_mode == "STRUCTURAL",
        candidate.end - candidate.start,
    )
    current_rank = (
        confidence_rank.get(current.confidence, 0),
        current.match_mode == "STRUCTURAL",
        current.end - current.start,
    )
    return candidate_rank > current_rank


def _syntax_token(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return "".join(char for char in normalized if char.isalnum())


def _tolerant_visible_citations(
    text: str,
    existing: list[DetectedOccurrence],
) -> list[DetectedOccurrence]:
    """Recover damaged citation tokens only when an exact reference grammar follows."""
    result: list[DetectedOccurrence] = []
    targets = ("cite", "memcite")
    for references in REFERENCE_SEQUENCE.finditer(text):
        if _covered(references.start(), references.end(), existing):
            continue
        best: tuple[int, int, str, str] | None = None
        lower_bound = max(0, references.start() - 20)
        for start in range(lower_bound, references.start()):
            if start > 0 and text[start - 1].isalnum():
                continue
            token = _syntax_token(text[start:references.start()])
            if not token or len(token) > 9:
                continue
            for target in targets:
                distance = _levenshtein_bounded(token, target, 1)
                if distance is None:
                    continue
                match_mode = "NORMALIZED_EXACT" if distance == 0 else "BOUNDED_FUZZY"
                candidate = (distance, -start, target, match_mode)
                if best is None or candidate[:2] < best[:2]:
                    best = candidate
        if best is None:
            continue
        distance, negative_start, target, match_mode = best
        start = -negative_start
        end = references.end()
        if _covered(start, end, existing) or _covered(start, end, result):
            continue
        if distance == 0:
            result.append(_detected(
                start,
                end,
                "citation",
                "VISIBLE_CITATION_NORMALIZED",
                "HIGH",
                match_mode,
                ("SYNTAX_TOKEN_NFKC", "REFERENCE_SEQUENCE", f"TOKEN_{target.upper()}"),
                1.0,
            ))
        else:
            score = 1.0 - distance / len(target)
            result.append(_detected(
                start,
                end,
                "citation",
                "VISIBLE_CITATION_FUZZY_TOKEN",
                "MEDIUM",
                match_mode,
                ("SYNTAX_TOKEN_EDIT_DISTANCE_1", "REFERENCE_SEQUENCE", f"TOKEN_{target.upper()}"),
                score,
            ))
    return result


def _merge_ranges(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted((item for item in ranges if item[0] < item[1])):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _shadow(text: str, *, case_sensitive: bool) -> tuple[str, list[tuple[int, int]]]:
    output: list[str] = []
    mapping: list[tuple[int, int]] = []
    for index, char in enumerate(text):
        value = unicodedata.normalize("NFKC", char)
        if not case_sensitive:
            value = value.casefold()
        if value.isspace():
            value = " "
        for item in value:
            if item == " " and output and output[-1] == " ":
                mapping[-1] = (mapping[-1][0], index + 1)
                continue
            output.append(item)
            mapping.append((index, index + 1))
    return "".join(output), mapping


def _literal_occurrences(text: str, revision: ContentCleanupRuleRevision) -> list[DetectedOccurrence]:
    value = revision.match_value
    if not value:
        return []
    mode = getattr(revision, "matcher_mode", "EXACT")
    if mode == "EXACT":
        flags = 0 if revision.case_sensitive else re.IGNORECASE
        pattern = re.compile(re.escape(value), flags)
        return [_detected(match.start(), match.end(), "custom", "USER_LITERAL", "HIGH", "RAW_EXACT", ("LITERAL_EXACT",)) for match in pattern.finditer(text) if _boundary_allows(text, match.start(), match.end(), getattr(revision, "boundary_mode", "ANYWHERE"))]
    shadow, mapping = _shadow(text, case_sensitive=revision.case_sensitive)
    needle, _ = _shadow(value, case_sensitive=revision.case_sensitive)
    if not needle:
        return []
    result: list[DetectedOccurrence] = []
    if mode == "NORMALIZED":
        for start in _find_all(shadow, needle):
            end = start + len(needle)
            original_start, original_end = mapping[start][0], mapping[end - 1][1]
            if _boundary_allows(text, original_start, original_end, getattr(revision, "boundary_mode", "ANYWHERE")):
                result.append(_detected(original_start, original_end, "custom", "USER_LITERAL_NORMALIZED", "HIGH", "NORMALIZED_EXACT", ("NFKC", "WHITESPACE_NORMALIZED")))
        return result
    exact_ranges: set[tuple[int, int]] = set()
    for start in _find_all(shadow, needle):
        end = start + len(needle)
        original_start, original_end = mapping[start][0], mapping[end - 1][1]
        if _boundary_allows(text, original_start, original_end, getattr(revision, "boundary_mode", "ANYWHERE")):
            exact_ranges.add((original_start, original_end))
            result.append(_detected(original_start, original_end, "custom", "USER_LITERAL_NORMALIZED", "HIGH", "NORMALIZED_EXACT", ("LITERAL_EXACT", "NFKC")))
    max_edits = max(1, min(getattr(revision, "max_edit_distance", None) or 1, 2))
    window = len(needle)
    if window < 6:
        return []
    anchors = _fuzzy_anchor_starts(shadow, needle, limit=MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE)
    seen: set[tuple[int, int]] = set()
    for start in anchors:
        best: tuple[int, int] | None = None
        for candidate_length in range(max(1, window - max_edits), window + max_edits + 1):
            if start + candidate_length > len(shadow):
                continue
            candidate = shadow[start:start + candidate_length]
            distance = _levenshtein_bounded(needle, candidate, max_edits)
            if distance is None or candidate == needle:
                continue
            candidate_rank = (distance, abs(candidate_length - window))
            if best is None or candidate_rank < (best[0], abs(best[1] - window)):
                best = (distance, candidate_length)
        if best is None:
            continue
        distance, candidate_length = best
        score = max(0.0, 1.0 - distance / max(len(needle), 1))
        original_start, original_end = mapping[start][0], mapping[start + candidate_length - 1][1]
        if (original_start, original_end) in seen or (original_start, original_end) in exact_ranges or not _boundary_allows(text, original_start, original_end, getattr(revision, "boundary_mode", "ANYWHERE")):
            continue
        seen.add((original_start, original_end))
        result.append(_detected(original_start, original_end, "custom", "USER_LITERAL_APPROXIMATE", "LOW", "BOUNDED_FUZZY", ("LITERAL_ANCHORED", f"EDIT_DISTANCE_{distance}"), score))
        if len(seen) >= MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE:
            break
    return result


def _find_all(text: str, needle: str) -> list[int]:
    positions: list[int] = []
    cursor = 0
    while True:
        index = text.find(needle, cursor)
        if index < 0:
            return positions
        positions.append(index)
        cursor = index + max(1, len(needle))


def _fuzzy_anchor_starts(text: str, needle: str, *, limit: int) -> list[int]:
    width = min(4, max(2, len(needle) // 4))
    offsets = sorted({0, max(0, len(needle) // 2 - width // 2), len(needle) - width})
    starts: set[int] = set()
    for offset in offsets:
        anchor = needle[offset:offset + width]
        cursor = 0
        while True:
            found = text.find(anchor, cursor)
            if found < 0:
                break
            candidate_start = found - offset
            if candidate_start >= 0:
                starts.add(candidate_start)
                if len(starts) >= limit:
                    return sorted(starts)
            cursor = found + 1
    return sorted(starts)


def _boundary_allows(text: str, start: int, end: int, mode: str) -> bool:
    if mode == "WHOLE_LINE":
        return not text[text.rfind("\n", 0, start) + 1:start].strip() and not text[end:text.find("\n", end) if "\n" in text[end:] else len(text)].strip()
    if mode == "BLOCK_END":
        return not text[end:].strip()
    return True


def _levenshtein_bounded(left: str, right: str, limit: int) -> int | None:
    if abs(len(left) - len(right)) > limit:
        return None
    sentinel = limit + 1
    previous = [sentinel] * (len(right) + 1)
    for column in range(min(len(right), limit) + 1):
        previous[column] = column
    for row, left_char in enumerate(left, 1):
        current = [sentinel] * (len(right) + 1)
        if row <= limit:
            current[0] = row
        first_column = max(1, row - limit)
        last_column = min(len(right), row + limit)
        for column in range(first_column, last_column + 1):
            current[column] = min(
                current[column - 1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left_char != right[column - 1]),
            )
        if min(current[first_column:last_column + 1], default=sentinel) > limit:
            return None
        previous = current
    return previous[-1] if previous[-1] <= limit else None


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
            "match_mode": occurrence.match_mode,
            "similarity_score": occurrence.similarity_score,
            "evidence_codes": occurrence.evidence_codes or [],
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
        if row.decision in {"PROTECTED", "CONFLICT"}:
            if row.decision == "CONFLICT":
                continue
            # Protected ranges are deliberately surfaced as KEEP candidates,
            # but an explicit user decision may override that default.
            row.decision = decision
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
            if any(not _occurrence_still_matches(db, message.role, text, item) for item in message_occurrences):
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


def _occurrence_still_matches(db: Session, role: str, text: str, occurrence: ContentCleanupOccurrence) -> bool:
    revision = db.get(ContentCleanupRuleRevision, occurrence.rule_revision_id)
    rule = db.get(ContentCleanupRule, revision.rule_id) if revision is not None else None
    if revision is None or rule is None:
        return False
    if rule.detector_id == MANUAL_SELECTION_DETECTOR:
        return 0 <= occurrence.start_offset < occurrence.end_offset <= len(text)
    return any(
        item.start == occurrence.start_offset
        and item.end == occurrence.end_offset
        for item in detect_occurrences(role, text, rule, revision)
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
