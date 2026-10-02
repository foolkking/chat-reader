"""System worker transactions, confirmation races and migration on PostgreSQL."""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event

import pytest
from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models.administration import SystemBackupRecord
from app.models.archive_restore import ArchiveRestoreAccount, ArchiveRestoreReceipt
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.user import User
from app.models.administration import AdminAuditLog
from app.services.background_jobs import claim_next_job, process_background_job, request_background_job_cancellation
from app.services.exporting.system_archive_jobs import receive_system_archive, ownership_revision, queue_system_restore
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_configuration import configuration_source
from test_system_archive_integrity import archive_db  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


@pytest.fixture
def system_restore_target(archive_db, isolated_schema, tmp_path, monkeypatch):
    path, _ = configuration_source(archive_db)
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "restore-assets"))
    get_settings.cache_clear()
    with Session(engine) as db, path.open("rb") as source:
        owner = db.query(User).filter_by(role="ADMIN").one().id
        preview = receive_system_archive(db, source, owner=owner, key="pg-system-preview")
        preview_id = preview.id
        db.commit()
        assert claim_next_job(db, job_type="system_archive_preflight") == preview_id
        db.commit()
    process_background_job(preview_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        preview = db.get(BackgroundJob, preview_id)
        assert preview.status == "committed", preview.error_message
        digest, revision = preview.result["content_digest"], ownership_revision(db, preview_id)
    return engine, owner, preview_id, digest, revision


def test_system_restore_concurrent_confirmation_and_real_worker(system_restore_target):
    engine, owner, preview_id, digest, revision = system_restore_target
    barrier = Barrier(2)
    def confirm(_):
        with Session(engine) as db:
            barrier.wait(timeout=15)
            job = queue_system_restore(db, owner=owner, preview_id=preview_id, expected_digest=digest, base_revision=revision)
            job_id = job.id
            db.commit()
            return job_id
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(confirm, range(2)))
    assert ids[0] == ids[1]
    with Session(engine) as db:
        assert claim_next_job(db, job_type="system_archive_restore") == ids[0]
        db.commit()
    process_background_job(ids[0], session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, ids[0])
        assert job.status == "committed", job.error_message
        assert db.query(Conversation).count() == 2
        assert db.query(ArchiveRestoreReceipt).count() == 1
        assert db.query(ArchiveRestoreAccount).count() == 2
        assert db.query(SystemBackupRecord).one().status == "COMPLETED"
        assert db.query(AdminAuditLog).filter_by(action="SYSTEM_RESTORE_COMPLETED").count() == 1


def test_late_system_restore_cancellation_rolls_back_identity_configuration_and_files(system_restore_target, monkeypatch):
    engine, owner, preview_id, digest, revision = system_restore_target
    with Session(engine) as db:
        job = queue_system_restore(db, owner=owner, preview_id=preview_id, expected_digest=digest, base_revision=revision)
        job_id = job.id
        db.commit()
        assert claim_next_job(db, job_type="system_archive_restore") == job_id
        db.commit()
    from app.services.exporting import system_archive_jobs
    real_restore = system_archive_jobs.restore_system_archive
    def late_cancel(*args, **kwargs):
        result = real_restore(*args, **kwargs)
        with Session(engine) as cancelling:
            request_background_job_cancellation(cancelling.get(BackgroundJob, job_id))
            cancelling.commit()
        return result
    monkeypatch.setattr(system_archive_jobs, "restore_system_archive", late_cancel)
    process_background_job(job_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        assert db.get(BackgroundJob, job_id).status == "cancelled"
        assert db.query(User).count() == 1
        assert db.query(Conversation).count() == db.query(ArchiveRestoreReceipt).count() == 0
        assert db.query(SystemBackupRecord).one().status == "CANCELLED"
        assert db.query(ArchiveRestoreAccount).count() == 2  # Review remains resumable.
    assert not [path for path in Path(get_settings().asset_storage_dir).rglob("*") if path.is_file()]


def test_system_archive_choice_migration_round_trip(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    assert "archive_restore_accounts" in inspect(engine).get_table_names()

    migrate("20261001_0041", "downgrade")
    assert "archive_restore_accounts" not in inspect(engine).get_table_names()
    assert "archive_restore_receipts" in inspect(engine).get_table_names()
    migrate("head")
    assert "archive_restore_accounts" in inspect(engine).get_table_names()


def test_system_export_concurrent_request_is_idempotent(system_restore_target):
    from app.services.background_jobs import queue_system_archive_export
    from app.services.exporting.system_archive import SystemArchiveError
    from app.services.ownership import OwnershipScope
    engine, owner, *_ = system_restore_target
    barrier = Barrier(2)
    def queue(_):
        with Session(engine) as db:
            barrier.wait(timeout=10)
            job = queue_system_archive_export(db, include_archived=True, idempotency_key="concurrent-export",
                ownership_scope=OwnershipScope(owner))
            identity = job.id
            db.commit()
            return identity
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(queue, range(2)))
    assert ids[0] == ids[1]
    with Session(engine) as db:
        assert db.query(BackgroundJob).filter_by(job_type="system_archive_export").count() == 1
        with pytest.raises(SystemArchiveError, match="different backup options"):
            queue_system_archive_export(db, include_archived=False, idempotency_key="concurrent-export", ownership_scope=OwnershipScope(owner))


def test_restore_waits_for_preferences_without_inverting_table_lock_order(system_restore_target):
    import hashlib
    from app.services.preferences import _lock, update_preferences
    from app.schemas.preferences import UserPreferenceUpdate
    engine, owner, preview_id, digest, revision = system_restore_target
    with Session(engine) as db:
        job = queue_system_restore(db, owner=owner, preview_id=preview_id, expected_digest=digest, base_revision=revision)
        job_id = job.id
        db.commit()
        assert claim_next_job(db, job_type="system_archive_restore") == job_id
        db.commit()
    waiting = Event()
    lock_key = int.from_bytes(hashlib.sha256(f"user-preferences:{owner}".encode()).digest()[:8], "big", signed=True)
    def observe(_conn, _cursor, statement, params, *_):
        if "pg_advisory_xact_lock" in statement and isinstance(params, dict) and params.get("key") == lock_key:
            waiting.set()
    with Session(engine) as editor:
        _lock(editor, str(owner))
        event.listen(engine, "before_cursor_execute", observe)
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(process_background_job, job_id, session_factory=sessionmaker(bind=engine))
                try:
                    assert waiting.wait(timeout=10)
                    editor.execute(text("SET LOCAL statement_timeout = '5s'"))
                    update_preferences(editor, UserPreferenceUpdate(theme_mode="dark"), str(owner))
                    editor.commit()
                finally:
                    editor.rollback()
                future.result(timeout=20)
        finally:
            event.remove(engine, "before_cursor_execute", observe)
    with Session(engine) as db:
        assert db.get(BackgroundJob, job_id).status == "committed"
        assert db.query(Conversation).count() == 2
