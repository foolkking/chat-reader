"""Actual retry/reclamation row locks, including a retry holding stale ORM state."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from threading import Event
from time import monotonic, sleep

import pytest
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from app.services import export_retention
from app.services.background_jobs import retry_background_job
from app.services.context_return_jobs import receive_context_return
from app.services.editing.message_edit_service import MessageEditError
from app.services.ownership import OwnershipScope
from test_context_return_postgres import isolated_schema, pytestmark  # noqa: F401


@pytest.fixture
def retained_input(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    root = tmp_path / "exports"
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(root))
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        with factory() as db:
            owner = User(normalized_email="synthetic-recovery-race@example.test")
            db.add(owner); db.flush()
            conversation = Conversation(owner_user_id=owner.id, title="Synthetic recovery",
                display_title="Synthetic recovery", source_type="synthetic", source_profile="synthetic",
                parser_version="test")
            db.add(conversation); db.flush()
            job = receive_context_return(db, BytesIO(b"Synthetic retained input"),
                conversation.id, OwnershipScope(owner.id), base_generation=0, idempotency_key="race")
            job.status = job.phase = "failed"
            job.error_message = "CONTEXT_RETURN_FAILED"
            job.attempt_count = 2
            job.completed_at = datetime.now(timezone.utc)
            db.commit()
            artifact = db.query(ExportArtifact).filter_by(job_id=job.id).one()
            yield factory, root, job.id, artifact.id, Path(artifact.storage_uri)
    finally:
        get_settings.cache_clear()


def test_retry_holds_job_lock_against_expiry_cleanup(retained_input):
    factory, root, job_id, artifact_id, path = retained_input
    # A valid retry is admitted at the real time; maintenance observes the
    # later deadline while the admission transaction remains uncommitted.
    later = datetime.now(timezone.utc) + timedelta(days=2)
    with factory() as retrying:
        job = retrying.get(BackgroundJob, job_id)
        retry_background_job(job)
        with ThreadPoolExecutor(max_workers=1) as pool:
            outcome = pool.submit(export_retention.reclaim_exports, factory, root, now=later).result(timeout=5)
        assert outcome["reclaimed"] == 0 and path.is_file()
        retrying.commit()
    # Expiry is still absolute: retry never extended it.
    assert export_retention.reclaim_exports(factory, root, now=later)["reclaimed"] == 1
    with factory() as db:
        assert db.get(ExportArtifact, artifact_id) is None
        assert db.get(BackgroundJob, job_id).status == "queued"


def test_cleanup_wins_and_waiting_retry_rechecks_deleted_receipt(retained_input, monkeypatch):
    factory, root, job_id, artifact_id, path = retained_input
    with factory() as db:
        artifact = db.get(ExportArtifact, artifact_id)
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    reached, release, retry_ready = Event(), Event(), Event()
    safe_file = export_retention._safe_file

    def held(*args):
        result = safe_file(*args)
        reached.set()
        assert release.wait(10)
        return result

    def retry():
        with factory() as db:
            db.execute(text("SET LOCAL application_name = 'synthetic-context-retry-race'"))
            job = db.get(BackgroundJob, job_id)
            retry_ready.set()
            with pytest.raises(MessageEditError) as error:
                retry_background_job(job)
            assert error.value.status_code == 410
            assert str(error.value) == "CONTEXT_RETURN_EXPIRED"
            db.rollback()

    monkeypatch.setattr(export_retention, "_safe_file", held)
    with ThreadPoolExecutor(max_workers=2) as pool:
        cleanup = pool.submit(export_retention.reclaim_exports, factory, root)
        try:
            assert reached.wait(5)
            retrying = pool.submit(retry)
            assert retry_ready.wait(5)
            deadline, blocked = monotonic() + 5, False
            while monotonic() < deadline:
                with factory() as db:
                    blocked = db.execute(text("""SELECT EXISTS (
                        SELECT 1 FROM pg_stat_activity
                        WHERE application_name = 'synthetic-context-retry-race'
                          AND cardinality(pg_blocking_pids(pid)) > 0)""")).scalar_one()
                if blocked:
                    break
                sleep(0.01)
            assert blocked, "Retry must actually contend with the maintenance job lock"
        finally:
            release.set()
        assert cleanup.result(timeout=5)["reclaimed"] == 1
        retrying.result(timeout=5)
    assert not path.exists()
    with factory() as db:
        assert db.get(ExportArtifact, artifact_id) is None
        job = db.get(BackgroundJob, job_id)
        assert job.status == "failed" and job.attempt_count == 2 and job.completed_at is not None


def test_late_retry_cannot_requeue_a_now_committed_task(retained_input):
    factory, _, job_id, _, _ = retained_input
    with factory() as stale:
        job = stale.get(BackgroundJob, job_id)
        assert job.status == "failed"
        with factory() as winner:
            confirmed = winner.get(BackgroundJob, job_id)
            confirmed.status = "committed"
            confirmed.result = {"generation": 1}
            winner.commit()
        retry_background_job(job)
        stale.commit()
        assert job.status == "committed" and job.result == {"generation": 1}
