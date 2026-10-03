"""Explicit adoption of an already validated, unchanged member Pair."""
import hashlib
import json

from app.models.context_continuation import ContinuationRevision, ContinuationValidation
from app.models.conversation import Conversation
from app.models.import_record import utc_now
from app.services.context_dependencies import context_dependency_digest
from app.services.context_protocol.current_doc import parse_current_document
from app.services.continuation_candidates import ContinuationError, _state, get_candidate, read_object
from app.models.context_continuation import ContextMemberObject
from app.services.continuation_validation import candidate_digest


def pair_digest(candidate):
    return hashlib.sha256(json.dumps([candidate.current_sha256, candidate.index_sha256], separators=(',', ':')).encode()).hexdigest()


def adopt_candidate(db, conversation_id, candidate_id, scope, *, validation_id, base_generation, subject_key, branch_key='main'):
    item = get_candidate(db, conversation_id, candidate_id, scope, lock=True)
    state = _state(db, conversation_id)
    digest = pair_digest(item)
    existing = db.query(ContinuationRevision).filter_by(conversation_id=conversation_id, digest=digest).one_or_none()
    if item.status == 'ADOPTED' and existing is not None:
        return existing, state, True
    if state.generation != base_generation or item.base_generation != base_generation:
        raise ContinuationError('CONTEXT_BASE_CHANGED', 409)
    validation = db.query(ContinuationValidation).filter_by(id=validation_id, candidate_id=item.id).one_or_none()
    if validation is None:
        raise ContinuationError('CONTEXT_VALIDATION_NOT_FOUND', 404)
    if validation.input_revision != item.input_revision or validation.input_digest != candidate_digest(item):
        raise ContinuationError('CONTEXT_CANDIDATE_CHANGED', 409)
    if validation.runtime_state not in {'valid_verified', 'valid_provisional'} or not validation.result.get('eligible_for_adoption'):
        raise ContinuationError('CONTEXT_VALIDATION_REQUIRED', 409)
    conversation = db.get(Conversation, conversation_id)
    if (conversation.offline_revision != validation.raw_revision
            or validation.result.get('dependency_digest') != context_dependency_digest(db, conversation_id, subject_key)):
        raise ContinuationError('CONTEXT_SOURCE_CHANGED', 409)
    read_object(db.get(ContextMemberObject, item.index_sha256))
    metadata = parse_current_document(read_object(db.get(ContextMemberObject, item.current_sha256)).decode('utf-8')).frontmatter
    protocol_revision = json.dumps(metadata['continuation_revision'], ensure_ascii=False, separators=(',', ':'))
    if len(protocol_revision) > 160 or not 1 <= len(branch_key) <= 64:
        raise ContinuationError('CONTEXT_REVISION_INVALID')
    collision = db.query(ContinuationRevision).filter_by(conversation_id=conversation_id, branch_key=branch_key,
                                                        protocol_revision=protocol_revision).one_or_none()
    if collision is not None and collision.digest != digest:
        raise ContinuationError('CONTEXT_PROTOCOL_REVISION_CONFLICT', 409)
    if existing is None:
        coverage = {key: metadata['coverage'][key] for key in ('seq_start', 'seq_end', 'message_count')}
        coverage['source_fingerprint'] = {key: metadata['coverage']['source_fingerprint'][key]
                                          for key in ('profile', 'algorithm', 'content', 'locators')}
        existing = ContinuationRevision(conversation_id=conversation_id, parent_id=item.base_revision_id or state.adopted_revision_id,
                                        branch_key=branch_key, protocol_revision=protocol_revision, digest=digest,
                                        schema_version=str(metadata['schema_version']), declared_trust=str(metadata['trust']),
                                        current_sha256=item.current_sha256, index_sha256=item.index_sha256,
                                        source_metadata={'coverage': coverage, 'conversation_id': str(conversation_id),
                                                         'raw_revision': validation.raw_revision,
                                                         'dependency_digest': validation.result['dependency_digest'],
                                                         'supplementary_context_coverage': 'not_covered_by_message_fingerprint'})
        db.add(existing)
        db.flush()
    state.adopted_revision_id = existing.id
    state.generation += 1
    state.updated_at = utc_now()
    item.status = 'ADOPTED'
    item.updated_at = utc_now()
    db.flush()
    return existing, state, False
