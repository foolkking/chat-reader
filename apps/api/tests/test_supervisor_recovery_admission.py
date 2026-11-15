"""Empty-lane recovery admission: real queries and explicit loop adapters."""
import os
from datetime import datetime, timezone
import uuid

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models.background_job import BackgroundJob
from app.models.import_record import ImportRecord
from app.models.task_execution_control import TaskExecutionControl
from app.models.user import User
from app.services import worker_supervisor as supervisor
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_worker_supervisor import Loop


@pytest.fixture
def database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'recovery-admission.sqlite'}")
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.mark.parametrize("flag", [False, True, None, 0, "absent"])
def test_only_proven_empty_recovery_lane_avoids_the_fresh_helper(monkeypatch, flag):
    loop = Loop(monkeypatch, stop_after_waits=3)
    original_claim = loop.claim

    def claim(db):
        identity = original_claim(db)
        if flag != "absent":
            db.info["legacy_recovery_needed"] = flag
        return identity

    monkeypatch.setattr(supervisor, "claim", claim)
    loop.run()
    helpers = [event for event in loop.events if event[:2] == ("spawn", "recovery")]
    assert len(helpers) == (0 if flag is False else 1)
    assert loop.wait_count == 3
    assert [event for event in loop.events if event[0] == "poll_wait"] == [("poll_wait", 1.0)] * 3


def test_empty_query_proof_is_recomputed_after_a_legacy_row_appears(database):
    with Session(database) as db:
        assert supervisor.claim(db) is None
        assert db.info["legacy_recovery_needed"] is False
        legacy = BackgroundJob(
            job_type="personal_search_backfill", status="processing",
            phase="indexing", heartbeat_at=datetime.now(timezone.utc), attempt_count=1,
        )
        db.add(legacy)
        db.flush()
        before = {column.name: getattr(legacy, column.name) for column in legacy.__table__.columns}
        assert supervisor.claim(db) is None
        assert db.info["legacy_recovery_needed"] is True
        assert {column.name: getattr(legacy, column.name) for column in legacy.__table__.columns} == before
        db.rollback()
        assert supervisor.claim(db) is None
        assert db.info["legacy_recovery_needed"] is False


@pytest.mark.parametrize("model,status", [
    (BackgroundJob, "processing"), (BackgroundJob, "cancelling"),
    (ImportRecord, "processing"), (ImportRecord, "cancelling"),
])
def test_all_legacy_active_states_keep_existing_recovery_admission(database, model, status):
    values = ({"job_type": "synthetic_recovery"} if model is BackgroundJob else {
        "source_profile": "synthetic_recovery", "source_fingerprint": uuid.uuid4().hex,
    })
    with Session(database) as db:
        row = model(status=status, heartbeat_at=datetime.now(timezone.utc), **values)
        db.add(row)
        db.flush()
        assert supervisor.claim(db) is None
        assert db.info["legacy_recovery_needed"] is True
        assert row.status == status


def test_unfinished_control_is_unknown_not_proof_of_no_recovery_work(database):
    with Session(database) as db:
        now = datetime.now(timezone.utc)
        db.add(TaskExecutionControl(
            slot=supervisor.SLOT, token=uuid.uuid4(), task_kind="job",
            task_id=uuid.uuid4(), attempt=1, started_at=now, progress_at=now,
        ))
        db.flush()
        assert supervisor.claim(db) is None
        assert db.info["legacy_recovery_needed"] is True


def test_failed_recheck_cannot_reuse_an_earlier_empty_lane_proof(database):
    with Session(database) as db:
        assert supervisor.claim(db) is None
        assert db.info["legacy_recovery_needed"] is False

        def fail(_connection, _cursor, statement, _parameters, _context, _many):
            if "from background_jobs" in " ".join(statement.lower().split()):
                raise SQLAlchemyError("synthetic query failure")

        event.listen(database, "before_cursor_execute", fail)
        try:
            with pytest.raises(SQLAlchemyError):
                supervisor.claim(db)
        finally:
            event.remove(database, "before_cursor_execute", fail)
        assert db.info["legacy_recovery_needed"] is True


def _empty_lane_after_real_child(loop, monkeypatch, flag=False):
    original_claim = loop.claim

    def claim(db):
        identity = original_claim(db)
        if identity is None and flag != "absent":
            db.info["legacy_recovery_needed"] = flag
        return identity

    monkeypatch.setattr(supervisor, "claim", claim)


def test_recent_child_exit_bounds_healthy_empty_lane_waits(monkeypatch):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=3)
    _empty_lane_after_real_child(loop, monkeypatch)
    loop.run()
    assert loop.completed == 1
    assert [event for event in loop.events if event[0] == "poll_wait"] == [
        ("poll_wait", .25),
    ] * 3
    assert len([event for event in loop.events if event[0] == "claim"]) == 4
    assert not any(event[:2] == ("spawn", "recovery") for event in loop.events)


