"""Real interpreters and PostgreSQL leases, not a mocked standby process."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import text

from app.models.background_job import BackgroundJob
from app.models.task_execution_control import TaskExecutionControl
from app.models.worker_runtime_state import WorkerRuntimeState
from app.services import worker_supervisor as supervisor
from app.services.execution_control import EXECUTION_LOCK, SLOT, session_lease
from app.workers.shutdown import WorkerShutdown
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_supervised_execution_postgres import queued, runtime  # noqa: F401

pytestmark = pytest.mark.skipif(
    os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires explicitly selected disposable PostgreSQL",
)


def _connection_name(engine, monkeypatch):
    name = "synthetic_standby_" + uuid.uuid4().hex
    url = engine.url.set(query={**engine.url.query, "application_name": name})
    monkeypatch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
    return name


def _connection_count(engine, name):
    with engine.connect() as connection:
        return connection.scalar(text(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
            "AND application_name=:name"
        ), {"name": name})


def _assert_disconnected(engine, name):
    # Process exit and PostgreSQL backend teardown are separate observations.
    deadline = time.monotonic() + 5
    while _connection_count(engine, name) and time.monotonic() < deadline:
        time.sleep(.02)
    assert _connection_count(engine, name) == 0


def _prepared_without_connections(engine, name):
    prepared = supervisor.prepare_execution_child(WorkerShutdown())
    assert prepared is not None
    try:
        assert prepared.process.poll() is None
        assert _connection_count(engine, name) == 0
        with session_lease(engine, EXECUTION_LOCK) as lease:
            assert lease is not None
            assert _connection_count(engine, name) == 0
    except BaseException:
        prepared.close()
        raise
    return prepared


@pytest.mark.parametrize(("payload", "returncode"), [
    (b"", 0),
    (b"\n", 3),
    (b"maintenance\t" + b"0" * 32 + b"\t" + b"0" * 32 + b"\n", 3),
    (b"job\tinvalid\t" + b"0" * 32 + b"\n", 3),
    (b"import\t" + b"0" * 32 + b"\tinvalid\n", 3),
    (b"job\t" + b"0" * 32 + b"\t" + b"0" * 32, 3),
    (b"job\t" + b"1" * 300 + b"\t" + b"0" * 32 + b"\n", 3),
])
def test_real_idle_child_eof_and_bad_protocol_never_connect_or_claim(runtime, monkeypatch, payload, returncode):
    engine, factory = runtime
    name = _connection_name(engine, monkeypatch)
    prepared = _prepared_without_connections(engine, name)
    try:
        if payload:
            prepared.process.stdin.write(payload)
            prepared.process.stdin.flush()
        prepared.process.stdin.close()
        assert prepared.process.wait(timeout=10) == returncode
        assert _connection_count(engine, name) == 0
        with factory() as db:
            assert db.get(TaskExecutionControl, SLOT) is None
            assert db.query(BackgroundJob).count() == 0
    finally:
        prepared.close()


@pytest.mark.parametrize("stop_before_delivery", [False, True])
def test_real_prepared_delivery_keeps_original_claim_token_stop_and_result_fences(
    runtime, monkeypatch, stop_before_delivery,
):
    engine, factory = runtime
    name = _connection_name(engine, monkeypatch)
    task_id = queued(factory)
    prepared = _prepared_without_connections(engine, name)
    try:
        with session_lease(engine, supervisor.SUPERVISION_LOCK) as guard:
            assert guard is not None
            with session_lease(engine, EXECUTION_LOCK) as lease:
                assert lease is not None
                with factory() as db:
                    identity = supervisor.claim(db)
                    assert identity[1] == task_id
                    if stop_before_delivery:
                        supervisor.request_stop(db, db.get(TaskExecutionControl, SLOT))
                        db.commit()
                assert _connection_count(engine, name) == 0
            child = prepared.activate(*identity)
            with pytest.raises(RuntimeError, match="already been consumed"):
                prepared.activate(*identity)
            assert child.wait(timeout=15) == 0
        with factory() as db:
            task = db.get(BackgroundJob, task_id)
            assert task.status == ("cancelled" if stop_before_delivery else "committed")
            assert task.attempt_count == 1
            control = db.get(TaskExecutionControl, SLOT)
            assert control.token == identity[2] and control.finished_at
        _assert_disconnected(engine, name)
    finally:
        prepared.close()


def test_real_pending_reconciliation_retires_standby_before_another_physical_child(runtime, monkeypatch):
    engine, factory = runtime
    monkeypatch.setattr(supervisor, "SessionLocal", factory)
    original_spawn = supervisor.spawn
    original_reconcile = supervisor.reconcile_pending
    monkeypatch.setattr(
        supervisor, "reconcile_pending",
        lambda **kwargs: original_reconcile(factory, **kwargs),
    )
    children = []
    events = []

    def spawn(*identity, **kwargs):
        assert not any(child.poll() is None for child in children)
        child = original_spawn(*identity, **kwargs)
        children.append(child)
        events.append((identity[0], bool(kwargs.get("reconcile"))))
        assert sum(process.poll() is None for process in children) == 1
        return child

    monkeypatch.setattr(supervisor, "spawn", spawn)
    reporter = SimpleNamespace(
        superseded=False, start=lambda: None, stop=lambda: None,
        set_idle=lambda: None, set_busy=lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(supervisor, "WorkerHeartbeatReporter", lambda **kwargs: reporter)
    shutdown = SimpleNamespace(requested=False)
    admitted = []
    deadline = time.monotonic() + 15

    def wait(seconds):
        if not admitted:
            task_id = queued(factory)
            with session_lease(engine, supervisor.SUPERVISION_LOCK) as guard:
                assert guard is not None
                with session_lease(engine, EXECUTION_LOCK) as lease:
                    assert lease is not None
                    with factory() as db:
                        identity = supervisor.claim(db)
            assert identity[1] == task_id
            admitted.append(identity)
        else:
            assert time.monotonic() < deadline
            if events == [("standby", False), ("job", True), ("standby", False)]:
                shutdown.requested = True
            else:
                time.sleep(seconds)

    shutdown.wait = wait
    try:
        supervisor.run_task_worker_forever(
            shutdown=shutdown, prepare_child=supervisor.prepare_execution_child,
        )
        assert events == [("standby", False), ("job", True), ("standby", False)]
        assert all(child.poll() is not None for child in children)
        with factory() as db:
            assert db.get(BackgroundJob, admitted[0][1]).error_message == "TASK_EXECUTION_INTERRUPTED"
            assert db.get(TaskExecutionControl, SLOT).finished_at
    finally:
        for child in children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)


def _linux_process(pid):
    try:
        root = Path("/proc") / str(pid)
        fields = (root / "stat").read_text().rsplit(")", 1)[1].split()
        return fields[0], int(fields[1]), fields[19], (root / "cmdline").read_bytes().split(b"\0")
    except (FileNotFoundError, ProcessLookupError):
        return None


def _linux_executors(parent_pid):
    result = []
    for root in Path("/proc").iterdir():
        if not root.name.isdigit():
            continue
        process = _linux_process(int(root.name))
        if process and process[0] != "Z" and process[1] == parent_pid:
            args = process[3]
            if b"app.workers.execution_child" in args:
                result.append((int(root.name), args[args.index(b"app.workers.execution_child") + 1]))
    return result


@pytest.mark.skipif(sys.platform != "linux", reason="real Linux parent-death signal requires prctl")
def test_real_parent_death_kills_its_unassigned_interpreter(runtime, monkeypatch, tmp_path):
    engine, _ = runtime
    name = _connection_name(engine, monkeypatch)
    ready = tmp_path / "synthetic-parent-ready.json"
    script = """
