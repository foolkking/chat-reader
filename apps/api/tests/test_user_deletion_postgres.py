import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models.administration import AdminAuditLog, UserDeletionRequest
from app.models.annotation import AnnotationSyncReceipt
from app.models.attachment import AssetObject
from app.models.auth import AuthSession
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupRule, ContentCleanupRuleGrant, ContentCleanupRuleRevision
from app.models.conversation import Conversation
from app.models.import_profile import ImportProfile, ImportProfileGrant, ImportProfileRevision
from app.models.user import User
from app.models.user_preference import PreferenceSyncReceipt, UserPreference
from app.services.auth import ROOT_ADMIN_USER_ID, issue_session, register_user
from app.services.background_jobs import claim_next_job, process_background_job, retry_background_job
from app.services.user_deletion import queue_user_account_delete
from test_admin_system import _attachment, _conversation
from test_import_profile_postgres import isolated_schema, analysis_fixture  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_concurrent_confirmations_and_atomic_shared_account_deletion(isolated_schema, monkeypatch, tmp_path):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path))
    get_settings.cache_clear()
    from app.services.adaptive_import.analysis import default_mapping
    from app.services.adaptive_import.profiles import create_verified_revision
    from app.services.adaptive_import.profile_access import grant_revision
    with Session(engine) as db:
        root = db.get(User, ROOT_ADMIN_USER_ID)
        assert root is not None and root.role == "ADMIN"
        root.normalized_email = "delete-root@example.test"
        target, principal = register_user(db, "delete-target@example.test", "synthetic deletion passphrase")
        other = User(normalized_email="delete-other@example.test")
        db.add(other); db.flush()
        _, session = issue_session(db, principal, get_settings())
        target_id, other_id, session_id = target.id, other.id, session.id
        subject = str(target_id)
        db.add(UserPreference(subject_key=subject)); db.flush()
        db.add(PreferenceSyncReceipt(subject_key=subject, operation_id=uuid.uuid4(), request_hash="test", response={}))
        db.add(AnnotationSyncReceipt(subject_key=subject, operation_id=uuid.uuid4(), entity_type="annotation", entity_id=uuid.uuid4(), request_hash="test", response={}))
        analysis = analysis_fixture()
        profile, revision = create_verified_revision(db, analysis=analysis, mapping_spec=default_mapping(analysis),
            validation_spec={}, verification_summary={"valid": True, "group_count": 1}, name="Synthetic", owner_user_id=target_id)
        grant_revision(db, other_id, revision, reason="USED")
        profile_id, revision_id = profile.id, revision.id
        rule = ContentCleanupRule(owner_user_id=target_id, name="Synthetic noise", kind="LEARNED")
        db.add(rule); db.flush()
        rule_revision = ContentCleanupRuleRevision(rule_id=rule.id, revision=1, match_value="synthetic-marker", created_by_user_id=target_id)
        db.add(rule_revision); db.flush()
        db.add_all([ContentCleanupRuleGrant(user_id=uid, revision_id=rule_revision.id, reason="LEARNED") for uid in (target_id, other_id)])
        rule_id, rule_revision_id = rule.id, rule_revision.id
        sources = [_conversation(target_id, "Synthetic target"), _conversation(other_id, "Synthetic other")]
        db.add_all(sources); db.flush()
        shared = AssetObject(sha256="a" * 64, byte_size=1, detected_mime_type="text/plain", storage_key="objects/shared", storage_backend="local", status="available", scan_status="clean")
        exclusive = AssetObject(sha256="b" * 64, byte_size=1, detected_mime_type="text/plain", storage_key="objects/exclusive", storage_backend="local", status="available", scan_status="clean")
        db.add_all([shared, exclusive]); db.flush()
        shared_id, exclusive_id = shared.id, exclusive.id
        db.add_all([_attachment(sources[0].id, shared.id, "target-shared"), _attachment(sources[1].id, shared.id, "other-shared"),
                    _attachment(sources[0].id, exclusive.id, "target-exclusive")])
        db.commit()
    (tmp_path / "objects").mkdir()
    for name in ("shared", "exclusive"):
        (tmp_path / "objects" / name).write_bytes(b"x")
    barrier = Barrier(2)
    def queue(key):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            job, _ = queue_user_account_delete(db, actor_user_id=ROOT_ADMIN_USER_ID, target_user_id=target_id, idempotency_key=key)
            job_id = job.id; db.commit(); return job_id
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(queue, ["first-window", "second-window"]))
    assert ids[0] == ids[1]
    job_id = ids[0]
    with Session(engine) as db:
        assert db.get(AuthSession, session_id).revoked_at is not None
        assert db.get(User, target_id).status == "DISABLED"
        assert claim_next_job(db, job_type="user_account_delete") == job_id
        db.commit()
    from app.services import background_jobs
    real = background_jobs.execute_user_account_delete
    def fail_after_delete(*a, **kw):
        real(*a, **kw)
        raise RuntimeError("Synthetic transaction failure")
    monkeypatch.setattr(background_jobs, "execute_user_account_delete", fail_after_delete)
    process_background_job(job_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        assert db.get(BackgroundJob, job_id).status == "failed"
        assert db.get(User, target_id) is not None
        assert db.query(Conversation).count() == 2
        assert db.get(AssetObject, exclusive_id) is not None
        assert db.query(PreferenceSyncReceipt).count() == 1
        assert db.get(ImportProfile, profile_id).owner_user_id == target_id
        retry_background_job(db.get(BackgroundJob, job_id)); db.commit()
        assert db.query(UserDeletionRequest).one().status == "QUEUED"
        assert claim_next_job(db, job_type="user_account_delete") == job_id
        db.commit()
    assert (tmp_path / "objects" / "exclusive").is_file()
    monkeypatch.setattr(background_jobs, "execute_user_account_delete", real)
    from app.services import user_deletion
    real_cleanup = user_deletion.get_asset_store
    class UnavailableStore:
        def delete_key(self, key):
            raise RuntimeError("Synthetic storage backend failure")
    monkeypatch.setattr(user_deletion, "get_asset_store", lambda: UnavailableStore())
    process_background_job(job_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "committed", job.error_message
        assert db.get(User, target_id) is None
        assert db.get(User, other_id) is not None
        assert db.query(Conversation).count() == 1
        assert db.get(AssetObject, shared_id) is not None
        assert db.get(AssetObject, exclusive_id) is None
        assert db.query(PreferenceSyncReceipt).count() == db.query(AnnotationSyncReceipt).count() == db.query(UserPreference).filter_by(subject_key=subject).count() == 0
        assert db.get(ImportProfile, profile_id).owner_user_id is None
        assert db.get(ImportProfileRevision, revision_id).created_by_user_id is None
        assert db.get(ImportProfileGrant, (other_id, revision_id)) is not None
        assert db.get(ContentCleanupRule, rule_id).owner_user_id is None
        assert db.get(ContentCleanupRuleRevision, rule_revision_id).created_by_user_id is None
        assert db.get(ContentCleanupRuleGrant, (other_id, rule_revision_id)) is not None
        assert db.query(AdminAuditLog).filter_by(action="USER_DELETED", target_user_id=target_id).count() == 1
        assert job.result["preserved_shared_asset_objects"] == job.result["deleted_asset_objects"] == 1
        assert job.result["account_deleted"] is True
        assert job.result["asset_cleanup_status"] == "pending"
        assert job.result["asset_cleanup_pending"] == 1
        from app.api.routes.tasks import background_job_read
        assert "account_cleanup_keys" not in background_job_read(job).model_dump_json()
        retry_background_job(job); db.commit()
        assert db.query(UserDeletionRequest).one().status == "COMPLETED"
        assert claim_next_job(db, job_type="user_account_delete") == job_id
        db.commit()
    assert (tmp_path / "objects" / "exclusive").exists()
    monkeypatch.setattr(user_deletion, "get_asset_store", real_cleanup)
    cleanup = background_jobs.cleanup_deleted_account_assets
    def fail_after_cleanup_checkpoint(*args):
        cleanup(*args)
        raise RuntimeError("Synthetic post-commit bookkeeping failure")
    monkeypatch.setattr(background_jobs, "cleanup_deleted_account_assets", fail_after_cleanup_checkpoint)
    process_background_job(job_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "committed"
        assert job.result["asset_cleanup_status"] == "completed"
        assert job.result["asset_cleanup_pending"] == 0
        assert job.payload["account_cleanup_keys"] == []
        assert db.query(AdminAuditLog).filter_by(action="USER_DELETED", target_user_id=target_id).count() == 1
    assert (tmp_path / "objects" / "shared").is_file()
    assert not (tmp_path / "objects" / "exclusive").exists()
    get_settings.cache_clear()


def test_late_authenticated_subject_writes_cannot_resurrect_deleted_account(isolated_schema, monkeypatch):
    from threading import Event
    from fastapi import HTTPException
    from app.models.user_skill import UserSkill, UserSkillSelection
    from app.schemas.annotation import AnnotationSyncRequest
    from app.schemas.preferences import PreferenceSyncRequest
    from app.schemas.reading import ReadingPositionSyncRequest
    from app.models.reading_position import ReadingPositionSyncReceipt
    from app.services.reading.reading_service import sync_reading_position
    from app.services.annotations import sync_annotations
    from app.services.preferences import get_or_create_preferences, sync_preferences
    from app.services.skills import create_skill, update_selection
    from app.services.user_deletion import execute_user_account_delete

    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    writes = [
        lambda db, subject: get_or_create_preferences(db, subject),
        lambda db, subject: sync_preferences(db, PreferenceSyncRequest(operation_id=uuid.uuid4(),
            base_revisions={"theme_mode": 1}, changes={"theme_mode": "dark"}), subject),
        lambda db, subject: create_skill(db, category="EXPORT_CONTEXT", locale="en", name="Synthetic",
            content="Synthetic deletion-race fixture", subject_key=subject),
        lambda db, subject: update_selection(db, category="EXPORT_CONTEXT", locale="en", skill_id=None, subject_key=subject),
        lambda db, subject: sync_annotations(db, AnnotationSyncRequest(operations=[{
            "operation_id": uuid.uuid4(), "entity_type": "notebook", "entity_id": uuid.uuid4(),
            "action": "upsert", "conversation_id": uuid.uuid4(), "payload": {"title": "Synthetic", "blocks": []},
        }]), subject_key=subject),
        lambda db, subject: sync_reading_position(db, uuid.uuid4(), ReadingPositionSyncRequest(
            operation_id=uuid.uuid4(), base_revision=0, position={}), subject_key=subject),
    ]
    try:
        for index, write in enumerate(writes):
            with Session(engine) as db:
                target = User(normalized_email=f"late-{index}@example.test")
                db.add(target); db.flush(); target_id = target.id; db.commit()
            authenticated, deleted = Event(), Event()
            def late_request():
                with Session(engine) as db:
                    # Keep the old ACTIVE ORM identity in the request session.
                    user = db.get(User, target_id)
                    assert user.can_login
                    authenticated.set()
                    assert deleted.wait(timeout=15)
                    with pytest.raises(HTTPException) as error:
                        write(db, str(target_id))
                    assert error.value.status_code == 401
                    db.rollback()
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(late_request)
                try:
                    assert authenticated.wait(timeout=10)
                    with Session(engine) as db:
                        job, request = queue_user_account_delete(db, actor_user_id=ROOT_ADMIN_USER_ID,
                            target_user_id=target_id, idempotency_key=f"late-{index}")
                        db.commit()
                        execute_user_account_delete(db, job=job, target_user_id=target_id, deletion_request_id=request.id)
                        db.commit()
                finally:
                    deleted.set()
                future.result(timeout=15)
            with Session(engine) as db:
                assert db.get(User, target_id) is None
                for model in (UserPreference, PreferenceSyncReceipt, UserSkill, UserSkillSelection, AnnotationSyncReceipt, ReadingPositionSyncReceipt):
                    assert db.query(model).filter_by(subject_key=str(target_id)).count() == 0
    finally:
        get_settings.cache_clear()
