from __future__ import annotations

import unicodedata
import hashlib
import re
import string
import uuid
from array import array
from bisect import bisect_left
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.entities import html5

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
_QUOTE_PREFIX = re.compile(r" {0,3}> ?")
_LIST_PREFIX = re.compile(r" {0,3}(?P<marker>[*+-]|[0-9]{1,9}[.)])(?P<padding> +|$)")
_FENCE_OPENING = re.compile(r" {0,3}(`{3,}|~{3,})(.*)$")
_MATH_FENCE_OPENING = re.compile(r" {0,3}(\${2,})[^$]*$")
_HTML_BLOCK_PREFIX = re.compile(r" {0,3}<")
_HTML_RAW_NAMES = frozenset(("pre", "script", "style", "textarea"))
_HTML_BLOCK_NAMES = frozenset(
    "address article aside base basefont blockquote body caption center col colgroup "
    "dd details dialog dir div dl dt fieldset figcaption figure footer form frame "
    "frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu "
    "menuitem nav noframes ol optgroup option p param search section summary table "
    "tbody td tfoot th thead title tr track ul".split()
)
_HTML_BLOCK_CLOSERS = {
    1: re.compile(r"</(?:pre|script|style|textarea)>", re.IGNORECASE | re.ASCII),
    2: re.compile(r"-->"),
    3: re.compile(r"\?>"),
    4: re.compile(r">"),
    5: re.compile(r"\]\]>"),
}
_ATX_HEADING = re.compile(r" {0,3}#{1,6}(?: |$)")
_THEMATIC_BREAK = re.compile(r" {0,3}(?:(?:\* *){3,}|(?:- *){3,}|(?:_ *){3,})$")
_SETEXT_UNDERLINE = re.compile(r" {0,3}(?:=+|-+) *$")
_EXAMPLE_KEYWORD = re.compile(
    # Cheaply reject impossible starts before trying the full alternatives.
    # Both assertions stay zero-width, retaining overlapping keyword captures.
    r"(?=[示例比字语标efsl])"
    r"(?=(示例|例如|比如|字段|语法|标记说明|example|e\.g\.|field|syntax|literal))",
    re.IGNORECASE,
)
_EXAMPLE_WHITESPACE = re.compile(r"[^\S\n]*")
_EXAMPLE_FIELD = re.compile(r'''(?m)^[^\S\n]*["\w.-]+["']?[^\S\n]*[:=：]''')


@dataclass(frozen=True)
class DetectedOccurrence:
    start: int
    end: int
    kind: str
    reason_code: str
    decision: str
    match_mode: str = "RAW_EXACT"
    evidence_codes: tuple[str, ...] = ()


class _ExplanatoryIndex:
    """Source-coordinate lookups for table cells, fields and nearby examples."""
    def __init__(self, text: str):
        self._length = len(text)
        self._newlines = array("Q", (match.start() for match in re.finditer("\n", text)))
        self._pipes = array("Q", (match.start() for match in re.finditer(r"\|", text)))
        eligible: list[tuple[int, int]] = []
        for match in _EXAMPLE_KEYWORD.finditer(text):
            # The lookahead retains overlapping keywords (e.g. examplexample).
            start = match.end(1)
            cursor = _EXAMPLE_WHITESPACE.match(text, start).end()
            if cursor < len(text) and text[cursor] in ":：=为是":
                cursor += 1
            # Eligibility concerns a candidate's start, including the LF itself.
            eligible.append((start, min(self._line_end(start), cursor + 100) + 1))
        for match in _EXAMPLE_FIELD.finditer(text):
            start = match.end()
            eligible.append((start, self._line_end(start) + 1))
        merged = _merge_ranges(eligible)
        self._starts = array("Q", (start for start, _end in merged))
        self._ends = array("Q", (end for _start, end in merged))

    def _line_end(self, offset: int) -> int:
        index = bisect_left(self._newlines, offset)
        return self._newlines[index] if index < len(self._newlines) else self._length

    def protects(self, start: int, end: int) -> bool:
        index = bisect_left(self._starts, start + 1) - 1
        if index >= 0 and self._ends[index] > start:
            return True
        if len(self._pipes) < 2:
            return False
        # A multiline candidate includes its starting and ending source lines,
        # not just pipes within the candidate or on its starting line.
        index = bisect_left(self._newlines, start)
        line_start = self._newlines[index - 1] + 1 if index else 0
        return (
            bisect_left(self._pipes, self._line_end(end))
            - bisect_left(self._pipes, line_start)
        ) >= 2


class _DetectionContext:
    """One message/operation only; at most the two case-sensitivity profiles."""
    def __init__(self, text: str, protected: list[tuple[int, int]] | None = None):
        self.text = text
        self._protected = protected
        self._starts: list[int] | None = None
        self._shadows: dict[bool, tuple[str, Sequence[tuple[int, int]]]] = {}
        self._examples: _ExplanatoryIndex | None = None

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

    def explanatory(self, start: int, end: int) -> bool:
        if self._examples is None:
            self._examples = _ExplanatoryIndex(self.text)
        return self._examples.protects(start, end)


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
        if "\n" not in version.display_text:
            def source_position(offset: int) -> tuple[int, int]:
                return 1, offset + 1
        else:
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
        explanatory = context.explanatory(item.start, item.end)
        if uncertain or explanatory:
            is_protected = True
        evidence_codes = (*item.evidence_codes, "PROTECTED_RANGE") if context.protects(item.start, item.end) else item.evidence_codes
        if (uncertain or explanatory) and "UNCERTAIN_CONTEXT" not in evidence_codes:
            evidence_codes = (*evidence_codes, "UNCERTAIN_CONTEXT")
        result.append(DetectedOccurrence(item.start, item.end, item.kind, item.reason_code, "PROTECTED" if is_protected else "KEEP", item.match_mode, evidence_codes))
    return result


