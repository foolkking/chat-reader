"""Real reference graph, rollback and worker retry for retained Context files."""
import pytest
from sqlalchemy.orm import sessionmaker
from app.models.background_job import BackgroundJob
from app.models.context_continuation import ContextMemberObject, ContinuationRevision, ContinuationState
from app.services.assets.asset_store import get_asset_store
from app.services.continuation_files import update_files
from app.services.context_cleanup import cleanup_context_objects, detach_conversation_context
from app.services.ownership import OwnershipScope
from app.services.background_jobs import claim_next_job, process_background_job, retry_background_job
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


def update(db, conversation, generation, text):
    result = update_files(db, conversation.id, OwnershipScope(conversation.owner_user_id),
        members={'current': text}, base_generation=generation)
    db.commit()
    return result


def test_retention_preserves_shared_members_and_rollback(archive_db):
    db = archive_db
    _, conversations, _, _ = seed_archive_source(db)
    first, second = conversations
    update(db, first, 0, b'shared')
    update(db, second, 0, b'shared')
    for generation in (1, 2):
        update(db, first, generation, f'unique-{generation}'.encode())
    old_keys = {obj.storage_key for obj in db.query(ContextMemberObject)}
    update_files(db, first.id, OwnershipScope(first.owner_user_id), members={'current': b'fourth'}, base_generation=3)
    db.rollback()
    assert db.query(ContinuationRevision).filter_by(conversation_id=first.id).count() == 3
    assert db.get(ContinuationState, first.id).generation == 3
    assert db.query(BackgroundJob).filter_by(job_type='context_object_cleanup').count() == 0
    assert all(get_asset_store().resolve_key(key).is_file() for key in old_keys)
    update(db, first, 3, b'fourth')
    assert db.query(BackgroundJob).filter_by(job_type='context_object_cleanup').count() == 0
    keys = detach_conversation_context(db, second.id)
    db.rollback()
    assert len(keys) == 1
    assert db.query(ContinuationRevision).filter_by(conversation_id=second.id).count() == 1
    update(db, first, 4, b'fifth')
    job = db.query(BackgroundJob).filter_by(job_type='context_object_cleanup').one()
    assert len(job.payload['keys']) == 1
    assert cleanup_context_objects(db, job.payload['keys'])['removed_files'] == 1
    assert cleanup_context_objects(db, job.payload['keys'])['removed_files'] == 1
    assert db.query(ContinuationRevision).filter_by(conversation_id=second.id).count() == 1
    current_keys = [obj.storage_key for obj in db.query(ContextMemberObject)]
    assert cleanup_context_objects(db, current_keys)['retained_files'] == len(current_keys)
    assert all(get_asset_store().resolve_key(key).is_file() for key in current_keys)
    with pytest.raises(ValueError, match='invalid resource'):
        cleanup_context_objects(db, ['skills/objects/unrelated'])


def test_cleanup_worker_failure_retry_preserves_current_files(archive_db, monkeypatch):
    db = archive_db
    _, conversations, _, _ = seed_archive_source(db)
    for generation in range(4):
        update(db, conversations[0], generation, f'file-{generation}'.encode())
    job = db.query(BackgroundJob).filter_by(job_type='context_object_cleanup').one()
    keys, job_id = job.payload['keys'], job.id
    assert claim_next_job(db, job_type='context_object_cleanup') == job_id
    db.commit()
    def fail(*_):
        raise OSError('private synthetic path should not be published')
    with monkeypatch.context() as patch:
        patch.setattr(type(get_asset_store()), 'delete_key', fail)
        process_background_job(job_id, session_factory=sessionmaker(bind=db.get_bind()))
    db.expire_all()
    job = db.get(BackgroundJob, job_id)
    assert job.status == 'failed'
    assert 'private synthetic' not in job.error_message
    assert db.query(ContinuationRevision).filter_by(conversation_id=conversations[0].id).count() == 3
    retry_background_job(job)
    db.commit()
    assert claim_next_job(db, job_type='context_object_cleanup') == job_id
    db.commit()
    process_background_job(job_id, session_factory=sessionmaker(bind=db.get_bind()))
    db.expire_all()
    assert db.get(BackgroundJob, job_id).status == 'committed'
    assert all(not get_asset_store().resolve_key(key, must_exist=False).exists() for key in keys)


def test_conversation_deletion_reclaims_only_unshared_context(archive_db):
    from app.models.conversation import Conversation
    from app.services.conversations.conversation_deletion import delete_conversation_record
    db = archive_db
    _, conversations, _, _ = seed_archive_source(db)
    first, second = conversations
    update(db, first, 0, b'shared')
    update(db, first, 1, b'private')
    update(db, second, 0, b'shared')
    first_id, second_id = first.id, second.id
    delete_conversation_record(db, first_id, OwnershipScope(first.owner_user_id))
    assert db.get(Conversation, first_id) is None
    assert db.query(ContinuationRevision).filter_by(conversation_id=first_id).count() == 0
    assert db.get(ContinuationState, first_id) is None
    assert db.query(ContinuationRevision).filter_by(conversation_id=second_id).count() == 1
    job = db.query(BackgroundJob).filter_by(job_type='context_object_cleanup').one()
    assert len(job.payload['keys']) == 1
    cleanup_context_objects(db, job.payload['keys'])
    assert all(get_asset_store().resolve_key(obj.storage_key).is_file() for obj in db.query(ContextMemberObject))
    assert all(not get_asset_store().resolve_key(key, must_exist=False).exists() for key in job.payload['keys'])


def test_account_deletion_preserves_shared_context_and_cleanup_receipts(archive_db):
    from app.models.user import User
    from app.services.user_deletion import queue_user_account_delete, execute_user_account_delete, cleanup_deleted_account_assets
    db = archive_db
    users, conversations, _, _ = seed_archive_source(db)
    target, admin = users
    admin.role = 'ADMIN'
    update(db, conversations[1], 0, b'shared')
    for generation, text in enumerate((b'old-orphan', b'shared', b'private', b'latest')):
        update(db, conversations[0], generation, text)
    old_job = db.query(BackgroundJob).filter_by(job_type='context_object_cleanup').one()
    target_id, admin_id, cleanup_id = target.id, admin.id, old_job.id
    deletion, request = queue_user_account_delete(db, actor_user_id=admin_id, target_user_id=target_id, idempotency_key='context-delete')
    db.commit()
    result, keys = execute_user_account_delete(db, job=deletion, target_user_id=target_id, deletion_request_id=request.id)
    deletion.status = 'committed'
    db.commit()
    assert result['account_deleted']
    assert db.get(User, target_id) is None
    assert db.get(BackgroundJob, cleanup_id).owner_user_id == admin_id
    assert db.query(ContinuationRevision).count() == 1
    cleanup_deleted_account_assets(db, deletion.id)
    db.commit()
    cleanup_context_objects(db, old_job.payload['keys'])
    assert all(not get_asset_store().resolve_key(key, must_exist=False).exists() for key in keys + old_job.payload['keys'])
    assert all(get_asset_store().resolve_key(obj.storage_key).is_file() for obj in db.query(ContextMemberObject))
