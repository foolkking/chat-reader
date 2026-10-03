"""Shared objects survive logical deletion; physical cleanup is durable and retryable."""
import pytest
from sqlalchemy.orm import sessionmaker

from app.models.background_job import BackgroundJob
from app.models.skill_bundle import SkillFileObject, SkillBundleRevision
from app.models.user_skill import UserSkill
from app.services.assets.asset_store import get_asset_store
from app.services.skill_cleanup import detach_skill_history, queue_skill_cleanup, cleanup_skill_objects
from app.services.background_jobs import claim_next_job, process_background_job, retry_background_job
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401
from test_skill_bundle_archives import add_skill, script_bytes


def test_shared_members_survive_delete_and_rollback(archive_db):
    db = archive_db
    users, _, _, _ = seed_archive_source(db)
    first = add_skill(db, users[0].id, b'first-only')
    second = add_skill(db, users[1].id, b'second-only')
    db.commit()
    before = {row.storage_key for row in db.query(SkillFileObject)}
    keys = detach_skill_history(db, first)
    assert len(keys) == 1
    queue_skill_cleanup(db, keys, owner_user_id=users[0].id)
    db.delete(first); db.flush()
    assert all(get_asset_store().resolve_key(key).is_file() for key in before)
    db.rollback()
    assert {row.storage_key for row in db.query(SkillFileObject)} == before
    assert script_bytes(db, first, 1) == b'first-only'
    assert db.query(BackgroundJob).filter_by(job_type='skill_object_cleanup').count() == 0
    keys = detach_skill_history(db, first)
    queued = queue_skill_cleanup(db, keys, owner_user_id=users[0].id)
    db.delete(first); db.commit()
    assert script_bytes(db, second, 1) == b'second-only'
    assert db.query(SkillBundleRevision).filter_by(user_skill_id=first.id).count() == 0
    assert all(get_asset_store().resolve_key(key).is_file() for key in keys)
    assert cleanup_skill_objects(db, queued.payload['keys']) == {'removed_files': 1, 'retained_files': 0}
    assert cleanup_skill_objects(db, queued.payload['keys']) == {'removed_files': 1, 'retained_files': 0}
    assert script_bytes(db, second, 1) == b'second-only'
    assert all(not get_asset_store().resolve_key(key, must_exist=False).exists() for key in keys)


def test_worker_cleanup_failure_and_retry_do_not_repeat_logical_delete(archive_db, monkeypatch):
    db = archive_db
    users, _, _, _ = seed_archive_source(db)
    item = add_skill(db, users[0].id, b'task-file')
    db.commit()
    keys = detach_skill_history(db, item)
    job = queue_skill_cleanup(db, keys, owner_user_id=users[0].id)
    db.delete(item); db.commit()
    job_id = job.id
    assert claim_next_job(db, job_type='skill_object_cleanup') == job_id
    db.commit()
    store = get_asset_store()
    def failure(_key):
        raise OSError('synthetic private path must not enter task error')
    with monkeypatch.context() as patch:
        patch.setattr(type(store), 'delete_key', lambda _self, key: failure(key))
        process_background_job(job_id, session_factory=sessionmaker(bind=db.get_bind()))
    db.expire_all()
    job = db.get(BackgroundJob, job_id)
    assert job.status == 'failed'
    assert 'synthetic private' not in job.error_message
    assert db.get(UserSkill, item.id) is None
    retry_background_job(job); db.commit()
    assert claim_next_job(db, job_type='skill_object_cleanup') == job_id
    db.commit()
    process_background_job(job_id, session_factory=sessionmaker(bind=db.get_bind()))
    db.expire_all()
    job = db.get(BackgroundJob, job_id)
    assert job.status == 'committed', job.error_message
    assert job.result['removed_files'] == len(keys)
    assert all(not store.resolve_key(key, must_exist=False).exists() for key in keys)


def test_cleanup_refuses_to_remove_referenced_or_unrelated_files(archive_db):
    db = archive_db
    users, _, _, _ = seed_archive_source(db)
    item = add_skill(db, users[0].id, b'keep-me')
    db.commit()
    keys = [row.storage_key for row in db.query(SkillFileObject)]
    assert cleanup_skill_objects(db, keys)['retained_files'] == len(keys)
    assert script_bytes(db, item, 1) == b'keep-me'
    with pytest.raises(ValueError, match='invalid resource'):
        cleanup_skill_objects(db, ['objects/unrelated'])


def test_account_deletion_preserves_shared_members_and_pending_cleanup(archive_db):
    from app.models.user import User
    from app.services.user_deletion import queue_user_account_delete, execute_user_account_delete, cleanup_deleted_account_assets
    db = archive_db
    users, _, _, _ = seed_archive_source(db)
    target, admin = users
    admin.role = 'ADMIN'
    retired = add_skill(db, target.id, b'previously-deleted')
    active = add_skill(db, target.id, b'shared-with-admin')
    survivor = add_skill(db, admin.id, b'shared-with-admin')
    exclusive = add_skill(db, target.id, b'account-only')
    db.commit()
    retired_keys = detach_skill_history(db, retired)
    old_cleanup = queue_skill_cleanup(db, retired_keys, owner_user_id=target.id)
    db.delete(retired); db.commit()
    target_id, admin_id, cleanup_id = target.id, admin.id, old_cleanup.id
    deletion, request = queue_user_account_delete(db, actor_user_id=admin_id, target_user_id=target_id, idempotency_key='bundle-account-delete')
    db.commit()
    result, keys = execute_user_account_delete(db, job=deletion, target_user_id=target_id, deletion_request_id=request.id)
    deletion.status = 'committed'
    db.commit()
    db.expire_all()
    assert result['account_deleted']
    assert db.get(User, target_id) is None
    assert db.get(BackgroundJob, cleanup_id).owner_user_id == admin_id
    assert db.query(SkillBundleRevision).filter(SkillBundleRevision.user_skill_id.in_([active.id, exclusive.id])).count() == 0
    assert script_bytes(db, survivor, 1) == b'shared-with-admin'
    cleanup_deleted_account_assets(db, deletion.id)
    db.commit()
    cleanup_skill_objects(db, retired_keys)
    assert script_bytes(db, survivor, 1) == b'shared-with-admin'
    assert all(not get_asset_store().resolve_key(key, must_exist=False).exists() for key in keys + retired_keys)
