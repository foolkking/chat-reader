"""Durable member drafts. Saving a draft never validates or adopts a Pair."""
from __future__ import annotations

import hashlib
import io
import json
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.context_continuation import ContextMemberObject, ContinuationCandidate, ContinuationRevision, ContinuationState
from app.models.import_record import utc_now
from app.services.assets.asset_store import get_asset_store
from app.services.context_protocol.safety import load_protocol_json
from app.services.exporting.archive_transaction import track_archive_object
from app.services.ownership import OwnershipScope

MEMBER_LIMITS = {"current": 1024 * 1024, "index": 8 * 1024 * 1024, "manifest": 1024 * 1024}


class ContinuationError(Exception):
    def __init__(self, code: str, status_code: int = 422):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def owned_conversation(db: Session, conversation_id: uuid.UUID, scope: OwnershipScope, *, lock=False):
    if lock:
        from app.services.subject_account import lock_subject_account
        lock_subject_account(db, str(scope.owner_user_id))
    query = db.query(Conversation).filter(Conversation.id == conversation_id, scope.predicate(Conversation), Conversation.deleted_at.is_(None))
    if lock:
        query = query.with_for_update().populate_existing()
    item = query.one_or_none()
    if item is None:
        raise ContinuationError("CONTEXT_NOT_FOUND", 404)
    return item


def checked_members(members: dict[str, bytes]) -> dict[str, bytes]:
    if not members or set(members) - MEMBER_LIMITS.keys():
        raise ContinuationError("CONTEXT_MEMBERS_REQUIRED")
    for name, data in members.items():
        if len(data) > MEMBER_LIMITS[name]:
            raise ContinuationError("CONTEXT_MEMBER_TOO_LARGE", 413)
        try:
            text = data.decode("utf-8")
            if not text.strip() or "\x00" in text:
                raise ValueError()
            if name != "current" and not isinstance(load_protocol_json(text), dict):
                raise ValueError()
        except (UnicodeError, ValueError) as exc:
            raise ContinuationError("CONTEXT_MEMBER_INVALID") from exc
    return members


def read_object(obj: ContextMemberObject | None) -> bytes:
    if obj is None:
        raise ContinuationError("CONTEXT_MEMBER_UNAVAILABLE", 409)
    try:
        with get_asset_store().resolve_key(obj.storage_key).open("rb") as handle:
            data = handle.read(max(MEMBER_LIMITS.values()) + 1)
        if len(data) != obj.byte_size or hashlib.sha256(data).hexdigest() != obj.sha256:
            raise ValueError()
    except (OSError, ValueError) as exc:
        raise ContinuationError("CONTEXT_MEMBER_UNAVAILABLE", 409) from exc
    return data


def _store_member(db: Session, data: bytes) -> str:
    digest = hashlib.sha256(data).hexdigest()
    query = db.query(ContextMemberObject).filter_by(sha256=digest)
    obj = query.with_for_update(read=True, key_share=True).one_or_none()
    if obj is not None:
        read_object(obj)
        return digest
    store = get_asset_store()
    key = "context/" + store.object_key()
    if db.get_bind().dialect.name == "sqlite" and not db.connection().connection.driver_connection.in_transaction:
        # sqlite3 legacy mode can release an outermost SAVEPOINT as a commit.
        # The object row must roll back together with its tracked physical file.
        db.connection().exec_driver_sql("BEGIN")
    try:
        with db.begin_nested():
            db.add(ContextMemberObject(sha256=digest, storage_key=key, byte_size=len(data)))
            db.flush()
    except IntegrityError:
        read_object(query.with_for_update(read=True, key_share=True).one())
        return digest
    staged = store.stage(io.BytesIO(data), max_bytes=max(MEMBER_LIMITS.values()))
    try:
        store.promote(staged.path, key)
    finally:
        staged.path.unlink(missing_ok=True)
    track_archive_object(db, store, key)
    return digest


def _state(db: Session, conversation_id: uuid.UUID):
    # Caller holds the conversation lock, serializing first creation and adoption.
    item = db.get(ContinuationState, conversation_id)
    if item is None:
        item = ContinuationState(conversation_id=conversation_id, generation=0)
        db.add(item)
        db.flush()
    return item


