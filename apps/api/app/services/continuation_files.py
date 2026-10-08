"""Direct user file updates: no candidates, semantic validation or adoption."""
import hashlib
import json
import uuid
from app.models.context_continuation import ContinuationRevision, ContinuationState, ContinuationCandidate
from app.services.conversation_revision import bump_offline_revision
from app.models.import_record import utc_now
from app.services.continuation_candidates import ContinuationError, owned_conversation, checked_members, _store_member


def update_files(db, conversation_id, scope, *, members, base_generation):
    conversation = owned_conversation(db, conversation_id, scope, lock=True)
    if set(members) - {"current", "index"}:
        raise ContinuationError("CONTEXT_MEMBER_INVALID")
    checked_members(members)
    state = db.get(ContinuationState, conversation_id)
    if state is None:
        state = ContinuationState(conversation_id=conversation_id, generation=0)
        db.add(state)
        db.flush()
    previous = db.get(ContinuationRevision, state.adopted_revision_id) if state.adopted_revision_id else None
    provided = {name: hashlib.sha256(data).hexdigest() for name, data in members.items()}
    # Exact retries are harmless even when the response to the first write was lost.
    if previous and all(getattr(previous, name + "_sha256") == digest for name, digest in provided.items()):
        return previous, state
    if base_generation != state.generation:
        raise ContinuationError("CONTEXT_BASE_CHANGED", 409)
    hashes = {name: getattr(previous, name + "_sha256") if previous else None for name in ("current", "index")}
    for name, data in members.items():
        hashes[name] = _store_member(db, data)
    revision_id = uuid.uuid4()
    from app.services.continuation_guidance import index_order_binding
    binding = index_order_binding(db, conversation_id, members['index']) if 'index' in members else (
        previous.source_metadata.get('guidance_index_order') if previous else None)
    row = ContinuationRevision(id=revision_id, conversation_id=conversation_id, parent_id=previous.id if previous else None,
        branch_key="direct-files", protocol_revision=str(state.generation + 1), schema_version="unspecified",
        declared_trust="unverified", digest=hashlib.sha256(json.dumps([str(revision_id), hashes], sort_keys=True).encode()).hexdigest(),
        current_sha256=hashes["current"], index_sha256=hashes["index"],
        source_metadata={"mode": "direct_files", "updated_members": sorted(members), "system_validation": "not_performed",
                         "guidance_index_order": binding})
    db.add(row)
    db.flush()
    state.adopted_revision_id = row.id
    state.generation += 1
    state.updated_at = utc_now()
    bump_offline_revision(conversation)
    db.flush()
    obsolete_rows = db.query(ContinuationRevision).filter_by(conversation_id=conversation_id).order_by(
        ContinuationRevision.created_at.desc(), ContinuationRevision.id.desc()).offset(3).all()
    obsolete = [item.id for item in obsolete_rows]
    obsolete_hashes = {digest for item in obsolete_rows for digest in (item.current_sha256, item.index_sha256)}
    if obsolete:
        db.query(ContinuationCandidate).filter(ContinuationCandidate.base_revision_id.in_(obsolete)).update({"base_revision_id": None}, synchronize_session=False)
        db.query(ContinuationRevision).filter(ContinuationRevision.parent_id.in_(obsolete)).update({"parent_id": None}, synchronize_session=False)
        db.query(ContinuationRevision).filter(ContinuationRevision.id.in_(obsolete)).delete(synchronize_session=False)
    if obsolete:
        from app.services.context_cleanup import reclaim_context_objects, queue_context_cleanup
        keys = reclaim_context_objects(db, obsolete_hashes)
        queue_context_cleanup(db, keys, owner_user_id=scope.owner_user_id)
    return row, state