def protected_ranges(text: str) -> list[tuple[int, int]]:
    ranges: list[tuple[int, int]] = []
    html_exclusions: list[tuple[int, int]] = []
    html_flow_ranges: list[tuple[int, int]] = []
    inline_boundaries = [0]
    attention_exclusions: list[tuple[int, int]] = []
    reference_definitions: set[str] = set()
    reference_definition_ranges: list[tuple[int, int]] = []
    lines = list(re.finditer(r".*(?:\n|$)", text))
    index = 0
    containers: tuple[int, ...] = ()
    empty_item_depth: int | None = None
    paragraph_open = False
    table_open = False
    while index < len(lines):
        line = lines[index]
        value = line.group(0).rstrip("\r\n").expandtabs(4)
        if empty_item_depth is not None:
            parents = containers[:empty_item_depth]
            parent_start = _fence_content_start(value, parents)
            if parent_start is not None and not value[parent_start:].strip(" "):
                # An initially empty item cannot resume after another blank
                # line. Preserve its parents, not its continuation indent.
                containers = parents
            empty_item_depth = None
        previous_containers = containers
        content_start, containers, opened_container = _markdown_container_prefix(value, containers, paragraph_open)
        table_continues = table_open and containers == previous_containers and not opened_container
        table_open = False
        raw_prefix = 0
        if content_start:
            # Container columns use expanded tabs, but all downstream spans
            # refer to unchanged source. Visit each short prefix just once.
            raw_prefix = column = 0
            for character in line.group(0):
                if column >= content_start:
                    break
                column += 4 - column % 4 if character == "\t" else 1
                raw_prefix += 1
            attention_exclusions.append((line.start(), line.start() + raw_prefix))
        if opened_container:
            paragraph_open = False
            inline_boundaries.append(line.start())
        html_kind = _html_block_opening(value, content_start, paragraph_open)
        if html_kind is not None:
            paragraph_open = False
            start = line.start()
            end = line.end()
            closing = _HTML_BLOCK_CLOSERS.get(html_kind)
            closing_match = closing.search(value, content_start) if closing is not None else None
            finished = closing_match is not None
            index += 1
            while index < len(lines) and not finished:
                candidate = lines[index].group(0).rstrip("\r\n").expandtabs(4)
                candidate_start = _fence_content_start(candidate, containers)
                if candidate_start is None or (
                    closing is None and not candidate[candidate_start:].strip(" ")
                ):
                    break
                end = lines[index].end()
                closing_match = closing.search(candidate, candidate_start) if closing is not None else None
                index += 1
                finished = closing_match is not None
            html_exclusions.append((start, end))
            html_flow_ranges.append((start, end))
            inline_boundaries.extend((start, end))
            continue
        fence = _fence_opening(value, content_start)
        if fence is not None:
            marker = fence
            paragraph_open = False
            closing_pattern = re.compile(rf" {{0,3}}{re.escape(marker[0])}{{{len(marker)},}} *$")
            start = line.start()
            end = line.end()
            index += 1
            while index < len(lines):
                candidate = lines[index].group(0).rstrip("\r\n").expandtabs(4)
                content_start = _fence_content_start(candidate, containers)
                if content_start is None:
                    # An unclosed fence ends with its list/quote container.
                    # Reprocess this line as ordinary source, not code.
                    break
                end = lines[index].end()
                index += 1
                if closing_pattern.fullmatch(candidate, content_start):
                    end = lines[index - 1].start() + len(lines[index - 1].group(0).rstrip("\r\n"))
                    break
            ranges.append((start, end))
            inline_boundaries.extend((start, end))
            continue
        if (
            not value.startswith("    ", content_start)
            and not _ATX_HEADING.match(value, content_start)
            and not _THEMATIC_BREAK.fullmatch(value, content_start)
            and value[content_start:].strip(" ")
            and (table_continues or _markdown_table_head(lines, index, content_start, containers))
        ):
            # Each GFM cell has its own inline tokenizer; neither another cell
            # nor the next row can close a backtick run or a link label.
            table_open = True
            paragraph_open = False
            inline_boundaries.append(line.start())
            for left, right in _markdown_table_cells(line.group(0).rstrip("\r\n"), raw_prefix):
                inline_boundaries.extend((line.start() + left, line.start() + right))
            inline_boundaries.append(line.end())
            index += 1
            continue
        if not paragraph_open:
            definition = _markdown_reference_definition(
                text, lines, index, raw_prefix, containers,
            )
            if definition is not None:
                identifier, consumed_index, end = definition
                reference_definitions.add(identifier)
                reference_definition_ranges.append((line.start(), end))
                ranges.append((line.start(), end))
                inline_boundaries.extend((line.start(), end))
                index = consumed_index + 1
                continue
        if not value[content_start:].strip(" "):
            if opened_container and containers and containers[-1] > 0:
                empty_item_depth = len(containers) - 1
            paragraph_open = False
            inline_boundaries.extend((line.start(), line.end()))
            index += 1
            continue
        if not paragraph_open and value.startswith("    ", content_start):
            start = line.start()
            end = line.end()
            index += 1
            while index < len(lines):
                candidate = lines[index].group(0).rstrip("\r\n").expandtabs(4)
                candidate_start = _fence_content_start(candidate, containers)
                if candidate_start is None or (
                    candidate[candidate_start:].strip(" ")
                    and not candidate.startswith("    ", candidate_start)
                ):
                    break
                end = lines[index].end()
                index += 1
            ranges.append((start, end))
            inline_boundaries.extend((start, end))
            continue
        if (
            _ATX_HEADING.match(value, content_start)
            or _THEMATIC_BREAK.fullmatch(value, content_start)
            or paragraph_open and _SETEXT_UNDERLINE.fullmatch(value, content_start)
        ):
            paragraph_open = False
            inline_boundaries.extend((line.start(), line.end()))
        else:
            # An ordinary paragraph may continue lazily without repeating its
            # list/quote prefix. Indentation alone cannot interrupt it.
            if paragraph_open and not opened_container:
                containers = previous_containers
            paragraph_open = True
        index += 1
    inline_boundaries.append(len(text))
    html_starts = [start for start, _end in html_exclusions]

    def in_html(start: int, end: int) -> bool:
        block = bisect_left(html_starts, end) - 1
        return block >= 0 and html_exclusions[block][1] > start

    inline_runs = list(re.finditer(r"`+", text))
    dollar_run_at: dict[int, tuple[int, int]] = {}
    dollar_runs_by_width: dict[int, list[tuple[int, int]]] = {}
    for match in re.finditer(r"\$+", text):
        span = (match.start(), match.end())
        dollar_run_at[match.start()] = span
        dollar_runs_by_width.setdefault(len(match.group(0)), []).append(span)
    dollar_run_starts_by_width = {
        width: [start for start, _end in runs]
        for width, runs in dollar_runs_by_width.items()
    }
    literal_spans: list[tuple[int, int]] = []
    # Competing inline constructs acquire ownership in source order. In
    # particular, math/backticks inside an autolink cannot borrow a later
    # closer; an earlier code/math/HTML node still owns autolink-looking text.
    protocol_tokenizer = _GfmProtocolTokenizer(text)
    html_recognizer = _MarkdownHtmlRecognizer(text)
    context_scope_end = consumed_end = protocol_end = context_generation = 0
    context_labels: list[tuple[bool, int, int]] = []
    context_title_closers: dict[str, array] = {}
    context_title_ends: dict[tuple[int, int], int | None] = {}
    protocol_spans: list[tuple[int, int]] = []
    # Block ranges are disjoint and ordered. Newly recognized inline spans
    # only advance consumed_end, so they never need to be searched again.
    inline_blocks = _merge_ranges([*ranges, *html_exclusions]) if html_exclusions else ranges
    block_range_count = len(inline_blocks)
    block_index = 0
    run_index = 0
    for event in _MARKDOWN_INLINE_CONTEXT.finditer(text):
        position = event.start()
        if position < consumed_end:
            continue
        while block_index < block_range_count and inline_blocks[block_index][1] <= position:
            block_index += 1
        if block_index < block_range_count and inline_blocks[block_index][0] <= position:
            continue
        if position >= context_scope_end:
            context_labels.clear()
            context_scope_end = inline_boundaries[bisect_left(inline_boundaries, position + 1)]
        value = event.group(0)
        if value == "<":
            # A slash consumed by the preceding source URL is no longer an
            # escape for this node. Angle autolinks precede inline HTML.
            if position != protocol_end and _is_escaped_delimiter(text, position):
                continue
            autolink = _MARKDOWN_AUTOLINK.match(text, position, context_scope_end)
            if autolink is not None:
                literal_spans.append((position, autolink.end()))
                consumed_end = autolink.end()
            else:
                end = html_recognizer.end(position, context_scope_end)
                if end is not None:
                    html_exclusions.append((position, end))
                    consumed_end = end
            continue
        if value in ("[", "]"):
            if _is_escaped_delimiter(text, position):
                continue
            if value == "[":
                image = position > 0 and text[position - 1] == "!" and not _is_escaped_delimiter(text, position - 1)
                context_labels.append((image, context_generation, position))
                continue
            if context_labels:
                image, generation, label_start = context_labels.pop()
                if not image and generation != context_generation:
                    continue
                parsed_end = (
                    _markdown_destination_end(
                        text, event.end() + 1, context_scope_end,
                        context_title_closers, context_title_ends,
                    )
                    if text.startswith("(", event.end()) else None
                )
                if parsed_end is None and reference_definitions:
                    parsed_end = _markdown_reference_use_end(
                        text, label_start, position, context_scope_end, reference_definitions,
                    )
                if parsed_end is not None:
                    # The real active label has closed. Its complete
                    # attributes own title backticks/dollars before code/math.
                    consumed_end = parsed_end
                    if not image:
                        context_generation += 1
            continue
        if value.startswith("$") or value in (r"\(", r"\["):
            if not _is_escaped_delimiter(text, position):
                math_end = (
                    _markdown_dollar_math_end(
                        position, context_scope_end, dollar_run_at,
                        dollar_runs_by_width, dollar_run_starts_by_width,
                    )
                    if value.startswith("$")
                    else None
                )
                if math_end is None and value in (r"\(", r"\["):
                    math = _MARKDOWN_LITERAL_MATH.match(text, position, context_scope_end)
                    math_end = math.end() if math is not None else None
                if math_end is not None:
                    literal_spans.append((position, math_end))
                    consumed_end = math_end
            continue
        if not value.startswith("`"):
            if not context_labels:
                scope_start = inline_boundaries[bisect_left(inline_boundaries, position + 1) - 1]
                end = protocol_tokenizer.literal_end(event, scope_start, context_scope_end)
                if end is not None:
                    protocol_spans.append((position, end))
                    consumed_end = protocol_end = end
            continue
        if _is_escaped_delimiter(text, position):
            continue
        while run_index < len(inline_runs) and inline_runs[run_index].start() < position:
            run_index += 1
        opening = inline_runs[run_index]
        scope_end = inline_boundaries[bisect_left(inline_boundaries, opening.end())]
        # Block-code starts also bound this search, so a closer cannot be
        # inside a block. Already emitted inline spans precede this opener.
        closing_index = run_index + 1
        while closing_index < len(inline_runs):
            closing = inline_runs[closing_index]
            if closing.start() >= scope_end:
                # An unclosed run cannot take a closer from another block.
                break
            # Backslashes are literal inside code: they cannot escape a
            # same-length closing run (unlike an opener outside code).
            if len(closing.group(0)) == len(opening.group(0)):
                ranges.append((position, closing.end()))
                consumed_end = closing.end()
                run_index = closing_index + 1
                break
            closing_index += 1
    html_exclusions = _merge_ranges(html_exclusions)
    html_starts = [start for start, _end in html_exclusions]
    ranges.extend(literal_spans)
    ranges.extend(protocol_spans)
    literal_range_count = len(ranges)
    for pattern, markdown_only in (
        (re.compile(r"(?m)^\s*\[[^\]]+\]:[ \t]*(?:<[^>\r\n]+>|\S+)(?:[ \t]+[^\r\n]*)?$"), True),
        (re.compile(r"cr-asset://[0-9a-f-]{36}", re.IGNORECASE), False),
        (re.compile(r"!?\[[^\]\n]*\]\((?:cr-asset://|attachment://)[^)\n]*\)", re.IGNORECASE), False),
        (re.compile(r"!?\[[^\]\n]*\]\s*\[[^\]\n]*\]"), True),
        (re.compile(r"\[\^[^\]\n]+\]"), True),
    ):
        ranges.extend(
            (match.start(), match.end()) for match in pattern.finditer(text)
            if not markdown_only or not in_html(match.start(), match.end())
        )
    # Attribute delimiters, not parentheses inside angle URLs or quoted titles,
    # determine where a valid link stops. Retain the old single-line fallback
    # for incomplete syntax rather than weakening its conservative protection.
    destination_cursor = 0
    literal_ranges: list[tuple[int, int]] | None = None
    literal_starts: list[int] = []
    title_closers: dict[str, array] = {}
    title_ends: dict[tuple[int, int], int | None] = {}
    labels: list[tuple[bool, int, int]] = []
    link_regions: list[tuple[int, int]] = []
    link_labels: list[tuple[int, int]] = []
    label_scope_end = 0
    link_generation = 0
    definition_blocked_ranges = _merge_ranges([*ranges[:literal_range_count], *html_exclusions])
    attention_exclusions.extend(definition_blocked_ranges)
    delimiters = re.finditer(r"[\[\]]", text) if "](" in text or reference_definitions else ()
    for delimiter in delimiters:
        start = delimiter.start()
        if start < destination_cursor:
            continue
        if start >= label_scope_end:
            labels.clear()
            label_scope_end = inline_boundaries[bisect_left(inline_boundaries, start + 1)]
        if literal_ranges is None:
            literal_ranges = _merge_ranges([*definition_blocked_ranges, *reference_definition_ranges])
            literal_starts = [start for start, _end in literal_ranges]
        literal_index = bisect_left(literal_starts, start + 1) - 1
        if literal_index >= 0 and literal_ranges[literal_index][1] > start:
            continue  # Code/math/autolink text cannot supply label delimiters.
        if _is_escaped_delimiter(text, start):
            continue
        if delimiter.group(0) == "[":
            image = start > 0 and text[start - 1] == "!" and not _is_escaped_delimiter(text, start - 1)
            labels.append((image, link_generation, start))
            continue
        if not labels:
            continue
        image, generation, label_start = labels.pop()
        if not image and generation != link_generation:
            continue
        attribute_start = delimiter.end() + 1
        has_resource = text.startswith("(", delimiter.end())
        parsed_end = (
            _markdown_destination_end(text, attribute_start, label_scope_end, title_closers, title_ends)
            if has_resource else None
        )
        if parsed_end is not None:
            link_regions.append((label_start, parsed_end))
            link_labels.append((label_start + 1, start))
            attention_exclusions.append((start, parsed_end))
            ranges.append((start, parsed_end))
            destination_cursor = parsed_end
            if not image:
                link_generation += 1
            continue
        if reference_definitions:
            # Reference identifiers are normalized raw source, not decoded
            # entities or unescaped punctuation. A valid resource wins first.
            resolved_end = _markdown_reference_use_end(
                text, label_start, start, label_scope_end, reference_definitions,
            )
            if resolved_end is not None:
                link_regions.append((label_start, resolved_end))
                link_labels.append((label_start + 1, start))
                attention_exclusions.append((start, resolved_end))
                destination_cursor = resolved_end
                if not image:
                    # Reference images do not deactivate parent links.
                    link_generation += 1
                continue
        if not has_resource:
            continue
        end, depth = attribute_start, 1
        while end < label_scope_end and text[end] != "\n" and depth:
            if text[end] == "\\" and end + 1 < label_scope_end:
                end += 2
                continue
            if text[end] == "(":
                depth += 1
            elif text[end] == ")":
                depth -= 1
            end += 1
        ranges.append((start, end))
        destination_cursor = end
    ranges.extend(_gfm_protocol_ranges(
        text, inline_boundaries, [*ranges, *html_exclusions] if html_exclusions else ranges, link_regions,
        link_labels, attention_exclusions,
    ))
    ranges.extend(_chatgpt_bracket_math_ranges(
        text, [*ranges, *html_exclusions],
    ))
    projected_rich_tags = _chatgpt_rich_projection_tags(text, ranges) if html_flow_ranges else None
    ranges.extend(
        flow for flow in html_flow_ranges
        if not _is_projected_chatgpt_rich_flow(text, flow, projected_rich_tags)
    )
    return _merge_ranges(ranges)