def create_candidate(db: Session, conversation_id: uuid.UUID, scope: OwnershipScope, *, members: dict[str, bytes], base_generation: int, base_revision_id: uuid.UUID | None, idempotency_key: str):
    owned_conversation(db, conversation_id, scope, lock=True)
    checked_members(members)
    if base_generation < 0 or not 1 <= len(idempotency_key) <= 128:
        raise ContinuationError("CONTEXT_REQUEST_INVALID")
    request_digest = hashlib.sha256(json.dumps({
        "base_generation": base_generation, "base_revision_id": str(base_revision_id) if base_revision_id else None,
        "members": {name: hashlib.sha256(data).hexdigest() for name, data in members.items()},
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    existing = db.query(ContinuationCandidate).filter_by(conversation_id=conversation_id, idempotency_key=idempotency_key).one_or_none()
    if existing is not None:
        if existing.request_digest != request_digest:
            raise ContinuationError("CONTEXT_IDEMPOTENCY_CONFLICT", 409)
        return existing
    state = _state(db, conversation_id)
    if state.generation != base_generation:
        raise ContinuationError("CONTEXT_BASE_CHANGED", 409)
    base = None
    if base_revision_id is not None:
        base = db.query(ContinuationRevision).filter_by(id=base_revision_id, conversation_id=conversation_id).one_or_none()
        if base is None:
            raise ContinuationError("CONTEXT_REVISION_NOT_FOUND", 404)
    item = ContinuationCandidate(conversation_id=conversation_id, base_generation=base_generation,
                                 base_revision_id=base_revision_id, idempotency_key=idempotency_key,
                                 request_digest=request_digest, input_revision=1, inherited_members=[])
    for name in ("current", "index"):
        if base is not None and name not in members:
            setattr(item, name + "_sha256", getattr(base, name + "_sha256"))
            item.inherited_members.append(name)
    for name, data in members.items():
        setattr(item, name + "_sha256", _store_member(db, data))
    item.status = "READY_FOR_VALIDATION" if item.current_sha256 and item.index_sha256 else "DRAFT"
    db.add(item)
    db.flush()
    return item


def get_candidate(db: Session, conversation_id: uuid.UUID, candidate_id: uuid.UUID, scope: OwnershipScope, *, lock=False):
    owned_conversation(db, conversation_id, scope, lock=lock)
    query = db.query(ContinuationCandidate).filter_by(id=candidate_id, conversation_id=conversation_id)
    if lock:
        query = query.with_for_update().populate_existing()
    item = query.one_or_none()
    if item is None:
        raise ContinuationError("CONTEXT_CANDIDATE_NOT_FOUND", 404)
    return item


def replace_members(db: Session, conversation_id: uuid.UUID, candidate_id: uuid.UUID, scope: OwnershipScope, *, members: dict[str, bytes], base_input_revision: int):
    item = get_candidate(db, conversation_id, candidate_id, scope, lock=True)
    checked_members(members)
    if item.status in {"VALIDATING", "ADOPTED"}:
        raise ContinuationError("CONTEXT_CANDIDATE_LOCKED", 409)
    if all(getattr(item, name + "_sha256") == hashlib.sha256(data).hexdigest() for name, data in members.items()):
        return item
    if item.input_revision != base_input_revision:
        raise ContinuationError("CONTEXT_CANDIDATE_CHANGED", 409)
    for name, data in members.items():
        setattr(item, name + "_sha256", _store_member(db, data))
    item.inherited_members = [name for name in item.inherited_members if name not in members]
    item.input_revision += 1
    item.status = "READY_FOR_VALIDATION" if item.current_sha256 and item.index_sha256 else "DRAFT"
    item.updated_at = utc_now()
    db.flush()
    return item


def candidate_read(item: ContinuationCandidate):
    return {"id": item.id, "conversation_id": item.conversation_id, "base_generation": item.base_generation,
            "base_revision_id": item.base_revision_id, "input_revision": item.input_revision, "status": item.status,
            "members": {name: {"present": bool(getattr(item, name + "_sha256")), "inherited": name in item.inherited_members}
                        for name in MEMBER_LIMITS},
            "missing_members": [name for name in ("current", "index") if not getattr(item, name + "_sha256")],
            "created_at": item.created_at, "updated_at": item.updated_at}
