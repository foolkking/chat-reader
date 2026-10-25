from __future__ import annotations

import unicodedata
import hashlib
import re
import uuid
from bisect import bisect_left
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.background_job import BackgroundJob
from app.models.content_cleanup import (
    ContentCleanupOccurrence,
    ContentCleanupRule,
    ContentCleanupRuleRevision,
    ContentCleanupScan,
    ContentCleanupScanRule,
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
from app.services.cleanup_normalization import normalized_shadow, source_span
from app.services.search.search_indexer import rebuild_search_and_toc_for_conversation
from app.services.ownership import LEGACY_OWNERSHIP_SCOPE, OwnershipScope, get_owned

BUILTIN_RULES = (
    ("openai-private-citation-v1", "ChatGPT 私有引用标记", "citation", "PRIVATE_CITATION"),
    ("openai-private-marker-v1", "ChatGPT 私有标记（待确认）", "marker", "PRIVATE_MARKER"),
    ("visible-turn-citation-v1", "导出器可见引用标记", "citation", "VISIBLE_CITATION"),
    ("chatgpt-exporter-footer-v1", "ChatGPT Exporter 页脚", "footer", "EXPORTER_FOOTER"),
    ("thinking-summary-v1", "导出的思考摘要", "thinking_summary", "THINKING_SUMMARY"),
    ("manual-selection-v1", "手动选择的内容", "manual_selection", "MANUAL_SELECTION"),
)
MANUAL_SELECTION_DETECTOR = "manual-selection-v1"


def source_fingerprint(text: str) -> str:
    """Exact source bytes: canonical content hashes normalize offset-sensitive whitespace."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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
    r"(?i)(?<![\w])cite(?![\w])[\s\u200b]*(?:[☆★]\s*)?"
    r"turn\d+(?:search|news|view)\d+(?![\w])"
    r"(?:[☆★\s\u200b]*turn\d+(?:search|news|view)\d+(?![\w]))*[☆★]?"
)
REFERENCE_SEQUENCE = re.compile(
    r"(?<![\w])turn\d+(?:search|news|view)\d+(?![\w])"
    r"(?:[\s\u200b\ue000-\uf8ff*]*turn\d+(?:search|news|view)\d+(?![\w]))*",
    re.IGNORECASE,
)
EXPORTER_FOOTER = re.compile(
    r"(?s)(?:\A|(?:\r?\n)[ \t]*(?:\r?\n[ \t]*){0,1})(?:---[ \t]*\r?\n)?[ \t]*Powered by "
    r"(?:\[ChatGPT Exporter\]\(https://www\.chatgptexporter\.com\)|ChatGPT Exporter"
    r" \(https://www\.chatgptexporter\.com\))\s*\Z"
)


@dataclass(frozen=True)
class DetectedOccurrence:
    start: int
    end: int
    kind: str
    reason_code: str
    decision: str
    match_mode: str = "RAW_EXACT"
    evidence_codes: tuple[str, ...] = ()


class _DetectionContext:
    """One message/operation only; at most the two case-sensitivity profiles."""
    def __init__(self, text: str, protected: list[tuple[int, int]] | None = None):
        self.text = text
        self._protected = protected
        self._starts: list[int] | None = None
        self._shadows: dict[bool, tuple[str, Sequence[tuple[int, int]]]] = {}

    def shadow(self, *, case_sensitive: bool) -> tuple[str, Sequence[tuple[int, int]]]:
        if case_sensitive not in self._shadows:
            self._shadows[case_sensitive] = _shadow(self.text, case_sensitive=case_sensitive)
        return self._shadows[case_sensitive]

    def protects(self, start: int, end: int) -> bool:
        if self._protected is None:
            self._protected = protected_ranges(self.text)
        if self._starts is None:
            self._starts = [left for left, _right in self._protected]
        index = bisect_left(self._starts, end) - 1
        return index >= 0 and self._protected[index][1] > start


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
        if revision is None or revision.matcher_version != "noise-v4":
            revision = ContentCleanupRuleRevision(
                rule_id=rule.id,
                revision=(revision.revision + 1) if revision is not None else 1,
                matcher_version="noise-v4",
                matcher_mode="EXACT",
                normalization_profile="NONE",
                default_decision="KEEP",
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
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> ContentCleanupRule:
    from app.services.cleanup_rule_access import learn_literal
    rule, _revision = learn_literal(db, ownership_scope, name=name, match_value=match_value,
        case_sensitive=case_sensitive, role_filter=role_filter, matcher_mode=matcher_mode, boundary_mode=boundary_mode)
    return rule


def validate_literal_rule(value: str, matcher_mode: str) -> None:
    if not value or not value.strip() or len(value) > 500:
        raise ValueError("Noise rule text must contain 1-500 characters.")
    if matcher_mode == "APPROXIMATE" and len(value) < 6:
        raise ValueError("Approximate noise rules require at least 6 characters.")


def active_revisions(
    db: Session,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> list[ContentCleanupRuleRevision]:
    from app.services.cleanup_rule_access import available_versions, effective_revision
    ensure_builtin_rules(db)
    rows = available_versions(db, ownership_scope)
    return [effective_revision(revisions, preference) for rule, revisions, preference in
        sorted(rows.values(), key=lambda item: (item[0].detector_id or "", str(item[0].id)))]


def create_scan(
    db: Session,
    *,
    source: str,
    scope_type: str,
    conversation_ids: list[uuid.UUID],
    selection_message_id: uuid.UUID | None = None,
    selection_start_offset: int | None = None,
    selection_end_offset: int | None = None,
    selection_text: str | None = None,
    excluded_archived_count: int = 0,
    force_new: bool = False,
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
) -> tuple[ContentCleanupScan, BackgroundJob]:
    if not conversation_ids:
        raise ValueError("At least one active conversation is required.")
    revisions = active_revisions(db, ownership_scope)
    if not revisions:
        raise ValueError("No active cleanup rules are available.")
    conversations = (
        db.query(Conversation)
        .filter(
            Conversation.id.in_(conversation_ids),
            Conversation.status == "active",
            Conversation.deleted_at.is_(None),
            ownership_scope.predicate(Conversation),
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
        if selected_version is None:
            raise ValueError("The selected source range is invalid or empty.")
        normalized_selection = normalize_selection_offsets(
            selected_version.display_text,
            selection_start_offset,
            selection_end_offset,
        )
        if normalized_selection is None and selection_text:
            matches = [
                index
                for index in range(len(selected_version.display_text))
                if selected_version.display_text.startswith(selection_text, index)
            ]
            if len(matches) == 1:
                selection_start_offset = matches[0]
                selection_end_offset = matches[0] + len(selection_text)
                normalized_selection = (selection_start_offset, selection_end_offset)
        if normalized_selection is None:
            raise ValueError("The selected source range is invalid or empty.")
        selection_start_offset, selection_end_offset = normalized_selection
    wanted_ids = set(conversation_ids)
    wanted_revision_ids = {revision.id for revision in revisions}
    for existing in (
        db.query(ContentCleanupScan)
        .filter(ContentCleanupScan.status.in_(("QUEUED", "SCANNING", "READY", "APPLYING")))
        .order_by(ContentCleanupScan.created_at.desc())
        .limit(0 if force_new else 50)
        .all()
    ):
        from app.services.cleanup_scan_state import scan_job, scan_status
        if scan_status(existing, scan_job(db, existing)) in {"FAILED", "CANCELLED"}:
            continue
        if existing.source != source or existing.scope_type != scope_type:
            continue
        existing_ids = {
            row[0]
            for row in db.query(ContentCleanupScanTarget.conversation_id)
            .filter(ContentCleanupScanTarget.scan_id == existing.id)
            .all()
        }
        existing_revision_ids = {
            row[0]
            for row in db.query(ContentCleanupScanRule.rule_revision_id)
            .filter(ContentCleanupScanRule.scan_id == existing.id)
            .all()
        }
        same_selection = (
            existing.selection_message_id == selection_message_id
            and existing.selection_start_offset == selection_start_offset
            and existing.selection_end_offset == selection_end_offset
        )
        if existing_ids == wanted_ids and existing_revision_ids == wanted_revision_ids and same_selection and existing.background_job_id is not None:
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
        owner_user_id=ownership_scope.owner_user_id,
        source=source,
        scope_type=scope_type,
        status="QUEUED",
        total_messages=1 if has_selection else db.query(func.count(Message.id)).filter(
            Message.conversation_id.in_(conversation_ids),
            Message.is_deleted.is_(False),
            Message.current_version_id.is_not(None),
        ).scalar() or 0,
        excluded_archived_count=max(0, excluded_archived_count),
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
    for revision in revisions:
        db.add(ContentCleanupScanRule(scan_id=scan.id, rule_revision_id=revision.id))
    selection_binding = ({"selection_version_id": str(selected_version.id),
                          "selection_source_hash": source_fingerprint(selected_version.display_text)}
                         if has_selection else {})
    job = BackgroundJob(
        owner_user_id=ownership_scope.owner_user_id,
        job_type="content_noise_scan",
        status="queued",
        phase="queued",
        progress=0,
        processed_items=0,
        total_items=scan.total_messages,
        payload={"scan_id": str(scan.id), "cursor_message_id": None, **selection_binding},
        result={"scan_id": str(scan.id), "conversation_ids": [str(item.id) for item in conversations]},
    )
    db.add(job)
    db.flush()
    scan.background_job_id = job.id
    return scan, job


def process_scan_chunk(db: Session, scan_id: uuid.UUID, *, chunk_size: int = 250) -> dict[str, object]:
    from app.services.cleanup_learning import exception_digests, is_ignored
    scan = db.get(ContentCleanupScan, scan_id)
    if scan is None:
        raise ValueError("Noise scan not found.")
    snapshot_revision_ids = [
        row[0]
        for row in db.query(ContentCleanupScanRule.rule_revision_id)
        .filter(ContentCleanupScanRule.scan_id == scan_id)
        .all()
    ]
    scan_scope = OwnershipScope(scan.owner_user_id, include_legacy_unowned=scan.owner_user_id is None)
    revisions = (
        db.query(ContentCleanupRuleRevision)
        .join(ContentCleanupRule, ContentCleanupRule.id == ContentCleanupRuleRevision.rule_id)
        .filter(ContentCleanupRuleRevision.id.in_(snapshot_revision_ids))
        .order_by(ContentCleanupRule.detector_id, ContentCleanupRule.name, ContentCleanupRule.id)
        .all()
        if snapshot_revision_ids
        else active_revisions(db, scan_scope)
    )
    manual_revision = _manual_selection_revision(db) if scan.selection_message_id is not None else None
    ignored = exception_digests(db, scan_scope, [revision.id for revision in revisions])
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
    message_ids = [
        row[0]
        for row in query.with_entities(Message.id).order_by(Message.id.asc()).limit(chunk_size).all()
    ]
    if not message_ids:
        occurrence_count = db.query(ContentCleanupOccurrence).filter(ContentCleanupOccurrence.scan_id == scan_id).count()
        scan.status = "READY"
        scan.progress = 100
        scan.completed_at = utc_now()
        scan.cursor_message_id = None
        db.query(ContentCleanupScanTarget).filter(ContentCleanupScanTarget.scan_id == scan_id).update(
            {ContentCleanupScanTarget.status: "READY"},
            synchronize_session=False,
        )
        return {"done": True, "processed": scan.processed_messages, "total": scan.total_messages, "occurrences": occurrence_count}

    processed_in_chunk = 0
    last_message_id = None
    for message_id in message_ids:
        # Keep only bounded identifiers for the batch. Loading full display_text
        # for every row at once makes peak memory proportional to the sum of
        # message bodies rather than the largest single body.
        # Reuse every original scope predicate: a split/merge may have moved
        # the message outside the selected conversations since the ID page.
        row = query.filter(Message.id == message_id).one_or_none()
        if row is None:
            # The message may have been deleted or moved after the identifier
            # page was read. Advancing over it is safe: it is no longer in scope.
            last_message_id = message_id
            processed_in_chunk += 1
            continue
        message, version, _conversation = row
        source_hash = source_fingerprint(version.display_text)
        detection = _DetectionContext(version.display_text)
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
            for detected in detect_occurrences(message.role, version.display_text, rule, revision, context=detection):
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
                            "PROTECTED" if detected.decision == "PROTECTED" else "KEEP",
                            detected.match_mode,
                            (*detected.evidence_codes, "PARTIAL_SELECTION"),
                        )))
                        continue
                detected_rows.append((revision, detected))
        if scan.selection_message_id is not None:
            assert scan.selection_start_offset is not None and scan.selection_end_offset is not None
            selected_start, selected_end = scan.selection_start_offset, scan.selection_end_offset
            if not detected_rows and partial_rows:
                detected_rows.extend(partial_rows)
            elif not detected_rows and manual_revision is not None:
                protected = detection.protects(selected_start, selected_end)
                deletes_entire_message = not (version.display_text[:selected_start] + version.display_text[selected_end:]).strip()
                evidence_codes = ["MANUAL_SELECTION"]
                if protected:
                    evidence_codes.append("PROTECTED_RANGE")
                if deletes_entire_message:
                    evidence_codes.append("ENTIRE_MESSAGE")
                detected_rows.append((manual_revision, DetectedOccurrence(
                    selected_start,
                    selected_end,
                    "manual_selection",
                    "MANUAL_SELECTION",
                    "PROTECTED" if protected else "KEEP",
                    "MANUAL",
                    tuple(evidence_codes),
                )))
        deduped = deduplicate_occurrences(detected_rows)
        line_cursor, current_line = 0, 1

        def source_position(offset: int) -> tuple[int, int]:
            nonlocal line_cursor, current_line
            newline = version.display_text.rfind("\n", line_cursor, offset)
            if newline >= 0:
                current_line += version.display_text.count("\n", line_cursor, offset)
                line_cursor = newline + 1
            return current_line, offset - line_cursor + 1

        for revision, detected in sorted(deduped, key=lambda item: (item[1].start, item[1].end)):
            # Apply exceptions after detector precedence; otherwise a generic
            # overlapping detector would immediately recreate the ignored hit.
            if is_ignored(ignored, revision.id, message.role, version.display_text, detected.start, detected.end):
                continue
            line_start, column_start = source_position(detected.start)
            line_end, column_end = source_position(detected.end)
            db.add(ContentCleanupOccurrence(
                scan_id=scan.id,
                rule_revision_id=revision.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                message_version_id=version.id,
                source_content_hash=source_hash,
                start_offset=detected.start,
                end_offset=detected.end,
                line_start=line_start,
                column_start=column_start,
                line_end=line_end,
                column_end=column_end,
                kind=detected.kind,
                reason_code=detected.reason_code,
                decision=detected.decision,
                match_mode=detected.match_mode,
                evidence_codes=list(detected.evidence_codes),
            ))
            revision.rule.last_used_at = utc_now()
        last_message_id = message.id
        processed_in_chunk += 1
        # Do not retain a prior full source string or its ORM row while the next
        # message is loaded. Occurrence rows contain only bounded match metadata.
        del row, message, version, _conversation, detection, detected_rows, partial_rows, deduped
    scan.cursor_message_id = last_message_id
    scan.processed_messages += processed_in_chunk
    scan.progress = min(99, int(scan.processed_messages * 100 / max(scan.total_messages, 1)))
    scan.status = "SCANNING"
    return {"done": False, "processed": scan.processed_messages, "total": scan.total_messages, "occurrences": 0}


def detect_occurrences(
    role: str,
    text: str,
    rule: ContentCleanupRule,
    revision: ContentCleanupRuleRevision,
    *,
    context: _DetectionContext | None = None,
) -> list[DetectedOccurrence]:
    if context is None:
        context = _DetectionContext(text)
    elif context.text is not text:
        raise ValueError("Cleanup detection belongs to a different source.")
    values: list[DetectedOccurrence] = []
    detector_id = rule.detector_id
    if detector_id == "openai-private-citation-v1":
        values.extend(_detected(match.start(), match.end(), "citation", "PRIVATE_CITATION", "STRUCTURAL", ("PUA_WRAPPER", "REFERENCE_SEQUENCE")) for match in PRIVATE_CITATION.finditer(text))
        if "\ue200" in text or "\ue201" in text:
            values.extend(
                _detected(match.start(), match.end(), "citation", "PRIVATE_CITATION_BROKEN", "STRUCTURAL", ("REFERENCE_SEQUENCE", "MISSING_WRAPPER"))
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
                "STRUCTURAL",
                ("PUA_ENVELOPE", "UNCLASSIFIED_MARKER"),
            )
            for match in PRIVATE_MARKER_ENVELOPE.finditer(text)
            if PRIVATE_CITATION.fullmatch(match.group(0)) is None
        )
    elif detector_id == "visible-turn-citation-v1":
        values.extend(_detected(match.start(), match.end(), "citation", "VISIBLE_CITATION", "STRUCTURAL", ("REFERENCE_SEQUENCE",)) for match in VISIBLE_CITATION.finditer(text))
        values.extend(_tolerant_visible_citations(text, values))
    elif detector_id == "chatgpt-exporter-footer-v1":
        match = EXPORTER_FOOTER.search(text)
        if match:
            values.append(_detected(match.start(), match.end(), "footer", "EXPORTER_FOOTER", "STRUCTURAL", ("BLOCK_END",)))
    elif detector_id == "thinking-summary-v1":
        cleaned = clean_thinking_summary(role, text)
        if cleaned.removed and cleaned.start_offset is not None and cleaned.end_offset is not None:
            values.append(_detected(cleaned.start_offset, cleaned.end_offset, "thinking_summary", "THINKING_SUMMARY", "STRUCTURAL", ("PREFIX_BOUNDARY", "ANSWER_BOUNDARY")))
    elif revision.match_value:
        values.extend(_literal_occurrences(text, revision, context=context))
    result: list[DetectedOccurrence] = []
    for item in values:
        is_protected = context.protects(item.start, item.end)
        uncertain = item.match_mode == "BOUNDED_FUZZY" or detector_id == "openai-private-marker-v1"
        explanatory = _is_explanatory_example(text, item.start, item.end)
        if uncertain or explanatory:
            is_protected = True
        evidence_codes = (*item.evidence_codes, "PROTECTED_RANGE") if context.protects(item.start, item.end) else item.evidence_codes
        if (uncertain or explanatory) and "UNCERTAIN_CONTEXT" not in evidence_codes:
            evidence_codes = (*evidence_codes, "UNCERTAIN_CONTEXT")
        result.append(DetectedOccurrence(item.start, item.end, item.kind, item.reason_code, "PROTECTED" if is_protected else "KEEP", item.match_mode, evidence_codes))
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
                closing = re.match(closing_pattern, candidate.rstrip("\r\n"))
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
        if _is_escaped_delimiter(text, opening.start()) or any(start <= opening.start() < end for start, end in ranges):
            run_index += 1
            continue
        closing_index = run_index + 1
        while closing_index < len(inline_runs):
            closing = inline_runs[closing_index]
            if any(start <= closing.start() < end for start, end in ranges):
                run_index += 1
                break
            if len(closing.group(0)) == len(opening.group(0)) and not _is_escaped_delimiter(text, closing.start()):
                ranges.append((opening.start(), closing.end()))
                run_index = closing_index + 1
                break
            closing_index += 1
        else:
            run_index += 1
    for pattern in (
        re.compile(r"(?s)\$\$.*?\$\$|(?<!\$)\$[^$\n]+\$(?!\$)"),
        re.compile(r"(?s)\\\[.*?\\\]|\\\(.*?\\\)"),
        re.compile(r"(?m)^\s*\[[^\]]+\]:[ \t]*(?:<[^>\r\n]+>|\S+)(?:[ \t]+[^\r\n]*)?$"),
        re.compile(r"<(?:https?://|mailto:)[^>\n]+>"),
        re.compile(r"cr-asset://[0-9a-f-]{36}", re.IGNORECASE),
        re.compile(r"!?\[[^\]\n]*\]\((?:cr-asset://|attachment://)[^)\n]*\)", re.IGNORECASE),
        re.compile(r"!?\[[^\]\n]*\]\s*\[[^\]\n]*\]"),
        re.compile(r"\[\^[^\]\n]+\]"),
    ):
        ranges.extend((match.start(), match.end()) for match in pattern.finditer(text))
    # Markdown destinations can contain balanced/escaped parentheses. A plain
    # `[^)]` regex left the tail of those valid URLs exposed to bulk deletion.
    destination_cursor = 0
    for opening in re.finditer(r"\]\(", text):
        if opening.start() < destination_cursor:
            continue
        end, depth = opening.end(), 1
        while end < len(text) and text[end] != "\n" and depth:
            if text[end] == "\\" and end + 1 < len(text):
                end += 2
                continue
            if text[end] == "(":
                depth += 1
            elif text[end] == ")":
                depth -= 1
            end += 1
        ranges.append((opening.start(), end))
        destination_cursor = end
    return _merge_ranges(ranges)


def _is_escaped_delimiter(text: str, index: int) -> bool:
    backslashes = 0
    cursor = index - 1
    while cursor >= 0 and text[cursor] == "\\":
        backslashes += 1
        cursor -= 1
    return backslashes % 2 == 1


def _is_explanatory_example(text: str, start: int, end: int) -> bool:
    """Conservatively leave table cells, named fields and syntax examples alone."""
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    line = text[line_start:line_end if line_end >= 0 else len(text)]
    prefix = text[line_start:start]
    if line.count("|") >= 2:
        return True
    if re.search(r"(?:示例|例如|比如|字段|语法|标记说明|example|e\.g\.|field|syntax|literal)\s*(?:[:：=]|为|是)?[^\n]{0,100}$", prefix, re.IGNORECASE):
        return True
    if re.match(r'^\s*["\w.-]+["\']?\s*[:=：]\s*', prefix):
        return True
    return False


def _detected(start: int, end: int, kind: str, reason_code: str, match_mode: str, evidence_codes: tuple[str, ...]) -> DetectedOccurrence:
    return DetectedOccurrence(start, end, kind, reason_code, "KEEP", match_mode, evidence_codes)


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
    candidate_rank = (
        candidate.decision == "PROTECTED",
        candidate.match_mode == "STRUCTURAL",
        candidate.end - candidate.start,
    )
    current_rank = (
        current.decision == "PROTECTED",
        current.match_mode == "STRUCTURAL",
        current.end - current.start,
    )
    return candidate_rank > current_rank


def deduplicate_occurrences(rows: list[tuple[ContentCleanupRuleRevision, DetectedOccurrence]]) -> list[tuple[ContentCleanupRuleRevision, DetectedOccurrence]]:
    """Scanner and trials share source-span ownership and precedence."""
    result: list[tuple[ContentCleanupRuleRevision, DetectedOccurrence]] = []
    for revision, candidate in rows:
        overlapping = [
            index for index, (_revision, previous) in enumerate(result)
            if candidate.start < previous.end and previous.start < candidate.end
        ]
        if not overlapping:
            result.append((revision, candidate))
        elif all(_prefer_detected_occurrence(candidate, result[index][1]) for index in overlapping):
            result = [item for index, item in enumerate(result) if index not in overlapping]
            result.append((revision, candidate))
    return result


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
            if start > 0 and (text[start - 1].isalnum() or text[start - 1] == "_"):
                continue
            raw_token = text[start:references.start()]
            if "_" in raw_token:
                continue  # Identifier underscores are not exporter damage.
            token = _syntax_token(raw_token)
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
        if start > 0 and (text[start - 1].isalnum() or text[start - 1] == "_"):
            continue
        if end < len(text) and (text[end].isalnum() or text[end] == "_"):
            continue
        if _covered(start, end, existing) or _covered(start, end, result):
            continue
        if distance == 0:
            result.append(_detected(
                start,
                end,
                "citation",
                "VISIBLE_CITATION_NORMALIZED",
                match_mode,
                ("SYNTAX_TOKEN_NFKC", "REFERENCE_SEQUENCE", f"TOKEN_{target.upper()}"),
            ))
        else:
            result.append(_detected(
                start,
                end,
                "citation",
                "VISIBLE_CITATION_FUZZY_TOKEN",
                match_mode,
                ("SYNTAX_TOKEN_EDIT_DISTANCE_1", "REFERENCE_SEQUENCE", f"TOKEN_{target.upper()}"),
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


def _shadow(text: str, *, case_sensitive: bool) -> tuple[str, Sequence[tuple[int, int]]]:
    return normalized_shadow(text, case_sensitive=case_sensitive, compact=True)


def _literal_occurrences(
    text: str,
    revision: ContentCleanupRuleRevision,
    *,
    context: _DetectionContext | None = None,
) -> list[DetectedOccurrence]:
    value = revision.match_value
    if not value:
        return []
    mode = getattr(revision, "matcher_mode", "EXACT")
    if mode == "EXACT":
        flags = 0 if revision.case_sensitive else re.IGNORECASE
        pattern = re.compile(re.escape(value), flags)
        return [_detected(match.start(), match.end(), "custom", "USER_LITERAL", "RAW_EXACT", ("LITERAL_EXACT",)) for match in pattern.finditer(text) if _boundary_allows(text, match.start(), match.end(), getattr(revision, "boundary_mode", "ANYWHERE"))]
    shadow, mapping = (
        context.shadow(case_sensitive=revision.case_sensitive) if context is not None
        else _shadow(text, case_sensitive=revision.case_sensitive)
    )
    needle, _ = _shadow(value, case_sensitive=revision.case_sensitive)
    if not needle:
        return []
    result: list[DetectedOccurrence] = []
    if mode == "NORMALIZED":
        seen: set[tuple[int, int]] = set()
        for start in _find_all(shadow, needle):
            end = start + len(needle)
            original_start, original_end = source_span(mapping, start, end)
            if (original_start, original_end) not in seen and _boundary_allows(text, original_start, original_end, getattr(revision, "boundary_mode", "ANYWHERE")):
                seen.add((original_start, original_end))
                result.append(_detected(original_start, original_end, "custom", "USER_LITERAL_NORMALIZED", "NORMALIZED_EXACT", ("NFKC", "WHITESPACE_NORMALIZED")))
        return result
    exact_ranges: set[tuple[int, int]] = set()
    for start in _find_all(shadow, needle):
        end = start + len(needle)
        original_start, original_end = source_span(mapping, start, end)
        if (original_start, original_end) not in exact_ranges and _boundary_allows(text, original_start, original_end, getattr(revision, "boundary_mode", "ANYWHERE")):
            exact_ranges.add((original_start, original_end))
            result.append(_detected(original_start, original_end, "custom", "USER_LITERAL_NORMALIZED", "NORMALIZED_EXACT", ("LITERAL_EXACT", "NFKC")))
    max_edits = max(1, min(getattr(revision, "max_edit_distance", None) or 1, 2))
    window = len(needle)
    if window < 6:
        # Normalization can shorten a valid literal. Retain exact matches, but
        # do not admit fuzzy matching of the resulting short needle.
        return result
    anchors = _fuzzy_anchor_starts(shadow, needle, limit=MAX_APPROXIMATE_CANDIDATES_PER_MESSAGE, max_edits=max_edits)
    proposals: list[tuple[int, int, int, int]] = []
    for start in anchors:
        best: tuple[int, int] | None = None
        for candidate_length in range(max(1, window - max_edits), window + max_edits + 1):
            if start + candidate_length > len(shadow):
                continue
            original_start, original_end = source_span(mapping, start, start + candidate_length)
            if not _boundary_allows(text, original_start, original_end, getattr(revision, "boundary_mode", "ANYWHERE")):
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
        original_start, original_end = source_span(mapping, start, start + candidate_length)
        proposals.append((distance, abs(candidate_length - window), original_start, original_end))
    # One source fragment is one candidate, not shifted fuzzy windows around
    # an exact match or multiple expansions of the same Unicode source atom.
    accepted = list(result)
    for distance, _length_delta, original_start, original_end in sorted(proposals):
        if _overlaps(original_start, original_end, accepted):
            continue
        accepted.append(_detected(original_start, original_end, "custom", "USER_LITERAL_APPROXIMATE", "BOUNDED_FUZZY", ("LITERAL_ANCHORED", f"EDIT_DISTANCE_{distance}")))
    return sorted(accepted, key=lambda item: (item.start, item.end))


def _find_all(text: str, needle: str) -> list[int]:
    positions: list[int] = []
    cursor = 0
    while True:
        index = text.find(needle, cursor)
        if index < 0:
            return positions
        positions.append(index)
        cursor = index + max(1, len(needle))


def _fuzzy_anchor_starts(text: str, needle: str, *, limit: int, max_edits: int = 2) -> list[int]:
    width = min(4, max(2, len(needle) // 4))
    offsets = sorted({0, max(0, len(needle) // 2 - width // 2), len(needle) - width})
    by_anchor: list[list[int]] = []
    for offset in offsets:
        anchor = needle[offset:offset + width]
        cursor = 0
        found_starts: list[int] = []
        shifts = [0, *(shift for distance in range(1, max_edits + 1) for shift in (-distance, distance))]
        while len(found_starts) < limit:
            found = text.find(anchor, cursor)
            if found < 0:
                break
            for shift in shifts:
                candidate_start = found - offset + shift
                if candidate_start >= 0:
                    found_starts.append(candidate_start)
            cursor = found + 1
        by_anchor.append(found_starts)
    starts: list[int] = []
    seen: set[int] = set()
    cursor = 0
    while len(starts) < limit and by_anchor:
        bucket = by_anchor[cursor % len(by_anchor)]
        index = cursor // len(by_anchor)
        if index >= len(bucket):
            if all(index >= len(item) for item in by_anchor):
                break
            cursor += 1
            continue
        value = bucket[index]
        if value not in seen:
            seen.add(value)
            starts.append(value)
        cursor += 1
    return sorted(starts)


_BOUNDARY_WHITESPACE = re.compile(r"\s*")
_LINE_BOUNDARY_WHITESPACE = re.compile(r"[^\S\n]*")


def _boundary_allows(text: str, start: int, end: int, mode: str) -> bool:
    if mode == "WHOLE_LINE":
        # Bounded prefix windows avoid repeated whole-prefix searches/copies.
        # Regex positions keep long whitespace runs in C without slicing.
        cursor = start
        while cursor:
            left = max(0, cursor - 256)
            newline = text.rfind("\n", left, cursor)
            if _BOUNDARY_WHITESPACE.fullmatch(text, newline + 1 if newline >= 0 else left, cursor) is None:
                return False
            if newline >= 0:
                break
            cursor = left
        suffix_end = _LINE_BOUNDARY_WHITESPACE.match(text, end).end()
        return suffix_end == len(text) or text[suffix_end] == "\n"
    if mode == "BLOCK_END":
        return _BOUNDARY_WHITESPACE.match(text, end).end() == len(text)
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
    rule_id: uuid.UUID | None = None,
    conversation_id: uuid.UUID | None = None,
    selected_only: bool = False,
    occurrence_id: uuid.UUID | None = None,
) -> list[dict[str, object]]:
    from app.services.cleanup_review import filter_occurrences
    from app.services.cleanup_ranges import range_edit_token
    from app.services.cleanup_rule_access import canonical_rule_id, personal_name
    from app.services.cleanup_protection import protection_types, reviewed_fingerprint
    scan = db.get(ContentCleanupScan, scan_id)
    query = (
        db.query(
            ContentCleanupOccurrence,
            Message,
            Conversation,
            ContentCleanupRule,
            ContentCleanupRuleRevision,
        )
        .join(Message, Message.id == ContentCleanupOccurrence.message_id)
        .join(Conversation, Conversation.id == ContentCleanupOccurrence.conversation_id)
        .join(ContentCleanupRuleRevision, ContentCleanupRuleRevision.id == ContentCleanupOccurrence.rule_revision_id)
        .join(ContentCleanupRule, ContentCleanupRule.id == ContentCleanupRuleRevision.rule_id)
        .filter(ContentCleanupOccurrence.scan_id == scan_id)
    )
    if occurrence_id is not None:
        query = query.filter(ContentCleanupOccurrence.id == occurrence_id)
    rows = (
        filter_occurrences(query, rule_id=rule_id, conversation_id=conversation_id, selected_only=selected_only)
        .order_by(ContentCleanupOccurrence.conversation_id, ContentCleanupOccurrence.message_id, ContentCleanupOccurrence.start_offset)
        .offset(offset)
        .limit(limit)
        .all()
    )
    result: list[dict[str, object]] = []
    source_version_id = None
    text = None
    fingerprint = ""
    for occurrence, message, conversation, rule, revision in rows:
        if source_version_id != occurrence.message_version_id:
            # Page only metadata above. Fetch one source, without plain_text or
            # blocks, and reuse it for adjacent matches in the same version.
            # Release the previous source before fetching the next one.
            text = None
            text = db.query(MessageVersion.display_text).filter(
                MessageVersion.id == occurrence.message_version_id,
            ).scalar()
            source_version_id = occurrence.message_version_id
            fingerprint = source_fingerprint(text) if text is not None else ""
        if text is None:
            continue  # A historical version may have disappeared after paging.
        start = max(0, occurrence.start_offset - context)
        end = min(len(text), occurrence.end_offset + context)
        result.append({
            "id": str(occurrence.id),
            "conversation_id": str(occurrence.conversation_id),
            "conversation_title": conversation.display_title,
            "message_id": str(occurrence.message_id),
            "message_version_id": str(occurrence.message_version_id),
            "role": message.role,
            "rule_id": str(canonical_rule_id(db, rule.id)),
            "rule_name": personal_name(db, scan.owner_user_id, rule),
            "detector_id": rule.detector_id,
            "kind": occurrence.kind,
            "reason_code": occurrence.reason_code,
            "decision": occurrence.decision,
            "match_mode": occurrence.match_mode,
            "evidence_codes": occurrence.evidence_codes or [],
            "reviewed_ranges": occurrence.reviewed_ranges,
            "edit_token": range_edit_token(occurrence),
            "start_offset": occurrence.start_offset,
            "end_offset": occurrence.end_offset,
            "line_start": occurrence.line_start,
            "column_start": occurrence.column_start,
            "match_text": text[occurrence.start_offset:occurrence.end_offset],
            "context_before": text[start:occurrence.start_offset],
            "context_after": text[occurrence.end_offset:end],
            "stale": message.current_version_id != source_version_id or occurrence.source_content_hash != fingerprint,
            "match_value": revision.match_value,
            "rule_revision_id": str(revision.id),
            "rule_revision": revision.revision,
            "rule_settings": {
                "match_value": revision.match_value, "case_sensitive": revision.case_sensitive,
                "role_filter": revision.role_filter, "scope": rule.scope,
                "matcher_mode": revision.matcher_mode, "boundary_mode": revision.boundary_mode,
                "normalization_profile": revision.normalization_profile, "matcher_version": revision.matcher_version,
            },
            "protection_confirmed": reviewed_fingerprint(occurrence, fingerprint),
            "protection_types": protection_types(occurrence),
        })
    return result


def update_decisions(db: Session, scan_id: uuid.UUID, decisions: dict[uuid.UUID, str], *,
                     protection_token: str | None = None, _protection_digest: str | None = None) -> None:
    from app.services.cleanup_protection import authorize, confirm, requires_review, reviewed
    scan = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one_or_none()
    if scan is None or scan.status != "READY":
        raise ValueError("Wait for this scan to be ready before changing decisions.")
    if protection_token:
        _protection_digest = authorize(db, scan_id, protection_token, occurrence_ids=list(decisions))
    rows = db.query(ContentCleanupOccurrence).filter(ContentCleanupOccurrence.scan_id == scan_id, ContentCleanupOccurrence.id.in_(list(decisions))).all()
    if len(rows) != len(decisions):
        raise ValueError("One or more cleanup candidates do not belong to this scan.")
    sources: dict[uuid.UUID, _SourceAnalysis] = {}
    for row in rows:
        decision = decisions[row.id]
        if decision not in {"DELETE", "KEEP"}:
            raise ValueError("Noise decision must be DELETE or KEEP.")
        if row.decision in {"CONFLICT", "APPLIED"}:
            continue
        source = sources.get(row.message_version_id)
        if source is None:
            source_text = db.query(MessageVersion.display_text).filter(
                MessageVersion.id == row.message_version_id,
            ).scalar()
            if source_text is None:
                row.decision = "CONFLICT"
                continue
            source = _SourceAnalysis(source_text)
            sources[row.message_version_id] = source
        if row.source_content_hash != source.fingerprint:
            row.decision = "CONFLICT"
            continue
        message = db.get(Message, row.message_id)
        conversation = db.get(Conversation, row.conversation_id)
        if (message is None or message.is_deleted or message.current_version_id != row.message_version_id
                or conversation is None or conversation.status != "active" or conversation.deleted_at):
            row.decision = "CONFLICT"
            continue
        if requires_review(row, source):
            if decision == "DELETE":
                if _protection_digest:
                    confirm(row, source, set_digest=_protection_digest)
                if not reviewed(row, source):
                    raise ValueError("Protected source requires a current protection preview and explicit confirmation.")
            else:
                row.decision = "PROTECTED"
                row.decision_updated_at = utc_now()
                continue
        row.decision = decision
        row.decision_updated_at = utc_now()


def apply_scan(db: Session, scan_id: uuid.UUID) -> dict[str, object]:
    scan = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one_or_none()
    now = utc_now()
    lease = scan.apply_lease_until if scan else None
    if lease and lease.tzinfo is None:
        lease = lease.replace(tzinfo=timezone.utc)
    if scan is None or scan.status not in {"READY", "APPLYING"}:
        raise ValueError("Noise scan is not ready to apply.")
    if scan.status == "APPLYING" and lease and lease > now:
        raise ValueError("This review is already being applied. Retry after the current operation completes.")
    scan.apply_lease_until = now + timedelta(minutes=5)
    try:
        return _apply_scan(db, scan_id)
    except Exception:
        db.rollback()
        scan = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one_or_none()
        if scan is not None:
            scan.status = "READY"
            scan.apply_lease_until = None
            scan.error_message = "Apply interrupted. Completed changes were retained; retry the remaining selections."
            db.commit()
        raise


def recover_expired_apply(db: Session, scan: ContentCleanupScan) -> ContentCleanupScan:
    if scan.status != "APPLYING":
        return scan
    scan = db.query(ContentCleanupScan).filter_by(id=scan.id).populate_existing().with_for_update().one()
    lease = scan.apply_lease_until
    if lease and lease.tzinfo is None:
        lease = lease.replace(tzinfo=timezone.utc)
    if scan.status == "APPLYING" and (lease is None or lease <= utc_now()):
        scan.status = "READY"
        scan.apply_lease_until = None
        scan.error_message = "Apply was interrupted. Completed changes are retained; review and retry remaining selections."
        db.commit()
    return scan


def _apply_scan(db: Session, scan_id: uuid.UUID) -> dict[str, object]:
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
    for conversation_index, (conversation_id, occurrences) in enumerate(grouped.items()):
        scan = db.query(ContentCleanupScan).filter_by(id=scan_id).populate_existing().with_for_update().one()
        scan.apply_lease_until = utc_now() + timedelta(minutes=5)
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
        # Acquire all affected message locks before any version write can lock
        # the conversation row. This avoids inverted locks with another editor.
        locked_messages = {message.id: message for message in db.query(Message).filter(
            Message.id.in_(by_message)
        ).order_by(Message.id).populate_existing().with_for_update(key_share=True).all()}
        for message_id, message_occurrences in by_message.items():
            message = locked_messages.get(message_id)
            if message is None or message.is_deleted:
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
            version = _get_current_version(db, message)
            source_hash = source_fingerprint(version.display_text)
            if any(version.id != item.message_version_id or source_hash != item.source_content_hash for item in message_occurrences):
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
            text = version.display_text
            from app.services.cleanup_ranges import occurrence_ranges
            try:
                ranges = sorted(span for item in message_occurrences for span in occurrence_ranges(item))
            except ValueError:
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
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
            validation = _MessageValidation(message.role, text)
            if any(not _occurrence_still_matches(db, message.role, text, item, validation) for item in message_occurrences):
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
                continue
            parts, cursor = [], 0
            for start, end in ranges:
                parts.append(text[cursor:start])
                cursor = end
            parts.append(text[cursor:])
            text = "".join(parts)
            if not text.strip():
                conflicts += len(message_occurrences)
                for occurrence in message_occurrences:
                    occurrence.decision = "CONFLICT"
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
            from app.services.cleanup_rule_access import grant_revision
            for occurrence in message_occurrences:
                occurrence.decision = "APPLIED"
                grant_revision(db, OwnershipScope(scan.owner_user_id), db.get(ContentCleanupRuleRevision, occurrence.rule_revision_id), reason="USED")
            conversation_applied = True
        if conversation_applied:
            rebuild_search_and_toc_for_conversation(db, conversation_id)
        # Earlier conversations remain resumable. The final conversation and
        # completion receipt share the caller's final commit, with no gap in
        # which all content changed but the completed result disappeared.
        if conversation_index + 1 < len(grouped):
            db.commit()
        scan = db.get(ContentCleanupScan, scan_id)
        if scan is None:
            raise ValueError("Noise scan disappeared while applying decisions.")
    scan.status = "READY" if conflicts else "COMPLETED"
    scan.apply_lease_until = None
    scan.completed_at = utc_now()
    if conflicts:
        scan.error_message = f"{conflicts} noise matches need review because their message version changed or the deletion was unsafe."
    else:
        from app.services.cleanup_outcomes import save_completed_outcome
        save_completed_outcome(db, scan, {"applied": applied, "conflicts": conflicts})
        db.query(ContentCleanupOccurrence).filter(ContentCleanupOccurrence.scan_id == scan_id).delete(synchronize_session=False)
        db.query(ContentCleanupScanTarget).filter(ContentCleanupScanTarget.scan_id == scan_id).delete(synchronize_session=False)
        db.delete(scan)
    return {"applied": applied, "conflicts": conflicts}


def dismiss_scan(db: Session, scan_id: uuid.UUID, *, ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE) -> None:
    from app.services.cleanup_outcomes import dismissed_job, save_dismissed_outcome
    scan = db.query(ContentCleanupScan).filter(ContentCleanupScan.id == scan_id, ownership_scope.predicate(ContentCleanupScan)).populate_existing().with_for_update().one_or_none()
    if scan is None:
        if dismissed_job(db, scan_id, ownership_scope):
            return
        raise ValueError("Noise scan not found.")
    from app.services.cleanup_scan_state import scan_job, scan_status
    if scan_status(scan, scan_job(db, scan)) in {"QUEUED", "SCANNING", "APPLYING"}:
        raise ValueError("Wait for the cleanup scan to finish before dismissing it.")
    save_dismissed_outcome(db, scan)
    db.delete(scan)


class _SourceAnalysis:
    """Transient exact fingerprint and protected-region index; never persisted."""
    def __init__(self, text: str):
        self.fingerprint = source_fingerprint(text)
        self.protected = protected_ranges(text)
        self.starts = [start for start, _end in self.protected]

    def protects(self, start: int, end: int) -> bool:
        index = bisect_left(self.starts, end) - 1
        return index >= 0 and self.protected[index][1] > start


class _MessageValidation:
    """One request/message/role only; each admitted revision is evaluated once."""
    def __init__(self, role: str, text: str):
        self.role, self.text = role, text
        self.source = _SourceAnalysis(text)
        self.detection = _DetectionContext(text, self.source.protected)
        self.matches: dict[uuid.UUID, set[tuple[int, int]] | None] = {}
        self.persisted_versions: dict[uuid.UUID, bool] = {}

    def has_persisted_version(self, db: Session, version_id: uuid.UUID) -> bool:
        if version_id not in self.persisted_versions:
            self.persisted_versions[version_id] = db.query(MessageVersion.id).filter(
                MessageVersion.id == version_id,
            ).first() is not None
        return self.persisted_versions[version_id]

    def matching_ranges(self, db: Session, revision_id: uuid.UUID) -> set[tuple[int, int]] | None:
        if revision_id not in self.matches:
            revision = db.get(ContentCleanupRuleRevision, revision_id)
            rule = db.get(ContentCleanupRule, revision.rule_id) if revision is not None else None
            if revision is None or rule is None or (rule.scope == "ASSISTANT_ONLY" and self.role != "assistant") or (revision.role_filter and revision.role_filter != self.role):
                self.matches[revision_id] = set()
            elif rule.detector_id == MANUAL_SELECTION_DETECTOR:
                self.matches[revision_id] = None
            else:
                self.matches[revision_id] = {(item.start, item.end) for item in detect_occurrences(
                    self.role, self.text, rule, revision, context=self.detection,
                )}
        return self.matches[revision_id]


def _occurrence_still_matches(db: Session, role: str, text: str, occurrence: ContentCleanupOccurrence, validation: _MessageValidation | None = None) -> bool:
    if occurrence.decision_updated_at is None:
        return False
    validation = validation or _MessageValidation(role, text)
    if validation.role != role or validation.text != text:
        raise ValueError("Cleanup validation belongs to a different source.")
    if (not validation.has_persisted_version(db, occurrence.message_version_id)
            or occurrence.source_content_hash != validation.source.fingerprint):
        return False
    from app.services.cleanup_protection import requires_review, reviewed
    if requires_review(occurrence, validation.source):
        if not reviewed(occurrence, validation.source):
            return False
    ranges = validation.matching_ranges(db, occurrence.rule_revision_id)
    if ranges is None:
        return 0 <= occurrence.start_offset < occurrence.end_offset <= len(text)
    return (occurrence.start_offset, occurrence.end_offset) in ranges


def _manual_selection_revision(db: Session) -> ContentCleanupRuleRevision:
    for revision in ensure_builtin_rules(db):
        if revision.rule.detector_id == MANUAL_SELECTION_DETECTOR:
            return revision
    raise ValueError("The manual selection cleanup rule is unavailable.")


def normalize_selection_offsets(
    text: str,
    start_offset: int,
    end_offset: int,
) -> tuple[int, int] | None:
    """Accept canonical code-point offsets and recover legacy UTF-16 offsets.

    CodeMirror and browser Selection APIs expose UTF-16 code-unit positions in
    some paths, while the cleanup contract stores Unicode code-point offsets.
    If a client sends a range that only fits the UTF-16 length (usually because
    an emoji precedes the selection), convert it before validating.  Valid
    code-point offsets are left untouched, so this remains backwards compatible.
    """
    if start_offset < 0 or end_offset <= start_offset:
        return None
    code_point_length = len(text)
    if end_offset <= code_point_length:
        return start_offset, end_offset
    utf16_length = len(text.encode("utf-16-le")) // 2
    if end_offset > utf16_length:
        return None

    def utf16_to_code_point(offset: int) -> int:
        consumed = 0
        for index, character in enumerate(text):
            units = 2 if ord(character) > 0xFFFF else 1
            if consumed + units > offset:
                return index
            consumed += units
            if consumed == offset:
                return index + 1
        return len(text)

    converted_start = utf16_to_code_point(start_offset)
    converted_end = utf16_to_code_point(end_offset)
    if converted_end <= converted_start:
        return None
    return converted_start, converted_end


def queue_import_scan(
    db: Session,
    conversation_ids: list[uuid.UUID],
    ownership_scope: OwnershipScope = LEGACY_OWNERSHIP_SCOPE,
    *,
    source_import_id: uuid.UUID | None = None,
) -> ContentCleanupScan | None:
    """Queue a post-import review without delaying the canonical import commit."""
    if not conversation_ids:
        return None
    scan, job = create_scan(
        db,
        source="IMPORT",
        scope_type="IMPORT_RESULT",
        conversation_ids=conversation_ids,
        ownership_scope=ownership_scope,
    )
    if source_import_id is not None:
        job.payload = {**(job.payload or {}), "parent_task_id": str(source_import_id)}
        job.result = {**(job.result or {}), "parent_task_id": str(source_import_id)}
    return scan