# A failed email attempt consumes nothing. Match only its first character so
# a later www head in the same atext run can still be tried in source order.
_GFM_LITERAL_PATTERN = (
    r"(?P<email>(?<![A-Za-z0-9_+./-])(?=[A-Za-z0-9_+.-]+@)[A-Za-z0-9_+.-])"
    r"|https?://|www\."
)
_GFM_LITERAL = re.compile(_GFM_LITERAL_PATTERN, re.IGNORECASE | re.ASCII)
_MARKDOWN_INLINE_CONTEXT = re.compile(
    _GFM_LITERAL_PATTERN + r"|`+|[\[\]<$]|\\[\[(]", re.IGNORECASE | re.ASCII,
)
_MARKDOWN_AUTOLINK = re.compile(
    # CommonMark schemes have 2..32 ASCII characters. NUL is preprocessed to
    # U+FFFD by micromark; the other ASCII controls cannot occur in its URL.
    r"<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\x01-\x20\x7f<>]*"
    r"|[A-Za-z0-9#$%&'*+\-./=?^_`{|}~]+@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*"
    r")>",
)
_MARKDOWN_LITERAL_MATH = re.compile(
    r"(?s)\\\[.*?\\\]|\\\(.*?\\\)",
)
_BARE_BRACKET_MATH_LINE = re.compile(
    r"(?m)^[\t ]*(?:(?P<opening>/?\[)[\t ]*\r?\n|(?P<closing>\]/?)[\t ]*(?=\r?$))",
)
_ESCAPED_BRACKET_MATH_LINE = re.compile(
    r"(?m)^[\t ]*(?:(?P<opening>\\\[)[\t ]*\r?\n|(?P<closing>\\\])[\t ]*(?=\r?$))",
)
_BARE_BRACKET_LATEX_COMMAND = re.compile(
    r"\\(?:alpha|approx|begin|beta|boxed|cap|cases|cdot|cdots|chi|cup|delta|"
    r"dfrac|div|dots|epsilon|equiv|eta|exists|forall|frac|gamma|geq?|in|infty|"
    r"int|iota|kappa|lambda|langle|ldots|left|leq?|lim|ln|log|longrightarrow|"
    r"mathbb|mathbf|mathcal|mathit|mathrm|mathsf|mathtt|matrix|max|min|mp|mu|"
    r"nabla|neq|notin|nu|omega|overline|partial|phi|pi|pm|pmatrix|prod|propto|"
    r"psi|quad|qquad|rangle|rho|right|rightarrow|sigma|sim|sin|sqrt|subset|"
    r"subseteq|sum|supset|supseteq|tan|tau|text|theta|times|to|upsilon|varphi|"
    r"varepsilon|varrho|varsigma|vartheta|vec|xrightarrow|xi|zeta)"
    r"(?=[^A-Za-z]|$)",
)
_CHATGPT_RICH_TAG = re.compile(
    r"\\{0,3}</?(?:box|row|text|badge|divider)\b[^<>\r\n]{0,512}>",
    re.IGNORECASE | re.ASCII,
)
_CHATGPT_RICH_ANY_TAG = re.compile(r"</?[A-Za-z][^<>\r\n]{0,512}>")
_CHATGPT_RICH_ATTRIBUTES = re.compile(
    r"^(?:\s+(?:border|radius|padding|gap|justify|align|color|size|background|direction|wrap|flex|height|width|minHeight|minWidth|maxHeight|maxWidth|minSize|maxSize|margin|aspectRatio|variant|pill|weight|textAlign|italic|lineThrough|truncate|maxLines|minLines|flush|spacing)(?:\s*=\s*(?:\"[^\"<>\r\n]{0,80}\"|'[^'<>\r\n]{0,80}'|\{\s*\d{1,3}\s*\}|\d{1,3}|true|false))?)*\s*$",
    re.IGNORECASE | re.ASCII,
)
_GFM_FALLBACK_CANDIDATE = re.compile(r"https?://|www\.|@|&|\\", re.IGNORECASE | re.ASCII)
# A decoded protocol needs ASCII '/'. These are all CommonMark source origins
# of that character (no NFKC): literal/escaped '/', &sol;, or bounded numerics.
_GFM_PROTOCOL_SLASH = re.compile(r"/|&(?:sol|#0{0,5}47|#[xX]0{0,4}2[fF]);")
# Necessary source origins for the two other literal families. No NFKC:
# w/W and '.' have only these literal, escaped-dot and numeric/named origins.
_GFM_AUTOLINK_ORIGIN = re.compile(
    _GFM_PROTOCOL_SLASH.pattern
    + r"|@|&(?:commat|#0{0,5}64|#[xX]0{0,4}40);"
    + r"|(?:[wW]|&#(?:0{0,5}87|0{0,4}119|[xX]0{0,4}(?:57|77));){3}"
    r"(?:\\?\.|&(?:period|#0{0,5}46|#[xX]0{0,4}2[eE]);)"
)
# Match JavaScript's whitespace class, not Python's wider C0 whitespace class.
_GFM_URL_BREAK = re.compile(r"[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff<]")
_GFM_ENTITY = re.compile(r"&[A-Za-z]+;")
_GFM_FALLBACK_TOKEN = re.compile(r"[^ \t\r\n]+")
_GFM_FALLBACK_URL = re.compile(
    r"(?:https?://|www(?=\.))([-.A-Za-z0-9_]+)[^ \t\r\n]*", re.IGNORECASE | re.ASCII,
)
_GFM_FALLBACK_URL_HEAD = re.compile(r"https?://|www(?=\.)", re.IGNORECASE | re.ASCII)
_GFM_ASCII_ALNUM = re.compile(r"[A-Za-z0-9]")
_GFM_EMAIL_TEXT = re.compile(r"[-+._A-Za-z0-9]+")
_GFM_EMAIL_AT = re.compile("@")
_GFM_EMAIL_PUNCTUATION = re.compile(r"[-+._]")
_GFM_SOURCE_EMAIL_DOMAIN = re.compile(r"(?:[-A-Za-z0-9_]|\.(?=[A-Za-z0-9]))+")
_GFM_FALLBACK_EMAIL_DOMAIN = re.compile(r"[-A-Za-z0-9_]+(?:\.[-A-Za-z0-9_]+)+")
_HTML_TAG_NAME = re.compile(r"[A-Za-z][A-Za-z0-9-]*")
_HTML_ATTRIBUTE_NAME = re.compile(r"[A-Za-z_:][A-Za-z0-9_.:-]*")
_HTML_UNQUOTED_VALUE = re.compile(r"[^ \t\r\n\"'=<>`][^ \t\r\n\"'=<>`/]*")
_MARKDOWN_TEXT_ESCAPE = re.compile(
    r"\\[!\"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]"
    r"|&(?:#[xX][0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z0-9]{1,31});"
)
_MARKDOWN_DEFINITION_OPENING = re.compile(r" {0,3}\[")


