"""Bounded, read-only snapshot of the selected derived Context files."""
import hashlib
from app.models.context_continuation import ContinuationState, ContinuationRevision, ContextMemberObject
from app.services.assets.asset_store import get_asset_store


class OfflineDependencyError(ValueError):
    """Only bounded codes/owned identifiers may cross the task boundary."""

    def __init__(self, code, *, affected=(), affected_count=None):
        super().__init__(code)
        self.failure = {
            "code": code,
            "phase": "checking_dependencies",
            "affected_count": len(affected) if affected_count is None else affected_count,
            "affected": list(affected)[:20],
        }


def offline_continuation(db, conversation_id):
    state = db.get(ContinuationState, conversation_id)
    if state is None or state.adopted_revision_id is None:
        return None
    revision = db.get(ContinuationRevision, state.adopted_revision_id)
    if revision is None or revision.conversation_id != conversation_id:
        raise OfflineDependencyError("OFFLINE_CONTEXT_UNAVAILABLE", affected=[{"conversation_id": str(conversation_id)}])
    members = {}
    for name, limit in (('current', 1024 * 1024), ('index', 8 * 1024 * 1024)):
        digest = getattr(revision, name + '_sha256')
        if digest is None:
            continue
        obj = db.get(ContextMemberObject, digest)
        if obj is None or not 0 < obj.byte_size <= limit:
            raise OfflineDependencyError("OFFLINE_CONTEXT_UNAVAILABLE", affected=[{"conversation_id": str(conversation_id)}])
        try:
            with get_asset_store().resolve_key(obj.storage_key).open('rb') as source:
                data = source.read(limit + 1)
        except (OSError, ValueError) as exc:
            raise OfflineDependencyError("OFFLINE_CONTEXT_UNAVAILABLE", affected=[{"conversation_id": str(conversation_id)}]) from exc
        if len(data) != obj.byte_size or hashlib.sha256(data).hexdigest() != digest:
            raise OfflineDependencyError("OFFLINE_CONTEXT_INTEGRITY", affected=[{"conversation_id": str(conversation_id)}])
        try:
            text = data.decode('utf-8')
        except UnicodeError as exc:
            raise OfflineDependencyError("OFFLINE_CONTEXT_INTEGRITY", affected=[{"conversation_id": str(conversation_id)}]) from exc
        members[name] = {'text': text, 'sha256': digest, 'byte_size': obj.byte_size}
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
