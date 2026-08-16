from __future__ import annotations

import uuid
import threading
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services import task_worker
from app.services import worker_liveness
from app.services.diagnostics import worker_status
from app.services.worker_liveness import (
    WorkerHeartbeatReporter,
    pulse_worker,
    refresh_active_task_heartbeat,
    register_worker,
)
from sqlalchemy.orm import sessionmaker
from test_import_preview_api import client  # noqa: F401


def _db_session():
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    return db, generator


def _close_db(db, generator) -> None:
    db.close()
    generator.close()


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def test_worker_status_distinguishes_idle_busy_stale_and_unavailable() -> None:
    now = datetime(2026, 8, 16, 12, 0, tzinfo=timezone.utc)
    row = WorkerRuntimeState(
        worker_key="primary",
        instance_id=uuid.uuid4(),
        state="idle",
        task_kind=None,
        started_at=now - timedelta(minutes=5),
        heartbeat_at=now - timedelta(seconds=10),
    )
    idle = worker_status(row, now=now, stale_after_seconds=120, active_job_count=0, active_import_count=0)
    assert idle == {
        "status": "alive_idle",
        "heartbeat_at": row.heartbeat_at.isoformat(),
        "heartbeat_age_seconds": 10.0,
        "processing_task_count": 0,
        "active_task_kind": None,
    }

    row.state = "busy"
    row.task_kind = "job"
    busy = worker_status(row, now=now, stale_after_seconds=120, active_job_count=1, active_import_count=0)
    assert busy["status"] == "alive_busy"
    assert busy["active_task_kind"] == "job"
    assert busy["processing_task_count"] == 1

    row.heartbeat_at = now - timedelta(seconds=120)
    stale = worker_status(row, now=now, stale_after_seconds=120, active_job_count=1, active_import_count=0)
    assert stale["status"] == "stale"
    assert stale["active_task_kind"] is None

    unavailable = worker_status(None, now=now, stale_after_seconds=120, active_job_count=0, active_import_count=0)
    assert unavailable["status"] == "unavailable"
    assert unavailable["heartbeat_at"] is None


def test_worker_restart_replaces_instance_and_rejects_stale_pulses(client: TestClient) -> None:
    first_instance = uuid.uuid4()
    second_instance = uuid.uuid4()
    now = datetime.now(timezone.utc)
    db, generator = _db_session()
    try:
        register_worker(db, instance_id=first_instance, now=now)
        db.commit()
        register_worker(db, instance_id=second_instance, now=now + timedelta(seconds=1))
        db.commit()
        assert pulse_worker(
            db,
            instance_id=first_instance,
            state="idle",
            task_kind=None,
            now=now + timedelta(seconds=2),
        ) is False
        assert pulse_worker(
            db,
            instance_id=second_instance,
            state="idle",
            task_kind=None,
            now=now + timedelta(seconds=3),
        ) is True
        db.commit()
        row = db.get(WorkerRuntimeState, "primary")
        assert row is not None
        assert row.instance_id == second_instance
        assert _utc(row.heartbeat_at) == now + timedelta(seconds=3)
    finally:
        _close_db(db, generator)


def test_busy_pulse_keeps_long_job_and_worker_fresh_without_sleep(client: TestClient) -> None:
    instance_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    db, generator = _db_session()
    try:
        job = BackgroundJob(
            job_type="attachment_derivative",
            status="processing",
            phase="rendering",
            queued_at=now - timedelta(minutes=10),
            started_at=now - timedelta(minutes=9),
            heartbeat_at=now - timedelta(minutes=8),
            payload={"private": "must-not-leak"},
        )
        db.add(job)
        register_worker(db, instance_id=instance_id, now=now - timedelta(minutes=9))
        db.commit()

        pulse_at = now + timedelta(seconds=90)
        assert pulse_worker(
            db,
            instance_id=instance_id,
            state="busy",
            task_kind="job",
            now=pulse_at,
        ) is True
        assert refresh_active_task_heartbeat(
            db,
            task_kind="job",
            task_id=job.id,
            now=pulse_at,
        ) is True
        db.commit()
        db.refresh(job)
        row = db.get(WorkerRuntimeState, "primary")
        assert row is not None
        status = worker_status(
            row,
            now=pulse_at + timedelta(seconds=1),
            stale_after_seconds=120,
            active_job_count=1,
            active_import_count=0,
        )
        assert status["status"] == "alive_busy"
        assert _utc(job.heartbeat_at) == pulse_at
    finally:
        _close_db(db, generator)


