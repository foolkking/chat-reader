"""Real chunk/cancel races; cancellation must not publish partial READY output."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from datetime import datetime, timedelta, timezone
import pytest
from sqlalchemy.orm import Session, sessionmaker
from app.models.background_job import BackgroundJob
from app.models.content_cleanup import ContentCleanupScan, ContentCleanupOccurrence
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services import background_jobs
from app.services.content_cleanup import create_scan, apply_scan
from app.services.editing.message_edit_service import create_manual_conversation
from app.services.ownership import OwnershipScope
from app.services.cleanup_scan_state import scan_status
from app.api.routes.tasks import cancel_task
from test_cleanup_postgres import isolated_schema, pytestmark  # noqa: F401


def seed(engine):
    with Session(engine) as db:
        user = User(normalized_email="scan-lifecycle@example.test")
        db.add(user); db.flush()
        scope = OwnershipScope(user.id)
        conversation = create_manual_conversation(db, title="Synthetic scan lifecycle", user_text="Question",
            assistant_text="Before cite turn12search4 after.", ownership_scope=scope)
        scan, job = create_scan(db, source="BATCH", scope_type="CURRENT_CONVERSATION", conversation_ids=[conversation.conversation.id], ownership_scope=scope)
        db.commit()
        return scan.id, job.id, conversation.messages[1].id, scope


@pytest.mark.parametrize("final_chunk", [False, True])
def test_cancellation_wins_chunk_requeue_or_final_publication(isolated_schema, monkeypatch, final_chunk):
    engine, migrate = isolated_schema; migrate("head")
    scan_id, job_id, message_id, scope = seed(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    def claim():
        with Session(engine) as db:
            db.get(BackgroundJob, job_id).status = "processing"; db.commit()
    if final_chunk:
        claim(); background_jobs.process_background_job(job_id, factory)
    claim()
    reached, release = Event(), Event()
    original = background_jobs.process_scan_chunk
    def held(db, scan):
        result = original(db, scan)
        assert result["done"] is final_chunk
        reached.set(); assert release.wait(15)
        return result
    monkeypatch.setattr(background_jobs, "process_scan_chunk", held)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(background_jobs.process_background_job, job_id, factory)
        try:
            assert reached.wait(15)
            with Session(engine) as db:
                assert cancel_task(job_id, db, scope).status == "cancelling"
        finally:
            release.set()
        future.result(timeout=20)
    with Session(engine) as db:
        scan, job = db.get(ContentCleanupScan, scan_id), db.get(BackgroundJob, job_id)
        assert job.status == "cancelled" and scan_status(scan, job) == "CANCELLED"
        assert scan.status != "READY" and scan.processed_messages == (2 if final_chunk else 0)
        assert db.query(ContentCleanupOccurrence).filter_by(scan_id=scan_id, decision="DELETE").count() == 0
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 1
        with pytest.raises(ValueError):
            apply_scan(db, scan_id)
    background_jobs.process_background_job(job_id, factory)
    with Session(engine) as db:
        assert db.get(BackgroundJob, job_id).status == "cancelled"


def test_completed_scan_wins_before_cancellation(isolated_schema):
    engine, migrate = isolated_schema; migrate("head")
    scan_id, job_id, message_id, scope = seed(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    for _ in range(2):
        with Session(engine) as db:
            db.get(BackgroundJob, job_id).status = "processing"; db.commit()
        background_jobs.process_background_job(job_id, factory)
    with Session(engine) as db:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as error:
            cancel_task(job_id, db, scope)
        assert error.value.status_code == 409
        assert db.get(BackgroundJob, job_id).status == "committed"
        assert db.get(ContentCleanupScan, scan_id).status == "READY"
        assert db.query(MessageVersion).filter_by(message_id=message_id).count() == 1


def test_stopped_worker_finishes_cancellation_without_restart(isolated_schema):
    engine, migrate = isolated_schema; migrate("head")
    scan_id, job_id, _, scope = seed(engine)
    with Session(engine) as db:
        job = db.get(BackgroundJob, job_id); job.status = "processing"; db.commit()
        assert cancel_task(job_id, db, scope).status == "cancelling"
        job.heartbeat_at = datetime.now(timezone.utc) - timedelta(hours=1); db.commit()
        assert background_jobs.recover_stale_jobs(db, 60) == 1; db.commit()
        assert job.status == "cancelled" and scan_status(db.get(ContentCleanupScan, scan_id), job) == "CANCELLED"
