"""Cancellation and unstarted-claim compensation on a disposable PostgreSQL."""
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from sqlalchemy import event, text
from sqlalchemy.orm import sessionmaker

from app.models.background_job import BackgroundJob
from app.models.user import User
from app.services.background_jobs import claim_next_job, request_background_job_cancellation
from app.services.task_worker import _requeue_unstarted_task
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


@pytest.fixture
def claimed_job(isolated_schema, request):
    engine, migrate = isolated_schema
    migrate("head")
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with factory() as db:
        now = datetime.now(timezone.utc)
        owner = User(normalized_email="worker-requeue@example.test")
        db.add(owner)
        db.flush()
        job = BackgroundJob(
            owner_user_id=owner.id,
            job_type=request.param,
            status="processing",
            phase="validating",
            started_at=now,
            heartbeat_at=now,
            attempt_count=2,
            payload={},
        )
        db.add(job)
        db.commit()
        task_id = job.id
    return engine, factory, task_id


@pytest.mark.parametrize("claimed_job", ["conversation_merge", "content_noise_scan"], indirect=True)
def test_requeue_rechecks_processing_after_waiting_for_a_cancellation_lock(claimed_job):
    engine, factory, task_id = claimed_job
    attempting = threading.Event()
    worker_pid = []

    def before_compensation_update(connection, cursor, statement, parameters, context, executemany):
        if not context.isupdate:
            return
        # Bound failures as well as successful lock acquisition. These settings
        # apply only to the disposable worker transaction.
        connection.exec_driver_sql("SET LOCAL lock_timeout = '8s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout = '10s'")
        worker_pid.append(connection.connection.driver_connection.info.backend_pid)
        attempting.set()

    with ThreadPoolExecutor(max_workers=1) as executor:
        with factory() as canceller:
            job = canceller.query(BackgroundJob).filter_by(id=task_id).with_for_update().one()
            request_background_job_cancellation(job)
            canceller.flush()
            expected = {column.name: getattr(job, column.name) for column in BackgroundJob.__table__.columns}
            event.listen(engine, "before_cursor_execute", before_compensation_update)
            try:
                future = executor.submit(_requeue_unstarted_task, "job", task_id, factory)
                assert attempting.wait(timeout=10)
                deadline = time.monotonic() + 5
                blocked = False
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    while time.monotonic() < deadline:
                        blocked = observer.execute(
                            text("SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid = :pid"),
                            {"pid": worker_pid[0]},
                        ).scalar() is True
                        if blocked:
                            break
                        if future.done():
                            future.result()
                            pytest.fail("Compensation did not wait for the cancellation row lock.")
                        time.sleep(0.01)
                assert blocked, "PostgreSQL did not report the expected row-lock wait."
                canceller.commit()
                future.result(timeout=10)
            finally:
                canceller.rollback()
                event.remove(engine, "before_cursor_execute", before_compensation_update)

    with factory() as reader:
        current = reader.get(BackgroundJob, task_id)
        assert current is not None
        assert current.status == "cancelling"
        assert {column.name: getattr(current, column.name) for column in BackgroundJob.__table__.columns} == expected


@pytest.mark.parametrize("claimed_job", ["conversation_merge", "content_noise_scan"], indirect=True)
def test_cancellation_after_compensation_stays_terminal_and_unclaimable(claimed_job):
    _, factory, task_id = claimed_job
    _requeue_unstarted_task("job", task_id, factory)
    with factory() as canceller:
        job = canceller.query(BackgroundJob).filter_by(id=task_id).with_for_update().one()
        assert job.status == "queued"
        assert job.attempt_count == 1
        request_background_job_cancellation(job)
        canceller.commit()
    _requeue_unstarted_task("job", task_id, factory)
    with factory() as reader:
        current = reader.get(BackgroundJob, task_id)
        assert current is not None
        assert current.status == "cancelled"
        assert current.attempt_count == 1
        assert current.completed_at is not None
        assert claim_next_job(reader, job_type=current.job_type, exclude_job_types=()) is None