class _ReporterProbe:
    def __init__(self) -> None:
        self.events: list[tuple[str, str | None]] = []
        self.superseded = False

    def set_busy(self, task_kind: str, task_id: uuid.UUID) -> bool:
        self.events.append(("busy", task_kind))
        return True

    def set_idle(self) -> bool:
        self.events.append(("idle", None))
        return True


def test_worker_iteration_returns_to_idle_when_processing_fails(client: TestClient, monkeypatch) -> None:
    job_id = uuid.uuid4()

    class _SessionProbe:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback) -> None:
            return None

        def commit(self) -> None:
            return None

    monkeypatch.setattr(task_worker, "SessionLocal", _SessionProbe)
    monkeypatch.setattr(task_worker, "recover_stale_imports", lambda db, seconds: 0)
    monkeypatch.setattr(task_worker, "recover_stale_jobs", lambda db, seconds: 0)
    monkeypatch.setattr(task_worker, "_oldest_task_kind", lambda db: "job")
    monkeypatch.setattr(task_worker, "claim_next_job", lambda db: job_id)

    def fail_job(job_id: uuid.UUID) -> None:
        raise RuntimeError("controlled failure")

    monkeypatch.setattr(task_worker, "process_background_job", fail_job)
    reporter = _ReporterProbe()
    with pytest.raises(RuntimeError, match="controlled failure"):
        task_worker.run_task_worker_iteration(Settings(), reporter)  # type: ignore[arg-type]
    assert reporter.events == [("busy", "job"), ("idle", None)]


@pytest.mark.parametrize("task_kind", ["job", "import"])
def test_unstarted_claim_is_requeued_without_consuming_an_attempt(
    client: TestClient,
    task_kind: str,
) -> None:
    now = datetime.now(timezone.utc)
    db, generator = _db_session()
    try:
        if task_kind == "job":
            task = BackgroundJob(
                job_type="attachment_derivative",
                status="processing",
                phase="validating",
                queued_at=now - timedelta(minutes=1),
                started_at=now,
                heartbeat_at=now,
                attempt_count=2,
                payload={},
            )
        else:
            from app.models.import_record import ImportRecord

            task = ImportRecord(
                source_profile="fixture",
                source_fingerprint=f"requeue-{uuid.uuid4()}",
                status="processing",
                phase="parsing",
                queued_at=now - timedelta(minutes=1),
                started_at=now,
                heartbeat_at=now,
                attempt_count=2,
            )
        db.add(task)
        db.commit()
        task_id = task.id
        factory = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    finally:
        _close_db(db, generator)

    task_worker._requeue_unstarted_task(task_kind, task_id, factory)

    db, generator = _db_session()
    try:
        model = BackgroundJob if task_kind == "job" else ImportRecord
        task = db.get(model, task_id)
        assert task is not None
        assert task.status == "queued"
        assert task.attempt_count == 1
        assert task.started_at is None
        assert task.heartbeat_at is None
    finally:
        _close_db(db, generator)


def test_heartbeat_threshold_requires_three_intervals() -> None:
    with pytest.raises(ValueError, match="at least three heartbeat intervals"):
        Settings(
            WORKER_HEARTBEAT_INTERVAL_SECONDS=30,
            WORKER_HEARTBEAT_STALE_AFTER_SECONDS=89,
        )


def test_reporter_periodic_loop_pulses_without_job_activity_or_wall_clock_sleep(monkeypatch) -> None:
    waits = iter((False, True))
    reporter = WorkerHeartbeatReporter(interval_seconds=30, wait=lambda seconds: next(waits))
    pulses: list[bool] = []
    monkeypatch.setattr(reporter, "pulse", lambda: pulses.append(True) or True)
    reporter._run()
    assert pulses == [True]


