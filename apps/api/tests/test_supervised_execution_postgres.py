"""Disposable PG + real processes. No user ZIPs, task IDs or production services."""
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy.orm import sessionmaker

from app.models.background_job import BackgroundJob
from app.models.user import User
from app.models.task_execution_control import TaskExecutionControl
from app.services import worker_supervisor as supervisor
from app.services.execution_control import SLOT, EXECUTION_LOCK, ExecutionMonitor, session_lease
from app.services.background_jobs import process_background_job
from app.workers.shutdown import WorkerShutdown
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="explicit disposable PostgreSQL required")


@pytest.fixture
def runtime(isolated_schema, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("DATABASE_URL", engine.url.render_as_string(hide_password=False))
    monkeypatch.setattr(supervisor, "engine", engine)
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def queued(factory, kind="personal_search_backfill", payload=None):
    with factory() as db:
        owner = User(normalized_email=f"synthetic-{uuid.uuid4()}@example.test")
        db.add(owner)
        db.flush()
        row = BackgroundJob(owner_user_id=owner.id, job_type=kind, status="queued", phase="queued", payload=payload or {})
        db.add(row)
        db.commit()
        return row.id


def test_repeated_progress_and_heartbeat_are_not_business_progress(runtime):
    engine, factory = runtime
    task_id = queued(factory)
    with factory() as db:
        identity = supervisor.claim(db)
    with session_lease(engine, EXECUTION_LOCK) as lease:
        monitor = ExecutionMonitor(identity[2], factory, lease)
        monitor.check(("read", 5, 1, 10), force=True)
        with factory() as db:
            first = db.get(TaskExecutionControl, SLOT).progress_at
        monitor.check(("read", 5, 1, 10), force=True)
        with factory() as db:
            assert db.get(TaskExecutionControl, SLOT).progress_at == first
        monitor.check(byte_count=64, force=True)
        with factory() as db:
            assert db.get(TaskExecutionControl, SLOT).progress_at > first
            assert db.get(TaskExecutionControl, SLOT).task_id == task_id


def test_cancellation_is_independent_of_locked_canonical_row(runtime):
    _, factory = runtime
    task_id = queued(factory, "conversation_export")
    with factory() as db:
        supervisor.claim(db)
    from app.api.routes.tasks import cancel_task
    from app.services.ownership import OwnershipScope
    with factory() as db:
        scope = OwnershipScope(db.get(BackgroundJob, task_id).owner_user_id)
    with factory() as holder:
        holder.query(BackgroundJob).filter_by(id=task_id).with_for_update().one()
        started = time.monotonic()
        with factory() as db:
            response = cancel_task(task_id, db, scope, None)
            assert response.execution_state == "stopping"
        assert time.monotonic() - started < 2
        with factory() as db:
            assert db.get(BackgroundJob, task_id).status == "processing"
            assert db.get(TaskExecutionControl, SLOT).stop_requested_at is not None


def test_all_job_progress_skips_own_row_lock(runtime, monkeypatch):
    _, factory = runtime
    task_id = queued(factory, "conversation_derived_rebuild", {"conversation_id": str(uuid.uuid4())})
    with factory() as db:
        identity = supervisor.claim(db)
        row = db.get(BackgroundJob, task_id)
        execution = (row.attempt_count, row.started_at, row.payload["execution_token"])
    from app.services import background_jobs
    def work(db, *args, progress_callback, **kwargs):
        db.query(BackgroundJob).filter_by(id=task_id).with_for_update().one()
        start = time.monotonic()
        progress_callback("reading", 25, 1, 4)
        progress_callback("writing", 50, 2, 4)
        assert time.monotonic() - start < 2
        return SimpleNamespace(rebuilt_versions=1, rebuilt_blocks=1)
    monkeypatch.setattr(background_jobs, "rebuild_conversation_derived_data", work)
    process_background_job(task_id, factory, expected_execution=execution)
    with factory() as db:
        assert db.get(BackgroundJob, task_id).status == "committed"


def test_real_stuck_process_releases_before_next_task(runtime, tmp_path):
    engine, factory = runtime
    task_id = queued(factory)
    next_id = queued(factory)
    with factory() as db:
        identity = supervisor.claim(db)
        control = db.get(TaskExecutionControl, SLOT)
        control.progress_at = datetime.now(timezone.utc) - timedelta(seconds=301)
        db.commit()
    ready = tmp_path / "lease-ready"
    script = """
import os,time,uuid
from pathlib import Path
from app.core.database import engine,SessionLocal
from app.models.background_job import BackgroundJob
from app.services.execution_control import EXECUTION_LOCK,session_lease
with session_lease(engine,EXECUTION_LOCK) as lease:
    assert lease is not None
    with SessionLocal() as db:
        db.query(BackgroundJob).filter_by(id=uuid.UUID(os.environ['SYNTHETIC_TASK'])).with_for_update().one()
        Path(os.environ['SYNTHETIC_READY']).write_text('ready')
        time.sleep(600)
"""
    child = subprocess.Popen([sys.executable, "-c", script], env={**os.environ,
        "SYNTHETIC_TASK": str(task_id), "SYNTHETIC_READY": str(ready)},
        cwd=Path(__file__).resolve().parents[1],
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    try:
        deadline = time.monotonic() + 15
        while not ready.exists() and time.monotonic() < deadline:
            assert child.poll() is None
            time.sleep(.05)
        assert ready.exists()
        with factory() as db:
            assert supervisor.claim(db) is None
        supervisor.supervise(child, identity[2], SimpleNamespace(superseded=False), WorkerShutdown(),
            factory=factory, stall_seconds=300, grace_seconds=.25)
        assert child.poll() is not None
        started = time.monotonic()
        # OS exit and PostgreSQL TCP/backend teardown are distinct events.
        # Poll the real lease; do not pretend child.poll() releases DB locks.
        while not supervisor.reconcile_pending(factory) and time.monotonic() - started < 10:
            with factory() as db:
                assert supervisor.claim(db) is None
            time.sleep(.05)
        with factory() as db:
            assert db.get(TaskExecutionControl, SLOT).finished_at is not None
        with factory() as db:
            assert db.get(BackgroundJob, task_id).error_message == "TASK_STALLED"
            second = supervisor.claim(db)
            assert second[1] == next_id
        following = supervisor.spawn(*second)
        following.wait(timeout=15)
        assert following.returncode == 0
        assert time.monotonic() - started < 10
        with factory() as db:
            assert db.get(BackgroundJob, next_id).status == "committed"
            assert db.get(TaskExecutionControl, SLOT).finished_at is not None
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)


@pytest.mark.parametrize("outcome", ["committed", "aborted", "unconfirmed"])
def test_real_commit_ack_loss_protects_assets_until_outcome_verified(runtime, tmp_path, monkeypatch, outcome):
    import psycopg
    from app.services.exporting.archive_transaction import track_archive_object, release_staging_after_commit
    engine, factory = runtime
    final, stage = tmp_path / "final", tmp_path / "stage"
    final.write_bytes(b"synthetic final"); stage.write_bytes(b"synthetic original")
    store = SimpleNamespace(delete_key=lambda key: (tmp_path / key).unlink(missing_ok=True))
    original_commit = engine.dialect.do_commit
    def lose_ack(connection):
        monkeypatch.setattr(engine.dialect, "do_commit", original_commit)
        if outcome != "aborted":
            original_commit(connection)
        else:
            # This case proves a server rollback. Merely not receiving COMMIT
            # is the unknown case and must never license file deletion.
            connection.rollback()
        if outcome == "unconfirmed":
            monkeypatch.setattr(engine, "begin", lambda: (_ for _ in ()).throw(OSError("verification unavailable")))
        raise psycopg.OperationalError("synthetic lost COMMIT response")
    with factory() as db:
        db.add(User(normalized_email=f"synthetic-{uuid.uuid4()}@example.test"))
        db.flush()
        track_archive_object(db, store, "final")
        release_staging_after_commit(db, store, "stage")
        monkeypatch.setattr(engine.dialect, "do_commit", lose_ack)
        with pytest.raises(Exception):
            db.commit()
    assert final.exists() == (outcome != "aborted")
    assert stage.exists() == (outcome != "committed")


def test_terminal_canonical_result_wins_and_old_execution_is_fenced(runtime):
    from app.services.execution_reconciliation import reconcile
    from app.services.execution_control import ExecutionStopped
    engine, factory = runtime
    task_id = queued(factory)
    with factory() as db:
        identity = supervisor.claim(db)
        row = db.get(BackgroundJob, task_id)
        row.status = "committed"; row.phase = "completed"
        control = db.get(TaskExecutionControl, SLOT)
        control.stop_reason = "stalled"
        control.stop_requested_at = datetime.now(timezone.utc)
        db.commit()
    with session_lease(engine, EXECUTION_LOCK) as lease:
        monitor = ExecutionMonitor(identity[2], factory, lease)
        with pytest.raises(ExecutionStopped):
            monitor.check(force=True)
        assert reconcile(*identity, factory)
    with factory() as db:
        assert db.get(BackgroundJob, task_id).status == "committed"
        assert db.get(TaskExecutionControl, SLOT).finished_at is not None


def test_legacy_active_execution_without_control_cannot_be_bypassed(runtime):
    _, factory = runtime
    legacy, waiting = queued(factory), queued(factory)
    with factory() as db:
        row = db.get(BackgroundJob, legacy)
        row.status = "processing"
        row.started_at = row.heartbeat_at = datetime.now(timezone.utc)
        db.commit()
        assert supervisor.claim(db) is None
        assert db.get(BackgroundJob, waiting).status == "queued"


def test_control_migration_roundtrip_keeps_one_head(isolated_schema):
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import inspect
    engine, migrate = isolated_schema
    migrate("head")
    assert ScriptDirectory.from_config(Config("alembic.ini")).get_heads() == ["20261112_0061"]
    assert "storage_deleted_at" in {column["name"] for column in inspect(engine).get_columns("asset_objects")}
    assert "task_execution_controls" in inspect(engine).get_table_names()
    migrate("20261108_0060", "downgrade")
    assert "task_execution_controls" not in inspect(engine).get_table_names()
    assert "storage_deleted_at" not in {column["name"] for column in inspect(engine).get_columns("asset_objects")}
    migrate("head")
    assert "task_execution_controls" in inspect(engine).get_table_names()


def test_session_delete_requests_stop_without_waiting_for_analysis_rows(runtime):
    from app.api.routes.adaptive_imports import cancel_adaptive_import_session
    from app.models.import_record import ImportRecord
    from app.services.ownership import OwnershipScope
    _, factory = runtime
    task_id = queued(factory, "adaptive_import_analysis")
    with factory() as db:
        job = db.get(BackgroundJob, task_id)
        owner_id = job.owner_user_id
        record = ImportRecord(owner_user_id=owner_id, source_profile="adaptive_json_markdown",
            source_fingerprint=uuid.uuid4().hex, status="analyzing", session_state="ANALYZING",
            analysis_summary={"analysis_task_id": str(job.id)})
        db.add(record); db.flush()
        record_id = record.id
        job.payload = {"import_id": str(record_id)}
        db.commit()
        identity = supervisor.claim(db)
    with factory() as holder:
        holder.query(BackgroundJob).filter_by(id=task_id).with_for_update().one()
        holder.query(ImportRecord).filter_by(id=record_id).with_for_update().one()
        with factory() as request:
            cancel_adaptive_import_session(record_id, request, OwnershipScope(owner_id))
        with factory() as verify:
            control = verify.get(TaskExecutionControl, SLOT)
            assert control.token == identity[2] and control.stop_requested_at
            assert control.source_disposition == "discard"
            assert verify.get(ImportRecord, record_id).status == "analyzing"


@pytest.mark.parametrize("poll_seconds", ["1", "20"])
def test_actual_supervisor_process_drains_two_jobs_without_overlapping(runtime, tmp_path, poll_seconds):
    _, factory = runtime
    ids = [queued(factory), queued(factory)]
    log = (tmp_path / "synthetic-supervisor.log").open("wb")
    parent = subprocess.Popen([sys.executable, "-m", "app.workers.import_worker"],
        cwd=Path(__file__).resolve().parents[1],
        # Retain the default-poll case and also prove a busy queue is not
        # delayed by a deliberately slower idle poll. All bounds stay intact.
        env={**os.environ, "IMPORT_WORKER_POLL_SECONDS": poll_seconds},
        stdout=log, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    observed = []
    try:
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            assert parent.poll() is None
            with factory() as db:
                rows = db.query(BackgroundJob).filter(BackgroundJob.id.in_(ids)).all()
                states = {row.id: row.status for row in rows}
                assert sum(state in {"processing", "cancelling"} for state in states.values()) <= 1
                observed.append(states)
                if all(state == "committed" for state in states.values()):
                    control = db.get(TaskExecutionControl, SLOT)
                    if control.finished_at:
                        break
            time.sleep(.1)
        assert all(state == "committed" for state in observed[-1].values())
        with factory() as db:
            first, second = [db.get(BackgroundJob, identity) for identity in ids]
            assert second.started_at >= first.completed_at
            assert (second.started_at - first.completed_at).total_seconds() < 10
    finally:
        parent.terminate()
        try:
            parent.wait(timeout=7)
        except subprocess.TimeoutExpired:
            parent.kill(); parent.wait(timeout=5)
        log.close()
