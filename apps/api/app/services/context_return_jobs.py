"""Expiring whole-package upload tasks using existing private artifact storage."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import hashlib
import uuid

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.services.assets.asset_store import LocalAssetStore
from app.services.continuation_candidates import ContinuationError, owned_conversation
from app.services.exporting.archive_transaction import track_archive_object

UPLOAD_FORMAT = 'context-return-upload'


def receive_context_return(db, source, conversation_id, scope, *, base_generation, idempotency_key):
    owned_conversation(db, conversation_id, scope)
    store = LocalAssetStore(Path(get_settings().export_storage_dir))
    try:
        staged = store.stage(source, max_bytes=get_settings().bundle_max_compressed_bytes)
    except ValueError:
        raise ContinuationError('CONTEXT_RETURN_TOO_LARGE', 413) from None
    try:
        if not staged.byte_size:
            raise ContinuationError('CONTEXT_RETURN_INVALID')
        owned_conversation(db, conversation_id, scope, lock=True)
        key = f'context-return:{conversation_id}:{idempotency_key}'
        existing = db.query(BackgroundJob).filter_by(owner_user_id=scope.owner_user_id, job_type='context_return', idempotency_key=key).first()
        if existing:
            if existing.payload.get('sha256') != staged.sha256 or existing.payload.get('base_generation') != base_generation:
                raise ContinuationError('CONTEXT_IDEMPOTENCY_CONFLICT', 409)
            return existing
        job = BackgroundJob(owner_user_id=scope.owner_user_id, job_type='context_return', status='queued', phase='queued',
                            idempotency_key=key, total_items=1, result={},
                            payload={'conversation_id': str(conversation_id), 'base_generation': base_generation, 'sha256': staged.sha256})
        db.add(job)
        db.flush()
        storage_key = f'{job.id}/return.context.zip'
        track_archive_object(db, store, storage_key)
        path = store.promote(staged.path, storage_key)
        db.add(ExportArtifact(job_id=job.id, conversation_id=conversation_id, scope_type='archive_upload',
                              format=UPLOAD_FORMAT, filename='return.context.zip', storage_uri=str(path),
                              sha256=staged.sha256, byte_size=staged.byte_size,
                              expires_at=datetime.now(timezone.utc) + timedelta(hours=24)))
        db.flush()
        return job
    finally:
        staged.path.unlink(missing_ok=True)


def process_context_return(db, job, scope, report):
    from app.services.continuation_files import update_files
    from app.services.context_return import extract_direct_files
    artifact = db.query(ExportArtifact).filter_by(job_id=job.id, format=UPLOAD_FORMAT, scope_type='archive_upload').one_or_none()
    if artifact is None:
        raise ContinuationError('CONTEXT_RETURN_EXPIRED', 410)
    expiry = artifact.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= datetime.now(timezone.utc):
        raise ContinuationError('CONTEXT_RETURN_EXPIRED', 410)
    path = Path(artifact.storage_uri).resolve()
    root = Path(get_settings().export_storage_dir).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ContinuationError('CONTEXT_RETURN_UNAVAILABLE', 409)
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024**2), b''):
            digest.update(chunk)
    if digest.hexdigest() != artifact.sha256:
        raise ContinuationError('CONTEXT_RETURN_INVALID')
    report('reading_members', 30, 0, 1)
    members = extract_direct_files(path)
    report('saving_files', 80, 0, 1)
    item, state = update_files(db, uuid.UUID(job.payload['conversation_id']), scope,
        members=members, base_generation=job.payload['base_generation'])
    db.delete(artifact)
    return {'revision_id': str(item.id), 'generation': state.generation,
            'updated_members': sorted(members), 'next_action': 'view_files'}, path



def expire_context_returns(db, *, limit=25):
    """Only expired temporary uploads; active workers retain their input lease."""
    rows = db.query(ExportArtifact).join(BackgroundJob, BackgroundJob.id == ExportArtifact.job_id).filter(
        ExportArtifact.format == UPLOAD_FORMAT, ExportArtifact.expires_at <= datetime.now(timezone.utc),
        BackgroundJob.status.notin_(['processing', 'cancelling'])).order_by(ExportArtifact.expires_at).limit(limit).with_for_update(of=ExportArtifact, skip_locked=True).all()
    paths = []
    for artifact in rows:
        paths.append(Path(artifact.storage_uri))
        db.delete(artifact)
    return paths
