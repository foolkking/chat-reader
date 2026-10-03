"""Bounded, read-only snapshot of the selected derived Context files."""
import hashlib
from app.models.context_continuation import ContinuationState, ContinuationRevision, ContextMemberObject
from app.services.assets.asset_store import get_asset_store


def offline_continuation(db, conversation_id):
    state = db.get(ContinuationState, conversation_id)
    if state is None or state.adopted_revision_id is None:
        return None
    revision = db.get(ContinuationRevision, state.adopted_revision_id)
    if revision is None or revision.conversation_id != conversation_id:
        raise ValueError('Saved Context files are unavailable.')
    members = {}
    for name, limit in (('current', 1024 * 1024), ('index', 8 * 1024 * 1024)):
        digest = getattr(revision, name + '_sha256')
        if digest is None:
            continue
        obj = db.get(ContextMemberObject, digest)
        if obj is None or not 0 < obj.byte_size <= limit:
            raise ValueError('Saved Context file metadata is invalid.')
        with get_asset_store().resolve_key(obj.storage_key).open('rb') as source:
            data = source.read(limit + 1)
        if len(data) != obj.byte_size or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError('Saved Context file failed integrity checks.')
        members[name] = {'text': data.decode('utf-8'), 'sha256': digest, 'byte_size': obj.byte_size}
    metadata = {}
    if 'current' in members:
        from app.services.context_protocol.current_doc import parse_current_document
        from app.services.context_protocol.source import PackageError
        try:
            fields = parse_current_document(members['current']['text']).frontmatter
            metadata = {key: fields[key] for key in ('schema_version', 'continuation_revision', 'trust',
                'coverage', 'source_fingerprint', 'raw_tail_start_seq') if key in fields}
        except (ValueError, TypeError, PackageError):
            pass
    return {'version': 1, 'generation': state.generation, 'revision_id': str(revision.id),
            'updated_at': state.updated_at.isoformat(), 'members': members, 'metadata': metadata,
            'system_validation': 'not_performed'}