import json,os,time
from pathlib import Path
from app.services.worker_supervisor import prepare_execution_child
from app.workers.shutdown import WorkerShutdown
child = prepare_execution_child(WorkerShutdown())
assert child is not None
Path(os.environ["SYNTHETIC_READY"]).write_text(json.dumps({"pid": child.process.pid}))
time.sleep(60)
"""
    parent = subprocess.Popen(
        [sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "SYNTHETIC_READY": str(ready)},
    )
    child_pid = child_start = None
    try:
        deadline = time.monotonic() + 15
        while not ready.exists() and time.monotonic() < deadline:
            assert parent.poll() is None
            time.sleep(.05)
        assert ready.exists()
        child_pid = json.loads(ready.read_text())["pid"]
        process = _linux_process(child_pid)
        assert process and process[0] != "Z" and process[1] == parent.pid
        child_start = process[2]
        assert _connection_count(engine, name) == 0
        parent.kill()
        parent.wait(timeout=5)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            process = _linux_process(child_pid)
            if not process or process[0] == "Z":
                break
            assert process[2] == child_start
            time.sleep(.02)
        assert not process or process[0] == "Z"
        assert _connection_count(engine, name) == 0
    finally:
        if parent.poll() is None:
            parent.kill()
        parent.wait(timeout=5)
        process = _linux_process(child_pid) if child_pid else None
        if process and process[0] != "Z" and process[2] == child_start:
            os.kill(child_pid, signal.SIGKILL)


@pytest.mark.skipif(sys.platform != "linux", reason="observes real /proc children and graceful POSIX shutdown")
def test_real_idle_maintenance_and_shutdown_never_overlap_two_execution_children(runtime, tmp_path):
    _, factory = runtime
    log = (tmp_path / "synthetic-idle-supervisor.log").open("wb")
    parent = subprocess.Popen(
        [sys.executable, "-m", "app.workers.import_worker"],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "IMPORT_WORKER_POLL_SECONDS": "0.25"},
        stdout=log, stderr=subprocess.STDOUT,
    )
    children = set()
    saw_idle = saw_maintenance = returned_to_idle = False
    try:
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            assert parent.poll() is None
            physical = _linux_executors(parent.pid)
            assert len(physical) <= 1
            children.update(pid for pid, _ in physical)
            with factory() as db:
                worker = db.get(WorkerRuntimeState, "primary")
                if worker and worker.state == "idle":
                    saw_idle = saw_idle or any(kind == b"standby" for _, kind in physical)
            if any(kind == b"maintenance" for _, kind in physical):
                assert saw_idle
                saw_maintenance = True
            if saw_maintenance and any(kind == b"standby" for _, kind in physical):
                returned_to_idle = True
                break
            time.sleep(.02)
        assert saw_idle and saw_maintenance and returned_to_idle
        parent.terminate()
        assert parent.wait(timeout=7) == 0
        assert not _linux_executors(parent.pid)
        assert all(not (process := _linux_process(pid)) or process[0] == "Z" for pid in children)
    finally:
        if parent.poll() is None:
            parent.kill()
        parent.wait(timeout=5)
        log.close()