def test_task_heartbeat_failure_does_not_roll_back_worker_liveness(client: TestClient, monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    job_id = uuid.uuid4()
    db, generator = _db_session()
    try:
        factory = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    finally:
        _close_db(db, generator)

    reporter = WorkerHeartbeatReporter(
        interval_seconds=30,
        session_factory=factory,
        instance_id=uuid.uuid4(),
    )
    assert reporter.pulse(now=now) is True

    def fail_task_refresh(*args, **kwargs) -> bool:
        raise RuntimeError("controlled task heartbeat failure")

    monkeypatch.setattr(worker_liveness, "refresh_active_task_heartbeat", fail_task_refresh)
    with reporter._state_lock:
        reporter._state = "busy"
        reporter._task_kind = "job"
        reporter._task_id = job_id
    assert reporter.pulse(now=now + timedelta(seconds=30)) is True

    with factory() as verify_db:
        row = verify_db.get(WorkerRuntimeState, "primary")
        assert row is not None
        assert row.state == "busy"
        assert _utc(row.heartbeat_at) == now + timedelta(seconds=30)


def test_superseded_reporter_stops_before_claiming_more_work(client: TestClient, monkeypatch) -> None:
    db, generator = _db_session()
    try:
        factory = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    finally:
        _close_db(db, generator)

    first = WorkerHeartbeatReporter(interval_seconds=30, session_factory=factory)
    second = WorkerHeartbeatReporter(interval_seconds=30, session_factory=factory)
    assert first.pulse() is True
    assert second.pulse() is True
    assert first.pulse() is False
    assert first.superseded is True

    monkeypatch.setattr(task_worker, "claim_next_job", lambda db: pytest.fail("superseded worker claimed work"))
    monkeypatch.setattr(task_worker, "claim_next_import", lambda db: pytest.fail("superseded worker claimed work"))
    assert task_worker.run_task_worker_iteration(Settings(), first) is False


@pytest.mark.parametrize("task_kind", ["job", "import"])
def test_refresh_active_task_heartbeat_supports_both_task_families(
    client: TestClient,
    task_kind: str,
) -> None:
    now = datetime.now(timezone.utc)
    db, generator = _db_session()
    try:
        if task_kind == "job":
            task = BackgroundJob(
                job_type="attachment_derivative",
                status="processing",
                phase="rendering",
                queued_at=now - timedelta(minutes=2),
                started_at=now - timedelta(minutes=1),
                heartbeat_at=now - timedelta(minutes=1),
                payload={},
            )
        else:
            from app.models.import_record import ImportRecord

            task = ImportRecord(
                source_profile="fixture",
                source_fingerprint=f"heartbeat-{uuid.uuid4()}",
                status="processing",
                phase="parsing",
                started_at=now - timedelta(minutes=1),
                heartbeat_at=now - timedelta(minutes=1),
            )
        db.add(task)
        db.commit()
        pulse_at = now + timedelta(seconds=30)
        assert refresh_active_task_heartbeat(
            db,
            task_kind=task_kind,
            task_id=task.id,
            now=pulse_at,
        ) is True
        db.commit()
        db.refresh(task)
        assert _utc(task.heartbeat_at) == pulse_at
    finally:
        _close_db(db, generator)


def test_background_heartbeat_refreshes_a_blocked_job_without_sleep(client: TestClient, monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    tick_release = threading.Event()
    tick_complete = threading.Event()
    task_finish = threading.Event()
    waits = 0

    def controlled_wait(seconds: float) -> bool:
        nonlocal waits
        waits += 1
        if waits == 1:
            assert tick_release.wait(timeout=2)
            return False
        return True

    db, generator = _db_session()
    try:
        factory = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
        job = BackgroundJob(
            job_type="attachment_derivative",
            status="processing",
            phase="rendering",
            queued_at=now - timedelta(minutes=2),
            started_at=now - timedelta(minutes=1),
            heartbeat_at=now - timedelta(minutes=1),
            payload={},
        )
        db.add(job)
        db.commit()
        job_id = job.id
    finally:
        _close_db(db, generator)

    original_refresh = worker_liveness.refresh_active_task_heartbeat

    def observed_refresh(*args, **kwargs) -> bool:
        result = original_refresh(*args, **kwargs)
        if threading.current_thread().name == "worker-heartbeat":
            tick_complete.set()
        return result

    monkeypatch.setattr(worker_liveness, "refresh_active_task_heartbeat", observed_refresh)
    reporter = WorkerHeartbeatReporter(interval_seconds=30, session_factory=factory, wait=controlled_wait)
    reporter.start()

    processor_started = threading.Event()

    def blocked_processor() -> None:
        assert reporter.set_busy("job", job_id) is True
        processor_started.set()
        assert task_finish.wait(timeout=2)
        reporter.set_idle()

    processor = threading.Thread(target=blocked_processor, name="controlled-worker-task")
    processor.start()
    assert processor_started.wait(timeout=2)
    tick_release.set()
    assert tick_complete.wait(timeout=2)

    with factory() as verify_db:
        row = verify_db.get(WorkerRuntimeState, "primary")
        job = verify_db.get(BackgroundJob, job_id)
        assert row is not None and row.state == "busy"
        assert job is not None
        assert _utc(job.heartbeat_at) >= _utc(row.started_at)

    task_finish.set()
    processor.join(timeout=2)
    assert not processor.is_alive()
    reporter.stop()