def _markdown_reference_id(value: str) -> str:
    """CommonMark identifiers retain raw escapes/entities and trim ASCII space."""
    return re.sub(r"[\t\n\r ]+", " ", value).strip(" ").lower().upper()


def _markdown_reference_label_end(text: str, start: int, limit: int) -> int | None:
    """Recognize a full reference's bounded raw label, not its visible inline text."""
    cursor, size = start + 1, 0
    seen = False
    while cursor < limit and size <= 999:
        character = text[cursor]
        if character == "]":
            return cursor + 1 if seen else None
        if character == "[":
            return None
        if character not in "\r\n":
            size += 2 if ord(character) > 0xffff else 1
            seen = seen or character not in " \t"
        cursor += 1
        if character == "\\" and cursor < limit and text[cursor] in "[]\\":
            size += 1
            cursor += 1
    return None


def _markdown_reference_definition(
    text: str,
    lines: list[re.Match[str]],
    index: int,
    raw_prefix: int,
    containers: tuple[int, ...],
) -> tuple[str, int, int] | None:
    """Recognize a reference definition, including bounded continuations.

    Reference definitions are block constructs, so this helper is called only
    while the line walker is at a paragraph boundary. The continuation support
    intentionally stays local to the current container and does not infer an
    arbitrary Markdown block parser: labels may continue onto adjacent
    nonblank lines, destinations may begin on the next line, and titles may
    continue across nonblank lines. Source coordinates are never decoded.
    """
    line = lines[index]
    raw_line = line.group(0).rstrip("\r\n")
    start = line.start() + raw_prefix
    line_end = line.start() + len(raw_line)
    if start >= line_end:
        return None
    opening = _MARKDOWN_DEFINITION_OPENING.match(text, start, line_end)
    if opening is None:
        return None

    def continuation(
        line_index: int,
    ) -> tuple[int, int, int] | None:
        next_index = line_index + 1
        if next_index >= len(lines):
            return None
        candidate_line = lines[next_index]
        candidate = candidate_line.group(0).rstrip("\r\n").expandtabs(4)
        complete_parent = _fence_content_start(candidate, containers) is not None
        candidate_start, _parents, opened_container = _markdown_container_prefix(
            candidate, containers, complete_parent,
        )
        # Retain the parents that actually matched before a lazy continuation.
        # Losing an inner quote must not discard an outer `>` or list indent.
        # With every parent present this is still paragraph content, so only
        # `1.`/`1)` may interrupt it. After parent exit a fresh list is a block,
        # even when its start is not one.
        if opened_container:
            return None
        if not candidate[candidate_start:].strip(" \t"):
            return None
        if (
            _ATX_HEADING.match(candidate, candidate_start)
            or _THEMATIC_BREAK.fullmatch(candidate, candidate_start)
            or _SETEXT_UNDERLINE.fullmatch(candidate, candidate_start)
            or _fence_opening(candidate, candidate_start) is not None
            or _html_block_opening(candidate, candidate_start, True) is not None
            or _markdown_table_head(lines, next_index, candidate_start, _parents)
        ):
            return None
        raw_cursor = column = 0
        for character in candidate_line.group(0):
            if column >= candidate_start:
                break
            column += 4 - column % 4 if character == "\t" else 1
            raw_cursor += 1
        content_end = candidate_line.start() + len(
            candidate_line.group(0).rstrip("\r\n")
        )
        if candidate_line.start() + raw_cursor >= content_end:
            return None
        return next_index, candidate_line.start() + raw_cursor, content_end

    label_start = opening.end()
    cursor = label_start
    current_index = index
    current_end = line_end
    label_length = 0
    label_seen = False
    label_end: int | None = None
    label_parts: list[str] = []
    label_part_start = label_start
    while True:
        while cursor < current_end:
            character = text[cursor]
            if character == "[":
                return None
            if character == "]":
                label_end = cursor
                break
            if character == "\\" and cursor + 1 < current_end and text[cursor + 1] in "[]\\":
                cursor += 2
                label_length += 2
                label_seen = True
                if label_length > 999:
                    return None
                continue
            cursor += 1
            label_length += 2 if ord(character) > 0xFFFF else 1
            label_seen = label_seen or character not in " \t\r\n"
            if label_length > 999:
                return None
        if label_end is not None:
            label_parts.append(text[label_part_start:label_end])
            break
        label_parts.append(text[label_part_start:current_end])
        next_line = continuation(current_index)
        if next_line is None:
            return None
        current_index, cursor, current_end = next_line
        label_part_start = cursor

    if not label_seen or text[label_start] == "^":
        return None  # GFM footnote definitions own this syntax.
    if label_end + 1 >= current_end or text[label_end + 1] != ":":
        return None

    cursor = label_end + 2

    def skip_inline_space(
        position: int,
        line_limit: int,
    ) -> int:
        while position < line_limit and text[position] in " \t":
            position += 1
        return position

    cursor = skip_inline_space(cursor, current_end)
    if cursor >= current_end:
        next_line = continuation(current_index)
        if next_line is None:
            return None
        current_index, cursor, current_end = next_line
        cursor = skip_inline_space(cursor, current_end)
        if cursor >= current_end:
            return None

    destination_start = cursor
    if text[cursor] == "<":
        cursor += 1
        while cursor < current_end:
            character = text[cursor]
            if character == "\\" and cursor + 1 < current_end and text[cursor + 1] in string.punctuation:
                cursor += 2
                continue
            if character == ">":
                cursor += 1
                break
            if character == "<":
                return None
            cursor += 1
        else:
            return None
    else:
        if text[cursor] in " )\t" or 0 < ord(text[cursor]) < 32 or ord(text[cursor]) == 127:
            return None
        depth = 0
        while cursor < current_end:
            character = text[cursor]
            if character == "\\" and cursor + 1 < current_end and text[cursor + 1] in string.punctuation:
                cursor += 2
                continue
            if character in " \t":
                break
            if 0 < ord(character) < 32 or ord(character) == 127:
                return None
            if character == "(":
                depth += 1
            elif character == ")":
                if depth == 0:
                    return None
                depth -= 1
            cursor += 1
        if depth:
            return None
    if cursor == destination_start:
        return None

    identifier = _markdown_reference_id("\n".join(label_parts))
    destination_end = cursor
    cursor = skip_inline_space(cursor, current_end)
    destination_only = (
        (identifier, current_index, current_end) if cursor == current_end else None
    )
    title_open: str | None = None
    if cursor > destination_end and cursor < current_end and text[cursor] in "\"'(":
        title_open = text[cursor]
    elif cursor >= current_end:
        next_line = continuation(current_index)
        if next_line is not None:
            next_index, next_cursor, next_end = next_line
            next_cursor = skip_inline_space(next_cursor, next_end)
            if next_cursor < next_end and text[next_cursor] in "\"'(":
                current_index, cursor, current_end = next_index, next_cursor, next_end
                title_open = text[cursor]
    if title_open is not None:
        title_close = ")" if title_open == "(" else title_open
        cursor += 1
        closed = False
        while not closed:
            while cursor < current_end:
                character = text[cursor]
                if character == "\\" and cursor + 1 < current_end and text[cursor + 1] in string.punctuation:
                    cursor += 2
                    continue
                if character == title_close:
                    cursor += 1
                    closed = True
                    break
                cursor += 1
            if closed:
                break
            next_line = continuation(current_index)
            if next_line is None:
                return destination_only
            current_index, cursor, current_end = next_line
            cursor = skip_inline_space(cursor, current_end)
        if not closed or text[cursor:current_end].strip(" \t"):
            return destination_only
    elif text[cursor:current_end].strip(" \t"):
        return None

    return identifier, current_index, current_end


def _markdown_text_shadow(text: str, start: int, end: int) -> tuple[str, array]:
    """Decode text-node escapes with original-source ends, never NFKC."""
    output: list[str] = []
    ends = array("Q")
    cursor = start
    for match in _MARKDOWN_TEXT_ESCAPE.finditer(text, start, end):
        output.append(text[cursor:match.start()])
        ends.extend(range(cursor + 1, match.start() + 1))
        raw = match.group(0)
        if raw[0] == "\\":
            value = raw[1:]
        elif raw.startswith("&#"):
            hexadecimal = raw[2:3].lower() == "x"
            code = int(raw[3:-1] if hexadecimal else raw[2:-1], 16 if hexadecimal else 10)
            # CommonMark numeric references differ from html.unescape for
            # controls/noncharacters: use micromark's replacement policy.
            value = "\ufffd" if (
                code < 9 or code == 11 or 13 < code < 32 or 126 < code < 160
                or 0xD800 <= code <= 0xDFFF or 0xFDD0 <= code <= 0xFDEF
                or (code & 0xFFFF) in (0xFFFE, 0xFFFF) or code > 0x10FFFF
            ) else chr(code)
        else:
            value = html5.get(raw[1:], raw)
        output.append(value)
        if value == raw:
            ends.extend(range(match.start() + 1, match.end() + 1))
        else:
            ends.extend([match.end()] * len(value))
        cursor = match.end()
    output.append(text[cursor:end])
    ends.extend(range(cursor + 1, end + 1))
    return "".join(output), ends


def _gfm_punctuation(character: str) -> bool:
    # micromark-util-character checks UTF-16 code units; a surrogate pair is
    # not classified as a punctuation/symbol code point by that check.
    return ord(character) <= 0xFFFF and unicodedata.category(character)[0] in "PS"


