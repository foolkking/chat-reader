"""Transactional Context reference removal and durable private-file reclamation."""
from sqlalchemy import or_
from app.models.background_job import BackgroundJob
from app.models.context_continuation import (ContextMemberObject, ContinuationRevision,
    ContinuationCandidate, ContinuationValidation, ContinuationState, ContextBinding, ContextExportReceipt)
from app.services.assets.asset_store import get_asset_store


def reclaim_context_objects(db, hashes):
    keys = []
    ordered = sorted(set(hashes) - {None})
    for start in range(0, len(ordered), 250):
        objects = db.query(ContextMemberObject).filter(ContextMemberObject.sha256.in_(ordered[start:start + 250])).order_by(
            ContextMemberObject.sha256).with_for_update().all()
        for obj in objects:
            if db.query(ContinuationRevision.id).filter(or_(ContinuationRevision.current_sha256 == obj.sha256,
                    ContinuationRevision.index_sha256 == obj.sha256)).first() is not None:
                continue
            if db.query(ContinuationCandidate.id).filter(or_(ContinuationCandidate.current_sha256 == obj.sha256,
                    ContinuationCandidate.index_sha256 == obj.sha256, ContinuationCandidate.manifest_sha256 == obj.sha256)).first() is not None:
                continue
            keys.append(obj.storage_key)
            db.delete(obj)
        db.flush()
    return keys


def queue_context_cleanup(db, keys, *, owner_user_id):
    if not keys:
        return None
    unique = list(dict.fromkeys(keys))
    job = BackgroundJob(owner_user_id=owner_user_id, job_type='context_object_cleanup', status='queued', phase='queued',
                        total_items=len(unique), payload={'keys': unique}, result={})
    db.add(job)
    db.flush()
    return job


def cleanup_context_objects(db, keys, *, progress=None):
    removed, retained = 0, 0
    for index, key in enumerate(keys):
        if (not isinstance(key, str) or not key.startswith('context/') or '\\' in key
                or any(part in {'', '.', '..'} for part in key.split('/'))):
            raise ValueError('Context cleanup contains an invalid resource reference.')
        if db.query(ContextMemberObject.sha256).filter_by(storage_key=key).first() is not None:
            retained += 1
        else:
            try:
                get_asset_store().delete_key(key)
            except Exception:
                raise ValueError('Context file cleanup failed; retry the task.') from None
            removed += 1
        if progress and (index % 50 == 0 or index + 1 == len(keys)):
            progress('cleaning_context_files', min(99, int((index + 1) * 99 / max(1, len(keys)))), index + 1, len(keys))
    return {'removed_files': removed, 'retained_files': retained}


def detach_conversation_context(db, conversation_id):
    """Caller holds the conversation lock; works with and without FK cascades."""
    hashes = set()
    for model, columns in ((ContinuationRevision, ('current_sha256', 'index_sha256')),
                           (ContinuationCandidate, ('current_sha256', 'index_sha256', 'manifest_sha256'))):
        for row in db.query(*(getattr(model, col) for col in columns)).filter(model.conversation_id == conversation_id).yield_per(250):
            hashes.update(row)
    candidate_ids = db.query(ContinuationCandidate.id).filter_by(conversation_id=conversation_id)
    db.query(ContinuationValidation).filter(ContinuationValidation.candidate_id.in_(candidate_ids)).delete(synchronize_session=False)
    db.query(ContinuationCandidate).filter_by(conversation_id=conversation_id).delete(synchronize_session=False)
    db.query(ContinuationState).filter_by(conversation_id=conversation_id).delete(synchronize_session=False)
    db.query(ContinuationRevision).filter_by(conversation_id=conversation_id).update({'parent_id': None}, synchronize_session=False)
    for model in (ContinuationRevision, ContextBinding, ContextExportReceipt):
        db.query(model).filter_by(conversation_id=conversation_id).delete(synchronize_session=False)
    db.flush()
    return reclaim_context_objects(db, hashes)
