"""Optional .cr extension for saved Context members; excludes temporary returns."""
import hashlib
import re

from sqlalchemy import or_

from app.models.conversation import Conversation
from app.models.context_continuation import ContextMemberObject, ContextBinding, ContinuationRevision, ContinuationState

CONTEXT_TABLES = {
    'context_member_objects': ContextMemberObject,
    'context_bindings': ContextBinding,
    'continuation_revisions': ContinuationRevision,
    'continuation_states': ContinuationState,
}


def context_table_models(models, manifest):
    from app.services.exporting.system_archive import SystemArchiveError
    version = manifest.get('context_files_version')
    if version is not None and (type(version) is not int or version != 1):
        raise SystemArchiveError('Unsupported Context archive extension.')
    return {**models, **(CONTEXT_TABLES if version is not None else {})}


def context_queries(db, conversations):
    ids = conversations.with_entities(Conversation.id)
    revisions = db.query(ContinuationRevision).filter(ContinuationRevision.conversation_id.in_(ids))
    return {
        'context_member_objects': db.query(ContextMemberObject).filter(or_(
            ContextMemberObject.sha256.in_(revisions.with_entities(ContinuationRevision.current_sha256)),
            ContextMemberObject.sha256.in_(revisions.with_entities(ContinuationRevision.index_sha256)),
        )).order_by(ContextMemberObject.sha256),
        'context_bindings': db.query(ContextBinding).filter(ContextBinding.conversation_id.in_(ids)).order_by(ContextBinding.id),
        'continuation_revisions': revisions.order_by(ContinuationRevision.created_at, ContinuationRevision.id),
        'continuation_states': db.query(ContinuationState).filter(ContinuationState.conversation_id.in_(ids)).order_by(ContinuationState.conversation_id),
    }


def read_context_object(archive, row):
    from app.services.exporting.system_archive import SystemArchiveError
    with archive.archive.open(row['archive_path']) as source:
        data = source.read(8 * 1024 * 1024 + 1)
    if len(data) != row['byte_size'] or hashlib.sha256(data).hexdigest() != row['sha256']:
        raise SystemArchiveError('Archived Context member failed integrity checks.')
    return data


def validate_context_archive(archive):
    from app.services.exporting.system_archive import SystemArchiveError
    from app.services.continuation_candidates import checked_members, ContinuationError
    if 'context_member_objects' not in archive.table_models:
        return set()
    objects = {row['sha256']: row for row in archive.rows('context_member_objects')}
    for digest, row in objects.items():
        if (not re.fullmatch('[0-9a-f]{64}', digest) or not 0 < row['byte_size'] <= 8 * 1024 * 1024
                or row.get('archive_path') != f'context/objects/{digest[:2]}/{digest}'):
            raise SystemArchiveError('Invalid archived Context member metadata.')
        read_context_object(archive, row)
        if archive.heartbeat: archive.heartbeat()
    revisions = {row['id']: row for row in archive.rows('continuation_revisions')}
    used = set()
    for row in revisions.values():
        members = {}
        for name in ('current', 'index'):
            digest = row.get(name + '_sha256')
            if digest:
                if digest not in objects:
                    raise SystemArchiveError('Archived Context member is missing.')
                used.add(digest)
                members[name] = read_context_object(archive, objects[digest])
        try:
            checked_members(members)
        except ContinuationError:
            raise SystemArchiveError('Archived Context file format is invalid.') from None
        parent = row.get('parent_id')
        if parent and (parent not in revisions or revisions[parent]['conversation_id'] != row['conversation_id']):
            raise SystemArchiveError('Archived Context history crosses conversations.')
        if archive.heartbeat: archive.heartbeat()
    if used != set(objects):
        raise SystemArchiveError('Archive contains unreferenced Context objects.')
    for row in archive.rows('continuation_states'):
        selected = row.get('adopted_revision_id')
        if selected and (selected not in revisions or revisions[selected]['conversation_id'] != row['conversation_id']):
            raise SystemArchiveError('Archived Context selection crosses conversations.')
    return {row['archive_path'] for row in objects.values()}


def restore_context(db, archive, target):
    from app.services.continuation_candidates import _store_member
    from app.services.exporting.system_archive import _decode_payload
    if 'context_member_objects' not in archive.table_models:
        return
    for row in archive.rows('context_member_objects'):
        _store_member(db, read_context_object(archive, row))
        if archive.heartbeat: archive.heartbeat()
    for name, model in CONTEXT_TABLES.items():
        if name == 'context_member_objects':
            continue
        for index, row in enumerate(archive.rows(name), start=1):
            decoded = _decode_payload(model, row)
            decoded['conversation_id'] = target('conversations', row['conversation_id'])
            if 'id' in row:
                decoded['id'] = target(name, row['id'])
            if name == 'continuation_revisions':
                decoded['parent_id'] = None
                # Local IDs changed; do not inherit former validation receipts.
                decoded['source_metadata'] = {'mode': 'direct_files', 'restored': True, 'system_validation': 'not_performed'}
                decoded['declared_trust'] = 'unverified'
            if name == 'continuation_states':
                decoded['adopted_revision_id'] = target('continuation_revisions', row.get('adopted_revision_id'))
            db.add(model(**decoded))
            if index % 250 == 0:
                db.flush()
                if archive.heartbeat: archive.heartbeat()
        db.flush()
        if name == 'continuation_revisions':
            for index, row in enumerate(archive.rows(name), start=1):
                if row.get('parent_id'):
                    db.get(ContinuationRevision, target(name, row['id'])).parent_id = target(name, row['parent_id'])
                if index % 250 == 0:
                    db.flush()
                    if archive.heartbeat: archive.heartbeat()
        db.flush()
