"""Include selected file snapshots without semantic validation or adoption gates."""
from app.models.context_continuation import ContinuationState, ContinuationRevision, ContextMemberObject
from app.services.context_protocol.current_doc import parse_current_document
from app.services.context_protocol.source import PackageError
from app.services.continuation_candidates import ContinuationError, read_object


def carry_continuation(db, conversation_id, raw_path, *, subject_key, full_scope=True):
    # raw_path/subject_key stay in the internal call contract for old callers.
    # Member claims are external declarations, never recomputed trust or coverage.
    state = db.get(ContinuationState, conversation_id)
    if state is None or state.adopted_revision_id is None:
        return {}, None, 'none'
    revision = db.query(ContinuationRevision).filter_by(id=state.adopted_revision_id, conversation_id=conversation_id).one_or_none()
    if revision is None:
        return {}, None, 'unavailable'
    if not full_scope:
        return {}, None, 'excluded_from_partial_export'
    members, metadata = {}, {}
    try:
        for name, filename in (('current', 'current.md'), ('index', 'index.json')):
            digest = getattr(revision, name + '_sha256')
            if digest:
                path = 'continuation/' + filename
                members[path] = read_object(db.get(ContextMemberObject, digest))
                metadata[name] = path
    except ContinuationError:
        # Storage corruption must not destroy Raw export or publish half a Pair.
        return {}, None, 'unavailable'
    if 'continuation/current.md' in members:
        try:
            fields = parse_current_document(members['continuation/current.md'].decode('utf-8')).frontmatter
            metadata.update({key: fields[key] for key in ('schema_version', 'continuation_revision', 'trust',
                'coverage', 'source_fingerprint', 'raw_tail_start_seq') if key in fields})
        except (ValueError, TypeError, PackageError):
            pass
    return members, metadata, 'included_without_validation'
