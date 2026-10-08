"""Explicit personal exceptions and bounded, non-mutating rule trials."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from types import SimpleNamespace

from sqlalchemy import func, text as sql_text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.content_cleanup import ContentCleanupException as ExceptionRule, ContentCleanupOccurrence as Occurrence, ContentCleanupRule as Rule, ContentCleanupRuleRevision as Revision, ContentCleanupScan as Scan
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.ownership import OwnershipScope

CONTEXT_LENGTH = 48
TRIAL_MESSAGES = 100
TRIAL_CHARACTERS = 250_000
TRIAL_MESSAGE_CHARACTERS = 20_000
CONFIG_FIELDS = ("name", "match_value", "case_sensitive", "role_filter", "matcher_mode", "boundary_mode")


def _digest(value: dict) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _signed_preview(payload: dict, timestamp: int) -> str:
    secret = get_settings().auth_secret_value() or "development-cleanup-preview"
    signature = hmac.new(secret.encode(), f"{timestamp}:{_digest(payload)}".encode(), hashlib.sha256).hexdigest()
    return f"{timestamp}.{signature}"


def issue_preview(payload: dict) -> str:
    return _signed_preview(payload, int(time.time()))


def verify_preview(payload: dict, token: str) -> None:
    try:
        timestamp = int(token.split(".", 1)[0])
    except (ValueError, AttributeError):
        raise ValueError("Preview this configuration before confirming.") from None
    if not 0 <= time.time() - timestamp <= 600 or not hmac.compare_digest(_signed_preview(payload, timestamp), token):
        raise ValueError("Preview expired or configuration changed. Preview again before confirming.")


def exception_scope(revision_id, role: str, source: str, start: int, end: int) -> dict:
    before, after = source[max(0, start - CONTEXT_LENGTH):start], source[end:end + CONTEXT_LENGTH]
    return {"rule_revision_id": str(revision_id), "role": role, "match_value": source[start:end],
        "context_before": before, "context_after": after,
        "at_start": start <= CONTEXT_LENGTH, "at_end": len(source) - end <= CONTEXT_LENGTH}


def exception_digests(db: Session, scope: OwnershipScope, revision_ids: list[uuid.UUID]) -> set[str]:
    return {row[0] for row in db.query(ExceptionRule.scope_digest).filter(
        ExceptionRule.owner_user_id == scope.owner_user_id, ExceptionRule.rule_revision_id.in_(revision_ids))}


def is_ignored(digests: set[str], revision_id, role: str, source: str, start: int, end: int) -> bool:
    return bool(digests) and _digest(exception_scope(revision_id, role, source, start, end)) in digests


def _exception_candidate(db: Session, scope: OwnershipScope, scan_id: uuid.UUID, occurrence_id: uuid.UUID):
    from app.services.content_cleanup import source_fingerprint
    scan = db.query(Scan).filter(Scan.id == scan_id, scope.predicate(Scan)).with_for_update().first()
    if scan is None:
        raise LookupError("Noise scan not found.")
    if scan.status != "READY":
        raise ValueError("Wait for this scan to be ready before saving an exception.")
    row = db.query(Occurrence).filter_by(scan_id=scan_id, id=occurrence_id).first()
    if row is None:
        raise LookupError("Noise candidate not found.")
    message, version = db.get(Message, row.message_id), db.get(MessageVersion, row.message_version_id)
    conversation = db.query(Conversation).filter(Conversation.id == row.conversation_id, scope.predicate(Conversation)).first()
    if conversation is None:
        raise LookupError("Conversation not found.")
    if (row.decision in {"APPLIED", "CONFLICT"} or not message or not version or message.is_deleted
        or row.source_content_hash != source_fingerprint(version.display_text)
        or message.current_version_id != row.message_version_id or conversation.deleted_at or conversation.status != "active"):
        raise ValueError("Source changed. Rescan before saving an exception.")
    revision = db.get(Revision, row.rule_revision_id)
    rule = db.get(Rule, revision.rule_id)
    if rule.detector_id == "manual-selection-v1":
        raise ValueError("Manual selections have no automatic rule to ignore.")
    if row.end_offset - row.start_offset > 4096:
        raise ValueError("Select a smaller rule match before saving an exception.")
    return row, rule, revision, exception_scope(revision.id, message.role, version.display_text, row.start_offset, row.end_offset)


def preview_exception(db: Session, scope: OwnershipScope, scan_id: uuid.UUID, occurrence_id: uuid.UUID) -> dict:
    from app.services.cleanup_rule_access import personal_name
    row, rule, revision, config = _exception_candidate(db, scope, scan_id, occurrence_id)
    authority = {"purpose": "cleanup-exception", "owner": scope.owner_user_id, "occurrence": row.id, "version": row.message_version_id, **config}
    saved = db.query(ExceptionRule.id).filter_by(owner_user_id=scope.owner_user_id, scope_digest=_digest(config)).first() is not None
    return {**config, "rule_name": personal_name(db, scope.owner_user_id, rule), "detector_id": rule.detector_id, "revision": revision.revision,
        "preview_token": issue_preview(authority), "exception_saved": saved, "decision": row.decision}


def save_exception(db: Session, scope: OwnershipScope, scan_id: uuid.UUID, occurrence_id: uuid.UUID, token: str) -> ExceptionRule:
    from app.services.content_cleanup import update_decisions
    row, _rule, _revision, config = _exception_candidate(db, scope, scan_id, occurrence_id)
    verify_preview({"purpose": "cleanup-exception", "owner": scope.owner_user_id, "occurrence": row.id, "version": row.message_version_id, **config}, token)
    digest = _digest(config)
    # Different scans can confirm the same scope simultaneously.
    if db.bind.dialect.name == "postgresql":
        lock = int.from_bytes(hashlib.sha256(f"{scope.owner_user_id}:{digest}".encode()).digest()[:8], "big", signed=True)
        db.execute(sql_text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock})
    saved = db.query(ExceptionRule).filter_by(owner_user_id=scope.owner_user_id, scope_digest=digest).first()
    if saved is None:
        saved = ExceptionRule(owner_user_id=scope.owner_user_id, scope_digest=digest,
            **{**config, "rule_revision_id": row.rule_revision_id})
        db.add(saved)
    update_decisions(db, scan_id, {row.id: "KEEP"})
    db.flush()
    return saved


def list_exceptions(db: Session, scope: OwnershipScope, *, limit: int, offset: int) -> dict:
    from app.services.cleanup_rule_access import personal_name
    query = db.query(ExceptionRule, Revision, Rule).join(Revision, Revision.id == ExceptionRule.rule_revision_id).join(Rule, Rule.id == Revision.rule_id).filter(ExceptionRule.owner_user_id == scope.owner_user_id)
    total = query.count()
    items = [{"id": str(item.id), "rule_name": personal_name(db, scope.owner_user_id, rule), "detector_id": rule.detector_id, "revision": revision.revision,
        "role": item.role, "match_value": item.match_value, "context_before": item.context_before, "context_after": item.context_after,
        "at_start": item.at_start, "at_end": item.at_end, "created_at": item.created_at}
        for item, revision, rule in query.order_by(ExceptionRule.created_at.desc(), ExceptionRule.id).offset(offset).limit(limit)]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


def rule_config(payload: dict) -> dict:
    return {**{key: payload[key] for key in CONFIG_FIELDS}, "name": payload["name"].strip(), "match_value": payload["match_value"].strip()}


def rule_authority(scope: OwnershipScope, config: dict, rule_id=None, base_revision=None, base_revision_id=None, base_edit_token=None) -> dict:
    return {"purpose": "cleanup-rule-learning", "owner": scope.owner_user_id, "rule_id": rule_id, "base_revision": base_revision, "base_revision_id": base_revision_id,
        **({"base_edit_token": base_edit_token} if base_edit_token is not None else {}), **config}


def trial_rule(db: Session, scope: OwnershipScope, config: dict, *, rule_id=None, base_revision=None, base_revision_id=None, base_edit_token=None, conversation_id=None) -> dict:
    from app.services.content_cleanup import detect_occurrences, validate_literal_rule
    validate_literal_rule(config["match_value"], config["matcher_mode"])
    if not config["name"]:
        raise ValueError("A rule name is required.")
    if rule_id is not None:
        from app.services.cleanup_rule_access import current_rule, personal_edit_token
        rule, latest, _ = current_rule(db, scope, rule_id)
        if rule.kind != "USER_LITERAL":
            raise LookupError("Noise rule not found.")
        if base_revision != latest.revision or (base_revision_id is not None and base_revision_id != latest.id):
            raise ValueError("Rule changed on another device. Reload the saved version; your draft can be kept.")
        current_token = personal_edit_token(db, scope, rule, latest)
        if base_edit_token is not None and base_edit_token != current_token:
            raise ValueError("Rule changed on another device. Reload the saved version; your draft can be kept.")
        base_edit_token = current_token
    if conversation_id and db.query(Conversation.id).filter(Conversation.id == conversation_id, scope.predicate(Conversation)).first() is None:
        raise LookupError("Conversation not found.")
    query = db.query(Message.id, Message.role, Message.current_version_id, func.length(MessageVersion.display_text)).join(
        MessageVersion, MessageVersion.id == Message.current_version_id).join(Conversation, Conversation.id == Message.conversation_id).filter(
        scope.predicate(Conversation), Conversation.status == "active", Conversation.deleted_at.is_(None), Message.is_deleted.is_(False))
    if config["role_filter"]:
        query = query.filter(Message.role == config["role_filter"])
    if conversation_id:
        query = query.filter(Conversation.id == conversation_id)
    rows = query.order_by(Message.id).limit(TRIAL_MESSAGES + 1).all()
    candidate = SimpleNamespace(**config)
    scanned, characters, matches, protected, skipped = 0, 0, 0, 0, 0
    samples = []
    for _message_id, role, version_id, length in rows[:TRIAL_MESSAGES]:
        if length > TRIAL_MESSAGE_CHARACTERS or characters + length > TRIAL_CHARACTERS:
            skipped += 1
            continue
        source = db.query(MessageVersion.display_text).filter_by(id=version_id).scalar()
        scanned += 1
        characters += length
        for hit in detect_occurrences(role, source, SimpleNamespace(detector_id=None), candidate):
            matches += 1
            protected += hit.decision == "PROTECTED"
            if len(samples) < 10:
                samples.append({"role": role, "match_text": source[hit.start:hit.end], "context_before": source[max(0, hit.start - 48):hit.start],
                    "context_after": source[hit.end:hit.end + 48], "protected": hit.decision == "PROTECTED"})
    return {"configuration": config, "scanned_messages": scanned, "matches": matches, "protected_matches": protected,
        "skipped_messages": skipped, "limited": len(rows) > TRIAL_MESSAGES or skipped > 0,
        "message_limit": TRIAL_MESSAGES, "character_limit": TRIAL_CHARACTERS, "message_character_limit": TRIAL_MESSAGE_CHARACTERS,
        "samples": samples, "base_edit_token": base_edit_token,
        "preview_token": issue_preview(rule_authority(scope, config, rule_id, base_revision, base_revision_id, base_edit_token))}