def test_empty_rechecks_do_not_renew_the_recent_exit_window(monkeypatch):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=3)
    _empty_lane_after_real_child(loop, monkeypatch)
    original_claim = supervisor.claim
    empty_reads = 0

    def claim(db):
        nonlocal empty_reads
        if loop.completed and empty_reads == 1:
            loop.clock = 105.0  # Exactly five seconds after the only exit.
        identity = original_claim(db)
        if identity is None:
            empty_reads += 1
        return identity

    monkeypatch.setattr(supervisor, "claim", claim)
    loop.run()
    assert [event for event in loop.events if event[0] == "poll_wait"] == [
        ("poll_wait", .25), ("poll_wait", 1.0), ("poll_wait", 1.0),
    ]


def test_recent_exit_does_not_slow_an_explicitly_shorter_idle_poll(monkeypatch):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=3)
    settings = supervisor.get_settings()
    settings.import_worker_poll_seconds = .1
    monkeypatch.setattr(supervisor, "get_settings", lambda: settings)
    _empty_lane_after_real_child(loop, monkeypatch)
    loop.run()
    assert [event for event in loop.events if event[0] == "poll_wait"] == [
        ("poll_wait", .1),
    ] * 3


@pytest.mark.parametrize("flag", [False, True, None, 0, "absent"])
def test_only_fresh_explicit_empty_proof_can_shorten_post_exit_wait(monkeypatch, flag):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=2)
    _empty_lane_after_real_child(loop, monkeypatch, flag)
    loop.run()
    assert [event for event in loop.events if event[0] == "poll_wait"] == [
        ("poll_wait", .25 if flag is False else 1.0),
    ] * 2


@pytest.mark.parametrize("blocked_at", ["guard", "reconciliation", "execution", "database"])
def test_recent_exit_never_shortens_an_unavailable_scheduling_boundary(monkeypatch, blocked_at):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=3)
    _empty_lane_after_real_child(loop, monkeypatch)
    if blocked_at == "guard":
        loop.guards.extend([True, False, False, False])
    elif blocked_at == "reconciliation":
        loop.reconciliations.extend([True, False, False, False])
    elif blocked_at == "execution":
        loop.execution_leases.extend([True, False, False, False])
    else:
        loop.reconciliations.extend([
            True, *[SQLAlchemyError("synthetic post-exit outage") for _ in range(3)],
        ])
    loop.run()
    assert loop.completed == 1
    assert len([event for event in loop.events if event[0] == "claim"]) == 1
    assert [event for event in loop.events if event[0] == "poll_wait"] == [
        ("poll_wait", 1.0),
    ] * 3


def test_long_configured_idle_poll_returns_at_the_original_five_second_boundary(monkeypatch):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=2)
    settings = supervisor.get_settings()
    settings.import_worker_poll_seconds = 20.0
    monkeypatch.setattr(supervisor, "get_settings", lambda: settings)
    _empty_lane_after_real_child(loop, monkeypatch)
    original_claim = supervisor.claim

    def claim(db):
        if loop.wait_count:
            loop.clock = 105.0
        return original_claim(db)

    monkeypatch.setattr(supervisor, "claim", claim)
    loop.run()
    assert [event for event in loop.events if event[0] == "poll_wait"] == [
        ("poll_wait", .25), ("poll_wait", 20.0),
    ]


@pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="explicit disposable PostgreSQL required",
)
def test_real_postgres_absence_and_legacy_states_leave_canonical_rows_unchanged(isolated_schema):
    engine, migrate = isolated_schema
    migrate("head")
    with Session(engine) as db:
        assert supervisor.claim(db) is None
        assert db.info["legacy_recovery_needed"] is False
        owner_id = uuid.uuid4()
        db.add(User(id=owner_id))
        db.commit()
        for model, status in [
            (BackgroundJob, "processing"), (BackgroundJob, "cancelling"),
            (ImportRecord, "processing"), (ImportRecord, "cancelling"),
        ]:
            values = ({"job_type": "synthetic_recovery"} if model is BackgroundJob else {
                "source_profile": "synthetic_recovery", "source_fingerprint": uuid.uuid4().hex,
            })
            row = model(
                owner_user_id=owner_id, status=status,
                heartbeat_at=datetime.now(timezone.utc), **values,
            )
            db.add(row)
            db.flush()
            before = {column.name: getattr(row, column.name) for column in row.__table__.columns}
            assert supervisor.claim(db) is None
            assert db.info["legacy_recovery_needed"] is True
            assert {column.name: getattr(row, column.name) for column in row.__table__.columns} == before
            db.rollback()
            assert supervisor.claim(db) is None
            assert db.info["legacy_recovery_needed"] is False