class _GfmProtocolTokenizer:
    """Source-level autolinks, sharing domain/path suffix classification."""
    def __init__(self, text: str):
        self.text = text
        self.limit = len(text)
        self.tail_base = self.tail_end = -1
        self.tail = bytearray()
        self.failed_from = self.failed_through = -1

    def literal_end(self, match: re.Match[str], lower: int = 0, limit: int | None = None) -> int | None:
        limit = len(self.text) if limit is None else limit
        if limit != self.limit:
            # Suffix classifications belong to this inline scope, not a later
            # table cell that happens to share its whitespace-delimited token.
            self.limit = limit
            self.tail_base = self.tail_end = self.failed_from = self.failed_through = -1
        start = match.start()
        previous = self.text[start - 1] if start > lower else ""
        if match.lastgroup == "email":
            # A character escape wins over an email beginning at punctuation.
            if not (
                self.text[start] in "+-._" and _is_escaped_delimiter(self.text, start)
            ):
                local = _GFM_EMAIL_TEXT.match(self.text, start, limit)
                domain = _GFM_SOURCE_EMAIL_DOMAIN.match(self.text, local.end() + 1, limit)
                if (
                    domain is not None and "." in domain.group()
                    and self.text[domain.end() - 1].isascii()
                    and self.text[domain.end() - 1].isalpha()
                ):
                    return domain.end()
            # The email tokenizer runs before www. A failed attempt leaves
            # that alternative available at the exact same source position.
            if self.text[start:start + 4].lower() != "www.":
                return None
        if self.text[start:start + 4].lower() == "www.":
            if previous and previous not in "(*_[]~ \t\r\n":
                return None
            return self.end(start) if start + 4 < limit else None
        if previous and previous.isascii() and previous.isalpha():
            return None
        return self.end(match.end())

    def end(self, domain_start: int) -> int | None:
        if self.failed_from <= domain_start <= self.failed_through:
            return None
        if domain_start >= self.limit:
            return None
        first = self.text[domain_start]
        if (
            ord(first) < 32 or ord(first) == 127
            or _GFM_URL_BREAK.match(self.text, domain_start)
            or _gfm_punctuation(first)
        ):
            return None
        if domain_start >= self.tail_end:
            stop = _GFM_URL_BREAK.search(self.text, domain_start, self.limit)
            self.tail_base = domain_start
            self.tail_end = stop.start() if stop else self.limit
            # One backward suffix classification per whitespace-delimited
            # token, reused if several invalid URL heads share that token.
            self.tail = bytearray(self.tail_end - self.tail_base + 1)
            self.tail[-1] = 1
            for position in range(self.tail_end - 1, self.tail_base - 1, -1):
                character = self.text[position]
                index = position - self.tail_base
                if character in "!\"')*,.:;?_~":
                    self.tail[index] = self.tail[index + 1]
                elif character == "]":
                    following = self.text[position + 1] if position + 1 < self.tail_end else ""
                    self.tail[index] = not following or following in "([" or self.tail[index + 1]
                elif character == "&":
                    entity = _GFM_ENTITY.match(self.text, position, self.tail_end)
                    if entity:
                        self.tail[index] = self.tail[entity.end() - self.tail_base]
        cursor = domain_start
        underscore = penultimate_underscore = -1
        seen = False
        while cursor < self.tail_end:
            character = self.text[cursor]
            if character in "._":
                if self.tail[cursor - self.tail_base]:
                    break
                if character == "_":
                    underscore = cursor
                else:
                    penultimate_underscore, underscore = underscore, -1
            elif character != "-" and _gfm_punctuation(character):
                break
            else:
                seen = True
            cursor += 1
        if max(underscore, penultimate_underscore) >= 0:
            # Later www heads before this same bad suffix cannot repair its
            # last two segments. Do not rescan that domain for each prefix.
            self.failed_from = domain_start
            self.failed_through = max(underscore, penultimate_underscore)
        elif seen:
            opened = closed = 0
            while cursor < self.tail_end:
                character = self.text[cursor]
                if character == "(":
                    opened += 1
                elif character == ")" and closed < opened:
                    closed += 1
                elif self.tail[cursor - self.tail_base]:
                    break
                elif character == ")":
                    closed += 1
                cursor += 1
            return cursor
        return None


def _gfm_fallback_url_ranges(decoded: str) -> list[tuple[int, int]]:
    """Run the native URL-before-email transform on one decoded text token."""
    result: list[tuple[int, int]] = []
    consumed = 0
    failed_through = failed_domain_end = -1
    for head in _GFM_FALLBACK_URL_HEAD.finditer(decoded):
        start = head.start()
        if start < consumed or (
            start <= failed_through and head.end() <= failed_domain_end
        ):
            continue
        previous = decoded[start - 1] if start else ""
        if previous and not (
            _GFM_URL_BREAK.fullmatch(previous) or _gfm_punctuation(previous)
        ):
            continue
        fallback = _GFM_FALLBACK_URL.match(decoded, start)
        if fallback is None:
            continue
        www = decoded[start].lower() == "w"
        domain_start = start if www else fallback.start(1)
        domain_end = fallback.end(1)
        last_dot = decoded.rfind(".", domain_start, domain_end)
        bad = domain_end - 1 if last_dot < 0 else -1
        if last_dot >= 0:
            prior_dot = decoded.rfind(".", domain_start, last_dot)
            for left, right in (
                (max(domain_start, prior_dot + 1), last_dot), (last_dot + 1, domain_end),
            ):
                if left == right:
                    continue
                underscore = decoded.rfind("_", left, right)
                if underscore >= 0:
                    bad = max(bad, underscore)
                elif _GFM_ASCII_ALNUM.search(decoded, left, right) is None:
                    bad = max(bad, right - 1)
        if bad >= 0:
            failed_through, failed_domain_end = bad, domain_end
            continue
        kept_end = fallback.end()
        while kept_end > start and decoded[kept_end - 1] in "!\"&'),.:;<>?]}":
            kept_end -= 1
        needed = decoded.count("(", start, kept_end) - decoded.count(")", start, kept_end)
        cursor = kept_end
        while cursor < fallback.end() and needed > 0:
            if decoded[cursor] == ")":
                needed -= 1
                kept_end = cursor + 1
            cursor += 1
        if kept_end <= (start if www else head.end()):
            continue
        result.append((start, kept_end))
        consumed = fallback.end()
    return result


class _MarkdownHtmlRecognizer:
    """Operation-local inline-HTML grammar and reusable forward closers."""
    def __init__(self, text: str):
        self.text = text
        self.closers: dict[str, tuple[int, int]] = {}

    def following(self, marker: str, start: int) -> int:
        cached = self.closers.get(marker)
        if cached is None or cached[1] >= 0 and cached[1] < start:
            cached = (start, self.text.find(marker, start))
            self.closers[marker] = cached
        return cached[1]

    def end(self, start: int, limit: int, *, flow: bool = False) -> int | None:
        text = self.text
        end = -1
        if text.startswith("<!--", start):
            content_start = start + 4
            if text.startswith(">", content_start):
                end = content_start + 1
            elif text.startswith("->", content_start):
                end = content_start + 2
            else:
                closing = self.following("-->", content_start)
                if closing >= 0:
                    end = closing + 3
        elif text.startswith("<![CDATA[", start) or text.startswith("<?", start):
            cdata = text.startswith("<![CDATA[", start)
            marker = "]]>" if cdata else "?>"
            closing = self.following(marker, start + (9 if cdata else 2))
            if closing >= 0:
                end = closing + len(marker)
        elif (
            text.startswith("<!", start)
            and start + 2 < limit
            and text[start + 2].isascii() and text[start + 2].isalpha()
        ):
            closing = self.following(">", start + 3)
            if closing >= 0:
                end = closing + 1
        else:
            closing_tag = text.startswith("</", start)
            name = _HTML_TAG_NAME.match(text, start + (2 if closing_tag else 1), limit)
            if name is None:
                return None
            cursor = name.end()
            while cursor < limit:
                before_space = cursor
                while cursor < limit and text[cursor] in " \t\r\n":
                    cursor += 1
                if cursor < limit and text[cursor] == ">":
                    end = cursor + 1
                    break
                if not closing_tag and text.startswith("/>", cursor):
                    end = cursor + 2
                    break
                if closing_tag or cursor == before_space:
                    break
                attribute = _HTML_ATTRIBUTE_NAME.match(text, cursor, limit)
                if attribute is None:
                    break
                cursor = attribute.end()
                after_name = cursor
                while cursor < limit and text[cursor] in " \t\r\n":
                    cursor += 1
                if cursor == limit or text[cursor] != "=":
                    cursor = after_name
                    continue
                cursor += 1
                while cursor < limit and text[cursor] in " \t\r\n":
                    cursor += 1
                if cursor == limit:
                    break
                if text[cursor] in "\"'":
                    closing = self.following(text[cursor], cursor + 1)
                    if closing < 0 or closing >= limit:
                        break
                    cursor = closing + 1
                else:
                    # HTML-flow's complete-tag tokenizer treats an immediate
                    # slash as the self-closing marker, not an unquoted value.
                    if flow and text[cursor] == "/":
                        if text.startswith("/>", cursor):
                            end = cursor + 2
                        break
                    value = _HTML_UNQUOTED_VALUE.match(text, cursor, limit)
                    if value is None:
                        break
                    cursor = value.end()
        return end if start < end <= limit else None


