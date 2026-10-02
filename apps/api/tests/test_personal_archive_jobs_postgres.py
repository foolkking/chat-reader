import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy.orm import Session, sessionmaker

from app.models.archive_restore import ArchiveRestoreReceipt
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from app.services.background_jobs import claim_next_job, process_background_job, request_background_job_cancellation
from app.services.exporting.archive_jobs import queue_personal_restore, receive_personal_archive
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_personal_restore_postgres import personal_restore_target  # noqa: F401
from test_system_archive_integrity import archive_db  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def prepare(personal_restore_target):
    engine, path, digest, owner, _ = personal_restore_target
    with Session(engine) as db, path.open("rb") as source:
        preview = receive_personal_archive(db, source, owner=owner, key="pg-preview")
        preview_id = preview.id; db.commit()
        assert claim_next_job(db, job_type="personal_archive_preflight") == preview_id
        db.commit()
    process_background_job(preview_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        preview = db.get(BackgroundJob, preview_id)
        assert preview.status == "committed", preview.error_message
    return engine, owner, preview_id, digest


def test_postgres_preview_and_concurrent_confirmation_create_one_restore_job(personal_restore_target):
    engine, owner, preview_id, digest = prepare(personal_restore_target)
    barrier = Barrier(2)
    def confirm(_):
        with Session(engine) as db:
            barrier.wait(timeout=15)
            job = queue_personal_restore(db, owner=owner, preview_id=preview_id, expected_digest=digest)
            job_id = job.id; db.commit(); return job_id
    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(confirm, range(2)))
    assert ids[0] == ids[1]
    with Session(engine) as db:
        assert claim_next_job(db, job_type="personal_archive_restore") == ids[0]
        db.commit()
    process_background_job(ids[0], session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        job = db.get(BackgroundJob, ids[0])
        assert job.status == "committed", job.error_message
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 1
        assert db.query(ArchiveRestoreReceipt).count() == 1
        assert db.query(ExportArtifact).filter_by(scope_type="archive_upload").count() == 1


def test_postgres_cancellation_after_nested_restore_rolls_back_everything(personal_restore_target, monkeypatch):
    engine, owner, preview_id, digest = prepare(personal_restore_target)
    with Session(engine) as db:
        job = queue_personal_restore(db, owner=owner, preview_id=preview_id, expected_digest=digest)
        job_id = job.id; db.commit()
        assert claim_next_job(db, job_type="personal_archive_restore") == job_id
        db.commit()
    from app.services.exporting import archive_jobs
    real = archive_jobs.restore_personal_archive
    def cancel_after_restore(*args, **kwargs):
        result = real(*args, **kwargs)
        with Session(engine) as cancelling:
            request_background_job_cancellation(cancelling.get(BackgroundJob, job_id))
            cancelling.commit()
        return result
    monkeypatch.setattr(archive_jobs, "restore_personal_archive", cancel_after_restore)
    process_background_job(job_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        assert db.get(BackgroundJob, job_id).status == "cancelled"
        assert db.query(Conversation).count() == 0
        assert db.query(ArchiveRestoreReceipt).count() == 0
    from pathlib import Path
    from app.core.config import get_settings
    assert not [path for path in Path(get_settings().asset_storage_dir).rglob("*") if path.is_file()]


def test_postgres_disabled_owner_cannot_execute_already_queued_restore(personal_restore_target):
    engine, owner, preview_id, digest = prepare(personal_restore_target)
    with Session(engine) as db:
        job = queue_personal_restore(db, owner=owner, preview_id=preview_id, expected_digest=digest)
        job_id = job.id
        db.get(User, owner).status = "DISABLED"
        db.commit()
        assert claim_next_job(db, job_type="personal_archive_restore") == job_id
        db.commit()
    process_background_job(job_id, session_factory=sessionmaker(bind=engine))
    with Session(engine) as db:
        assert db.get(BackgroundJob, job_id).status == "failed"
        assert db.query(Conversation).count() == 0
