"""Validate saved members against canonical Raw without changing either input."""
import hashlib
import json
import re

from app.models.context_continuation import ContextMemberObject, ContinuationValidation
from app.services.continuation_candidates import ContinuationError, get_candidate, read_object
from app.services.context_snapshot import temporary_context_snapshot
from app.services.context_protocol.current_doc import parse_current_document
from app.services.context_protocol.manifest import load_package_manifest, normalize_manifest
from app.services.context_protocol.safety import load_protocol_json
from app.services.context_protocol.source import PackageSource
from app.services.context_protocol.validation import validate_continuation, TOOL_VERSION


def candidate_digest(candidate):
    return hashlib.sha256(json.dumps([candidate.current_sha256, candidate.index_sha256,
                                      candidate.manifest_sha256], separators=(',', ':')).encode()).hexdigest()


def _safe_result(report):
    # Runtime findings may contain source text, paths and locators. Keep only
    # machine codes and severities in durable diagnostics, never observed values.
    findings = []
    for finding in report.get('findings', [])[:200]:
        code = finding.get('code', '')
        severity = finding.get('severity')
        if isinstance(code, str) and re.fullmatch(r'[a-z0-9_]{1,100}', code) and severity in {'info', 'warning', 'error'}:
            findings.append({'code': code, 'severity': severity})
    state = report.get('runtime_state')
    eligible = state in {'valid_verified', 'valid_provisional'} and not any(f['severity'] == 'error' for f in findings)
    return {'eligible_for_adoption': eligible, 'semantic_review': 'not_performed', 'findings': findings,
            'declared_trust': report.get('trust', {}).get('persisted'),
            'next_action': 'preview' if eligible else 'repair_or_complete'}


def validate_candidate_members(db, conversation_id, candidate_id, scope, *, subject_key, progress_callback=None, expected_input_revision=None):
    """Worker operation. Publication rechecks both input and canonical revision."""
    item = get_candidate(db, conversation_id, candidate_id, scope)
    if expected_input_revision is not None and item.input_revision != expected_input_revision:
        raise ContinuationError('CONTEXT_CANDIDATE_CHANGED', 409)
    if not item.current_sha256 or not item.index_sha256:
        raise ContinuationError('CONTEXT_PAIR_INCOMPLETE', 409)
    input_revision, digest = item.input_revision, candidate_digest(item)
    members = {}
    for name in ('current', 'index', 'manifest'):
        sha = getattr(item, name + '_sha256')
        if sha:
            obj = db.get(ContextMemberObject, sha)
            if obj is None:
                raise ContinuationError('CONTEXT_MEMBER_UNAVAILABLE', 409)
            members[name] = read_object(obj)
    dependencies = {}
    with temporary_context_snapshot(db, conversation_id, subject_key=subject_key, progress_callback=progress_callback,
                                    dependency_capture=dependencies) as (path, raw_revision):
        target = path.parent / 'validation-input'
        target.mkdir()
        with PackageSource(path) as source:
            manifest = load_package_manifest(source).raw
            for member in source.list_members():
                if member != 'manifest.json':
                    source.copy_member(member, target / member)
        current = parse_current_document(members['current'].decode('utf-8'))
        if 'manifest' in members:
            supplied = normalize_manifest(load_protocol_json(members['manifest'].decode('utf-8')))
            supplied_id = supplied.get('conversation', {}).get('id')
            if supplied_id is not None and supplied_id != str(conversation_id):
                raise ContinuationError('CONTEXT_IDENTITY_MISMATCH', 409)
            continuation = supplied.get('continuation')
        else:
            continuation = None
        if continuation is None:
            # Copy explicit declarations; never infer missing coverage or evidence.
            continuation = {key: current.frontmatter[key] for key in
                            ('schema_version', 'continuation_revision', 'trust', 'coverage', 'source_fingerprint', 'raw_tail_start_seq')
                            if key in current.frontmatter}
            continuation.update(current='continuation/current.md', index='continuation/index.json')
        manifest['continuation'] = continuation
        for name, filename in (('current', 'current.md'), ('index', 'index.json')):
            relative = 'continuation/' + filename
            destination = target / relative
            destination.parent.mkdir(exist_ok=True)
            destination.write_bytes(members[name])
            manifest['files'][relative] = {'sha256': hashlib.sha256(members[name]).hexdigest(), 'byte_size': len(members[name])}
        (target / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
        report = validate_continuation(str(target))
    # Refresh locked rows after expensive work; never publish a stale result.
    item = get_candidate(db, conversation_id, candidate_id, scope, lock=True)
    if item.input_revision != input_revision or candidate_digest(item) != digest:
        raise ContinuationError('CONTEXT_CANDIDATE_CHANGED', 409)
    from app.models.conversation import Conversation
    if db.get(Conversation, conversation_id).offline_revision != raw_revision:
        raise ContinuationError('CONTEXT_SOURCE_CHANGED', 409)
    from app.services.context_dependencies import context_dependency_digest
    if context_dependency_digest(db, conversation_id, subject_key) != dependencies['digest']:
        raise ContinuationError('CONTEXT_SOURCE_CHANGED', 409)
    result = _safe_result(report)
    result['dependency_digest'] = dependencies['digest']
    result['supplementary_context_coverage'] = 'not_covered_by_message_fingerprint'
    validation = ContinuationValidation(candidate_id=item.id, input_revision=input_revision, raw_revision=raw_revision,
                                        checker_version=TOOL_VERSION, input_digest=digest,
                                        runtime_state=report['runtime_state'], result=result)
    db.add(validation)
    item.status = 'VALIDATED' if result['eligible_for_adoption'] else 'NEEDS_REPAIR'
    db.flush()
    return validation


def queue_candidate_validation(db, conversation_id, candidate_id, scope, *, input_revision, idempotency_key):
    from app.models.background_job import BackgroundJob
    item = get_candidate(db, conversation_id, candidate_id, scope, lock=True)
    if item.input_revision != input_revision:
        raise ContinuationError('CONTEXT_CANDIDATE_CHANGED', 409)
    if not item.current_sha256 or not item.index_sha256:
        raise ContinuationError('CONTEXT_PAIR_INCOMPLETE', 409)
    key = 'context-validation:' + str(candidate_id) + ':' + idempotency_key
    existing = db.query(BackgroundJob).filter_by(owner_user_id=scope.owner_user_id, job_type='context_validation', idempotency_key=key).first()
    if existing is not None:
        if existing.payload.get('input_revision') != input_revision:
            raise ContinuationError('CONTEXT_IDEMPOTENCY_CONFLICT', 409)
        return existing
    job = BackgroundJob(owner_user_id=scope.owner_user_id, job_type='context_validation', status='queued', phase='queued',
                        total_items=1, idempotency_key=key, result={},
                        payload={'conversation_id': str(conversation_id), 'candidate_id': str(candidate_id), 'input_revision': input_revision})
    db.add(job)
    db.flush()
    return job