def _markdown_html_ranges(
    text: str, boundaries: list[int], blocked: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Recognized HTML partitions text but does not itself protect noise."""
    if "<" not in text:
        return []
    blocked_starts = [start for start, _end in blocked]
    recognizer = _MarkdownHtmlRecognizer(text)
    result: list[tuple[int, int]] = []
    consumed_end = 0
    for opening in re.finditer("<", text):
        start = opening.start()
        if start < consumed_end:
            continue
        blocked_index = bisect_left(blocked_starts, start + 1) - 1
        if blocked_index >= 0 and blocked[blocked_index][1] > start:
            continue
        if _is_escaped_delimiter(text, start) and not (
            blocked_index >= 0 and blocked[blocked_index][1] == start
        ):
            continue
        limit = boundaries[bisect_left(boundaries, start + 1)]
        end = recognizer.end(start, limit)
        if end is not None:
            result.append((start, end))
            consumed_end = end
    return result


@dataclass
class _MarkdownAttentionDelimiter:
    start: int
    end: int
    marker: str
    can_close: bool
    can_open: bool = False
    scope_end: int = 0


def _markdown_attention_ranges(
    text: str, boundaries: list[int], blocked: list[tuple[int, int]],
    link_labels: list[tuple[int, int]], registration_blocked: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Resolve emphasis/strikethrough text boundaries without protecting markers.

    The first successfully tokenized delimiter kind selects the outer resolver
    order. Resolved first-pass spans are atomic in their parent context; the
    second kind can wrap them or resolve inside them, but cannot cross an edge.
    Opener buckets avoid repeated backward searches, and parent contexts avoid
    recursive reparsing of nested spans.
    """
    if not any(marker in text for marker in ("*", "_", "~")):
        return []
    blocked_starts = [start for start, _end in blocked]
    labels = _merge_ranges(link_labels)
    label_starts = [start for start, _end in labels]
    registration_blocked = _merge_ranges(registration_blocked)
    registration_starts = [start for start, _end in registration_blocked]
    records: list[_MarkdownAttentionDelimiter] = []
    priorities: dict[int, bool] = {}
    scope_end = 0

    def group(character: str) -> int:
        if not character or character != "<" and _GFM_URL_BREAK.fullmatch(character):
            return 1
        return 2 if _gfm_punctuation(character) else 0

    for run in re.finditer(r"\*+|_+|~+", text):
        start, end = run.span()
        if start >= scope_end:
            scope_end = boundaries[bisect_left(boundaries, start + 1)]
        registration_index = bisect_left(registration_starts, start + 1) - 1
        if registration_index >= 0 and registration_blocked[registration_index][1] > start:
            continue
        blocked_index = bisect_left(blocked_starts, start + 1) - 1
        registration_only = blocked_index >= 0 and blocked[blocked_index][1] > start
        if registration_only:
            label_index = bisect_left(label_starts, start + 1) - 1
            if label_index < 0 or labels[label_index][1] <= start:
                continue
        if _is_escaped_delimiter(text, start) and not (
            blocked_index >= 0 and blocked[blocked_index][1] == start
        ):
            start += 1
            if start == end:
                continue
        marker = text[start]
        if marker == "~" and end - start > 2:
            continue  # A failed triple run cannot restart in its middle.
        # Label contents register resolvers while being tokenized, before the
        # label is resolved atomically. They cannot supply external openers.
        priorities.setdefault(scope_end, marker == "~")
        if registration_only:
            continue
        previous = text[start - 1] if start else ""
        following = text[end] if end < scope_end else ""
        before, after = group(previous), group(following)
        opens = bool(not after or after == 2 and before)
        closes = bool(not before or before == 2 and after)
        if marker != "~":
            opens = opens or following in ("*", "_", "~")
            closes = closes or previous in ("*", "_", "~")
        can_open = bool(opens and (marker != "_" or before or not closes))
        can_close = bool(closes and (marker != "_" or after or not opens))
        records.append(_MarkdownAttentionDelimiter(start, end, marker, can_close, can_open, scope_end))

    def resolve(
        runs: list[_MarkdownAttentionDelimiter], parents: list[tuple[int, int]],
    ) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
        result: list[tuple[int, int]] = []
        spans: list[tuple[int, int]] = []
        states: dict[int, tuple[list[_MarkdownAttentionDelimiter], dict]] = {}
        parent_stack: list[tuple[int, int, int]] = []
        parent_index = active_scope = 0
        for closer in runs:
            if closer.scope_end != active_scope:
                states.clear()
                active_scope = closer.scope_end
            while parent_index < len(parents) and parents[parent_index][0] <= closer.start:
                left, right = parents[parent_index]
                while parent_stack and parent_stack[-1][1] <= left:
                    parent_stack.pop()
                parent_index += 1
                parent_stack.append((left, right, parent_index))
            while parent_stack and parent_stack[-1][1] <= closer.start:
                parent_stack.pop()
            parent = parent_stack[-1][2] if parent_stack else 0
            pending, kinds = states.setdefault(parent, ([], {}))

            def push(delimiter: _MarkdownAttentionDelimiter) -> None:
                pending.append(delimiter)
                key = delimiter.marker, delimiter.can_close, (delimiter.end - delimiter.start) % 3
                kinds.setdefault(key, []).append(delimiter)

            def pop() -> _MarkdownAttentionDelimiter:
                delimiter = pending.pop()
                key = delimiter.marker, delimiter.can_close, (delimiter.end - delimiter.start) % 3
                kinds[key].pop()
                return delimiter

            marker = closer.marker
            while closer.can_close and closer.start < closer.end:
                size = closer.end - closer.start
                opener = None
                remainders = (size,) if marker == "~" else range(3)
                for also_closes in (False, True):
                    for remainder in remainders:
                        if marker != "~" and (also_closes or closer.can_open) and size % 3 and (remainder + size) % 3 == 0:
                            continue
                        bucket = kinds.get((marker, also_closes, remainder))
                        if bucket and (opener is None or bucket[-1].start > opener.start):
                            opener = bucket[-1]
                if opener is None:
                    break
                while pending[-1] is not opener:
                    pop()
                pop()
                use = size if marker == "~" else 2 if opener.end - opener.start > 1 and size > 1 else 1
                left, right = opener.end - use, closer.start + use
                result.extend(((left, opener.end), (closer.start, right)))
                spans.append((left, right))
                opener.end -= use
                closer.start = right
                if opener.start < opener.end:
                    push(opener)
            if closer.can_open and closer.start < closer.end:
                push(closer)
        return result, spans

    first = [run for run in records if (run.marker == "~") == priorities[run.scope_end]]
    second = [run for run in records if (run.marker == "~") != priorities[run.scope_end]]
    markers, spans = resolve(first, [])
    if second:
        nested, _spans = resolve(second, sorted(spans, key=lambda span: (span[0], -span[1])))
        markers.extend(nested)
    return _merge_ranges(markers)


def _gfm_protocol_ranges(
    text: str,
    boundaries: list[int],
    protected: list[tuple[int, int]],
    link_regions: list[tuple[int, int]],
    link_labels: list[tuple[int, int]],
    attention_exclusions: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Recognize http(s), www and email literals, including text-node fallback.

    Real Markdown link/image labels cannot contain a literal autolink. Plain
    brackets can: mdast's later transform creates links without positions.
    Keep these cases distinct rather than treating a missing position as proof
    that no URL was rendered.
    """
    if _GFM_AUTOLINK_ORIGIN.search(text) is None or _GFM_FALLBACK_CANDIDATE.search(text) is None:
        return []
    blocked = _merge_ranges([*protected, *link_regions])
    # Legacy conservative reference/footnote protection is not proof of an
    # atomic Markdown node. Literal syntax, actual labels and attributes are.
    syntax_blocked = _merge_ranges([*attention_exclusions, *link_regions])
    html_ranges = _markdown_html_ranges(text, boundaries, syntax_blocked)
    blocked = _merge_ranges([*blocked, *html_ranges])
    blocked_starts = [start for start, _end in blocked]
    brackets = iter(re.finditer(r"[\[\]]", text))
    bracket = next(brackets, None)
    depth = scope_end = consumed_end = 0
    tokenizer = _GfmProtocolTokenizer(text)
    result: list[tuple[int, int]] = []
    for match in _GFM_LITERAL.finditer(text):
        start = match.start()
        if start < consumed_end:
            continue
        blocked_index = bisect_left(blocked_starts, start + 1) - 1
        if blocked_index >= 0 and blocked[blocked_index][1] > start:
            continue
        while bracket is not None and bracket.start() < start:
            position = bracket.start()
            if position >= scope_end:
                depth = 0
                scope_end = boundaries[bisect_left(boundaries, position + 1)]
            blocked_index = bisect_left(blocked_starts, position + 1) - 1
            if (
                position >= consumed_end
                and not (blocked_index >= 0 and blocked[blocked_index][1] > position)
                and not _is_escaped_delimiter(text, position)
            ):
                depth = depth + 1 if bracket.group(0) == "[" else max(0, depth - 1)
            bracket = next(brackets, None)
        if start >= scope_end:
            depth = 0
            scope_end = boundaries[bisect_left(boundaries, start + 1)]
        lower = boundaries[bisect_left(boundaries, start + 1) - 1]
        end = tokenizer.literal_end(match, lower, scope_end) if not depth else None
        if end is not None and end > start:
            result.append((start, end))
            consumed_end = end
    # Fallback runs on *whole decoded text tokens*, not on raw protocol heads.
    # This also decodes the preceding character before checking its boundary.
    # Source tokenizer links and other nodes split text; their contents cannot
    # supply a fallback URL or its prefix/path. Keep a single shadow per token.
    excluded = _merge_ranges([*blocked, *result])
    attention = _markdown_attention_ranges(
        text, boundaries, _merge_ranges([*syntax_blocked, *html_ranges, *result]), link_labels,
        [*attention_exclusions, *html_ranges, *result],
    )
    if attention:
        excluded = _merge_ranges([*excluded, *attention])
    partitions = sorted(set([*boundaries, *(p for span in excluded for p in span)]))
    excluded_index = 0
    for left, right in zip(partitions, partitions[1:]):
        while excluded_index < len(excluded) and excluded[excluded_index][1] <= left:
            excluded_index += 1
        if excluded_index < len(excluded) and excluded[excluded_index][0] <= left:
            continue
        for token in _GFM_FALLBACK_TOKEN.finditer(text, left, right):
            if (
                _GFM_AUTOLINK_ORIGIN.search(text, token.start(), token.end()) is None
                or _GFM_FALLBACK_CANDIDATE.search(text, token.start(), token.end()) is None
            ):
                continue
            decoded, source_ends = _markdown_text_shadow(text, token.start(), token.end())
            url_ranges = _gfm_fallback_url_ranges(decoded)
            for start, end in url_ranges:
                raw_start = source_ends[start - 1] if start else token.start()
                result.append((raw_start, source_ends[end - 1]))
            # URL transforms run before email transforms. Their links split
            # text nodes; email must not be recovered from an existing URL.
            gaps = [0, *(p for span in url_ranges for p in span), len(decoded)]
            for left, right in zip(gaps[::2], gaps[1::2]):
                consumed = left
                for at in _GFM_EMAIL_AT.finditer(decoded, left, right):
                    position = at.start()
                    if position < consumed:
                        continue
                    domain = _GFM_FALLBACK_EMAIL_DOMAIN.match(decoded, position + 1, right)
                    if domain is None or not (
                        decoded[domain.end() - 1].isascii() and decoded[domain.end() - 1].isalpha()
                    ):
                        continue
                    local = position
                    while local > consumed and (
                        decoded[local - 1].isascii()
                        and (decoded[local - 1].isalnum() or decoded[local - 1] in "-+._")
                    ):
                        local -= 1
                    previous = decoded[local - 1] if local > left else ""
                    if previous and (
                        previous == "/" or not (
                            _GFM_URL_BREAK.fullmatch(previous) or _gfm_punctuation(previous)
                        )
                    ):
                        # The JS regex may retry after punctuation within atext
                        # when its leftmost run has an invalid preceding byte.
                        punctuation = _GFM_EMAIL_PUNCTUATION.search(decoded, local, position)
                        local = punctuation.end() if punctuation else position
                    if local == position:
                        continue
                    start = source_ends[local - 1] if local else token.start()
                    result.append((start, source_ends[domain.end() - 1]))
                    consumed = domain.end()
    return result


def _markdown_link_space(text: str, cursor: int, limit: int) -> int:
    """Skip attribute whitespace and continued quote prefixes in this block."""
    line_prefix = False
    while cursor < limit:
        character = text[cursor]
        if character in " \t\r\n":
            line_prefix = line_prefix or character in "\r\n"
            cursor += 1
        elif line_prefix and character == ">":
            # New containers are already excluded by the inline block limit.
            cursor += 1
        else:
            break
    return cursor


def _markdown_destination_end(
    text: str, start: int, limit: int, title_closers: dict[str, array],
    title_ends: dict[tuple[int, int], int | None],
) -> int | None:
    """Recognize a complete inline destination/title in unchanged source."""
    cursor = _markdown_link_space(text, start, limit)
    if cursor >= limit:
        return None
    if text[cursor] == ")":
        return cursor + 1
    if text[cursor] == "<":
        cursor += 1
        while cursor < limit:
            character = text[cursor]
            if character == "\\" and cursor + 1 < limit and text[cursor + 1] in string.punctuation:
                cursor += 2
                continue
            if character == ">":
                cursor += 1
                break
            if character in "<\r\n":
                return None
            cursor += 1
        else:
            return None
    else:
        depth = 0
        while cursor < limit:
            character = text[cursor]
            if character == "\\" and cursor + 1 < limit and text[cursor + 1] in string.punctuation:
                cursor += 2
                continue
            if character == ")":
                if depth == 0:
                    return cursor + 1
                depth -= 1
            elif character == "(":
                depth += 1
            elif character in " \t\r\n":
                break
            elif ord(character) < 32 or ord(character) == 127:
                return None
            cursor += 1
        if depth:
            return None
    after_space = _markdown_link_space(text, cursor, limit)
    if after_space >= limit:
        return None
    if text[after_space] == ")":
        return after_space + 1
    if after_space == cursor or text[after_space] not in "\"'(":
        return None
    closing = ")" if text[after_space] == "(" else text[after_space]
    if not title_closers:
        # Unclosed titles must not rescan a whole paragraph per opener.
        title_closers.update((marker, array("Q")) for marker in "\"')")
        for match in re.finditer("[\"')]", text):
            if not _is_escaped_delimiter(text, match.start()):
                title_closers[match.group(0)].append(match.start())
    positions = title_closers[closing]
    index = bisect_left(positions, after_space + 1)
    if index == len(positions) or positions[index] >= limit:
        return None
    key = (positions[index], limit)
    if key not in title_ends:
        # Many incomplete openers can share one closer and a long invalid
        # whitespace tail. Reuse failed tails too, within this source/block.
        cursor = _markdown_link_space(text, positions[index] + 1, limit)
        title_ends[key] = cursor + 1 if cursor < limit and text[cursor] == ")" else None
    return title_ends[key]


def _markdown_reference_use_end(
    text: str, label_start: int, label_end: int, limit: int, definitions: set[str],
) -> int | None:
    normalized_label = _markdown_reference_id(text[label_start + 1:label_end])
    reference_end = label_end + 1
    if text.startswith("[", reference_end):
        reference_close = _markdown_reference_label_end(text, reference_end, limit)
        if reference_close is not None:
            identifier = _markdown_reference_id(text[reference_end + 1:reference_close - 1])
            if identifier in definitions:
                return reference_close
        elif text.startswith("[]", reference_end) and normalized_label in definitions:
            return reference_end + 2
    elif normalized_label in definitions:
        return reference_end
    return None


def _markdown_dollar_math_end(
    position: int,
    limit: int,
    run_at: dict[int, tuple[int, int]],
    runs_by_width: dict[int, list[tuple[int, int]]],
    starts_by_width: dict[int, list[int]],
) -> int | None:
    """Match a dollar-math closer of the opener's exact run width in this scope."""
    opening = run_at.get(position)
    if opening is None:
        return None
    width = opening[1] - opening[0]
    starts = starts_by_width[width]
    runs = runs_by_width[width]
    index = bisect_left(starts, opening[1])
    if index < len(runs) and runs[index][0] < limit:
        return runs[index][1]
    return None


def _ranges_overlap_any(
    start: int, end: int, ranges: list[tuple[int, int]], starts: list[int],
) -> bool:
    index = bisect_left(starts, end) - 1
    return index >= 0 and ranges[index][1] > start


def _chatgpt_bracket_math_ranges(
    text: str, blocked: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Recover standalone display brackets, requiring a command for bare pairs."""
    if "[" not in text or "\\" not in text:
        return []
    blocked = _merge_ranges(blocked)
    blocked_starts = [start for start, _end in blocked]
    result = []
    for pattern, command_required in (
        (_ESCAPED_BRACKET_MATH_LINE, False),
        (_BARE_BRACKET_MATH_LINE, True),
    ):
        opening: tuple[int, int] | None = None
        for delimiter in pattern.finditer(text):
            if delimiter.group("opening") is not None:
                if opening is None:
                    opening = delimiter.span()
                continue
            if opening is None:
                continue
            start, body_start = opening
            opening = None
            end = delimiter.end()
            body = text[body_start:delimiter.start()]
            if not body.strip() or command_required and not _BARE_BRACKET_LATEX_COMMAND.search(body):
                continue
            if _ranges_overlap_any(start, end, blocked, blocked_starts):
                continue
            result.append((start, end))
    return result


def _chatgpt_rich_projection_tags(
    text: str, blocked: list[tuple[int, int]],
) -> set[tuple[int, int]] | None:
    """Recognize a conservative subset of the supported box-tag projection.

    Ambiguous code/indentation and large inputs keep literal-flow protection,
    rather than guessing whether the frontend's code-aware projection applies.
    """
    if (
        re.search(r"<box\b", text, re.IGNORECASE | re.ASCII) is None
        or len(text) > 262_144 or "`" in text or "~~~" in text
        or re.search(r"(?m)^(?: {4}|\t)", text)
    ):
        return None
    blocked = _merge_ranges(blocked)
    blocked_starts = [start for start, _end in blocked]
    tags: list[tuple[int, int, str, bool, bool]] = []
    for match in _CHATGPT_RICH_TAG.finditer(text):
        start, end = match.span()
        if start and text[start - 1] == "\\":
            continue
        if _ranges_overlap_any(start, end, blocked, blocked_starts):
            # Our protected ranges also contain math/links. The frontend's
            # profile scan only skips code; dropping one of its tags could
            # incorrectly turn an invalid global profile into a valid one.
            return None
        parsed = re.match(
            r"^\\*<(\/?)(box|row|text|badge|divider)(.*?)>$",
            match.group(0), re.IGNORECASE | re.ASCII,
        )
        if parsed is None:
            continue
        closing = bool(parsed.group(1))
        name = parsed.group(2).lower()
        attributes = parsed.group(3)
        self_closing = bool(re.search(r"/\s*$", attributes))
        attribute_text = re.sub(r"/\s*$", "", attributes)
        if closing:
            if attribute_text.strip() or self_closing:
                continue
        elif not _CHATGPT_RICH_ATTRIBUTES.fullmatch(attribute_text):
            continue
        if (name == "divider") != self_closing:
            continue
        tags.append((start, end, name, closing, self_closing))
        if len(tags) > 8192:
            return None

    stack: list[str] = []
    rich_child = False
    found_profile = False
    for start, end, name, closing, self_closing in tags:
        if not stack:
            line_start = text.rfind("\n", 0, start) + 1
            prefix = text[line_start:start]
            if (
                name != "box" or closing or self_closing
                or re.fullmatch(r"(?:[ \t]|&#(?:x20|32);)*", prefix, re.IGNORECASE) is None
            ):
                continue
            stack.append(name)
            rich_child = False
            continue
        if closing:
            if stack[-1] != name:
                return None
            stack.pop()
            if not stack and rich_child:
                found_profile = True
        else:
            rich_child = rich_child or name in {"text", "badge", "divider"}
            if not self_closing:
                stack.append(name)
            if len(stack) > 64:
                return None
    if stack or not found_profile:
        return None
    return {(start, end) for start, end, _name, _closing, _self_closing in tags}


def _is_projected_chatgpt_rich_flow(
    text: str,
    flow: tuple[int, int],
    projected_tags: set[tuple[int, int]] | None,
) -> bool:
    """Do not classify a valid rich-layout tag projection as literal HTML code."""
    if not projected_tags:
        return False
    start, end = flow
    value = text[start:end]
    if any(marker in value for marker in ("<!--", "<!", "<?")):
        return False
    if "<" in _CHATGPT_RICH_ANY_TAG.sub("", value):
        return False
    found = False
    for match in _CHATGPT_RICH_ANY_TAG.finditer(value):
        absolute_start = start + match.start()
        while absolute_start > start and text[absolute_start - 1] == "\\":
            absolute_start -= 1
        absolute_end = start + match.end()
        if (absolute_start, absolute_end) not in projected_tags:
            return False
        found = True
    return found


def _markdown_container_prefix(
    line: str, containers: tuple[int, ...], paragraph_open: bool,
) -> tuple[int, tuple[int, ...], bool]:
    """Retain matching parents, then consume new explicit list/quote prefixes.

    Container entries are zero for a quote, or the continuation indentation
    of a list item. Parsing expanded tabs is only for line classification;
    protected offsets always refer to the original, unexpanded source.
    """
    cursor = 0
    retained = []
    for indent in containers:
        if indent == 0:
            quote = _QUOTE_PREFIX.match(line, cursor)
            if quote is None:
                break
            cursor = quote.end()
        elif line.startswith(" " * indent, cursor):
            cursor += indent
        elif not line[cursor:].strip(" "):
            cursor = len(line)
        else:
            break
        retained.append(indent)
    opened = False
    while cursor < len(line):
        # A thematic break wins over interpreting its markers as nested lists.
        if _THEMATIC_BREAK.fullmatch(line, cursor):
            break
        quote = _QUOTE_PREFIX.match(line, cursor)
        if quote:
            retained.append(0)
            cursor = quote.end()
            opened = True
            paragraph_open = False
            continue
        item = _LIST_PREFIX.match(line, cursor)
        if item:
            marker = item.group("marker")
            # Padding is greedy: reaching EOL identifies an empty item without
            # copying the remaining line for every possible nested prefix.
            empty_item = item.end() == len(line)
            interrupting = paragraph_open and len(retained) == len(containers)
            if interrupting and (
                empty_item or marker[0].isdigit() and marker not in ("1.", "1)")
            ):
                # Empty items cannot interrupt prose; ordered lists must start
                # at one. After parent exit these are fresh blocks/siblings.
                break
            # More than four spaces after a list marker means one padding
            # space followed by content indentation, not arbitrary padding.
            padding = len(item.group("padding"))
            end = item.end() if padding <= 4 else item.start("padding") + 1
            # Empty items, including bare markers, have an implicit one-space
            # continuation indent regardless of their actual trailing spaces.
            indent_end = item.start("padding") + 1 if empty_item else end
            retained.append(indent_end - cursor)
            cursor = end
            opened = True
            paragraph_open = False
            continue
        break
    return cursor, tuple(retained), opened


def _fence_opening(line: str, cursor: int) -> str | None:
    fence = _FENCE_OPENING.fullmatch(line, cursor)
    if fence is None:
        math = _MATH_FENCE_OPENING.fullmatch(line, cursor)
        return math.group(1) if math else None
    if fence.group(1)[0] == "`" and "`" in fence.group(2):
        return None
    return fence.group(1)


def _markdown_table_cells(line: str, cursor: int) -> list[tuple[int, int]]:
    """Split unescaped pipes, including pipes inside backtick-looking source."""
    end = len(line.rstrip(" \t"))
    while cursor < end and line[cursor] in " \t":
        cursor += 1
    if cursor == end:
        return []
    pipes = [
        match.start() for match in re.compile(r"\|").finditer(line, cursor, end)
        if not _is_escaped_delimiter(line, match.start())
    ]
    if cursor == end - 1 and pipes:
        return []  # One bare pipe is not a table header.
    if pipes and pipes[0] == cursor:
        cursor += 1
        pipes = pipes[1:]
    if pipes and pipes[-1] == end - 1:
        end -= 1
        pipes = pipes[:-1]
    cells = []
    for right in [*pipes, end]:
        left = cursor
        while left < right and line[left] in " \t":
            left += 1
        trimmed = right
        while trimmed > left and line[trimmed - 1] in " \t":
            trimmed -= 1
        cells.append((left, trimmed))
        cursor = right + 1
    return cells


def _markdown_table_head(
    lines: list[re.Match[str]], index: int, cursor: int, containers: tuple[int, ...],
) -> bool:
    if index + 1 >= len(lines):
        return False
    header = lines[index].group(0).rstrip("\r\n").expandtabs(4)
    if header.startswith("    ", cursor):
        return False
    delimiter = lines[index + 1].group(0).rstrip("\r\n").expandtabs(4)
    start = _fence_content_start(delimiter, containers)
    if start is None or delimiter.startswith("    ", start):
        return False
    # A delimiter cannot be a lazy line or introduce a list/quote container.
    _start, parents, opened = _markdown_container_prefix(delimiter, containers, True)
    if opened or parents != containers or not any(c in delimiter[start:] for c in "|:"):
        return False
    cells = _markdown_table_cells(delimiter, start)
    return bool(
        cells and len(cells) == len(_markdown_table_cells(header, cursor))
        and all(re.fullmatch(r":?-+:?", delimiter[left:right]) for left, right in cells)
    )


def _html_block_opening(line: str, cursor: int, paragraph_open: bool) -> int | None:
    """Classify the installed CommonMark HTML-flow starts, not inline HTML.

    Flow bodies suppress Markdown recognition; they are not themselves noise
    protection. Kinds 1-5 use explicit terminators and 6-7 stop at a blank line.
    A strict generic tag (7) cannot interrupt an already open paragraph.
    """
    opening = _HTML_BLOCK_PREFIX.match(line, cursor)
    if opening is None:
        return None
    start = opening.end() - 1
    if line.startswith("<!--", start):
        return 2
    if line.startswith("<?", start):
        return 3
    if line.startswith("<![CDATA[", start):
        return 5
    if line.startswith("<!", start) and re.match(r"[A-Za-z]", line[start + 2:start + 3]):
        return 4
    closing_tag = line.startswith("</", start)
    name = _HTML_TAG_NAME.match(line, start + (2 if closing_tag else 1))
    if name is None:
        return None
    following = line[name.end():name.end() + 1]
    if following and following not in " />":
        return None
    normalized = name.group(0).lower()
    if not closing_tag and normalized in _HTML_RAW_NAMES and following != "/":
        return 1
    if normalized in _HTML_BLOCK_NAMES:
        return 6 if following != "/" or line.startswith("/>", name.end()) else None
    if paragraph_open:
        return None
    end = _MarkdownHtmlRecognizer(line).end(start, len(line), flow=True)
    return 7 if end is not None and not line[end:].strip(" ") else None


def _fence_content_start(line: str, containers: tuple[int, ...]) -> int | None:
    cursor = 0
    for indent in containers:
        if indent == 0:
            quote = _QUOTE_PREFIX.match(line, cursor)
            if quote is None:
                return None
            cursor = quote.end()
        elif line.startswith(" " * indent, cursor):
            cursor += indent
        elif not line[cursor:].strip(" "):
            # Blank list lines may omit indentation, but not a nested quote's
            # explicit marker. Let remaining quote containers fail normally.
            cursor = len(line)
        else:
            return None
    return cursor


def _is_escaped_delimiter(text: str, index: int) -> bool:
    backslashes = 0
    cursor = index - 1
    while cursor >= 0 and text[cursor] == "\\":
        backslashes += 1
        cursor -= 1
    return backslashes % 2 == 1


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
    if not left:
        return len(right) if len(right) <= limit else None
    if not right:
        return len(left) if len(left) <= limit else None

    # Keep only the diagonal band that can still reach the requested edit
    # distance.  The old implementation filled a len(right)-wide row even
    # though callers cap `limit` at two; this made a long normalized literal
    # allocate and touch a full candidate-sized row for every fuzzy probe.
    # Swapping is distance-preserving and keeps the row iteration on the
    # shorter input when the two lengths differ.
    if len(left) > len(right):
        left, right = right, left
    sentinel = limit + 1
    right_length = len(right)
    previous_start = 0
    previous_end = min(right_length, limit)
    previous = list(range(previous_end + 1))
    for row, left_char in enumerate(left, 1):
        current_start = max(0, row - limit)
        current_end = min(right_length, row + limit)
        current = [sentinel] * (current_end - current_start + 1)
        for column in range(current_start, current_end + 1):
            slot = column - current_start
            if column == 0:
                current[slot] = row
                continue
            insertion = (
                current[slot - 1] + 1
                if column - 1 >= current_start
                else sentinel
            )
            deletion = (
                previous[column - previous_start] + 1
                if previous_start <= column <= previous_end
                else sentinel
            )
            substitution = (
                previous[column - 1 - previous_start]
                + (left_char != right[column - 1])
                if previous_start <= column - 1 <= previous_end
                else sentinel
            )
            current[slot] = min(insertion, deletion, substitution)
        if min(current) > limit:
            return None
        previous_start, previous_end, previous = current_start, current_end, current
    distance = (
        previous[len(right) - previous_start]
        if previous_start <= len(right) <= previous_end
        else sentinel
    )
    return distance if distance <= limit else None


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
