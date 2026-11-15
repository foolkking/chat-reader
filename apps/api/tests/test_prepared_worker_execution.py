"""Single-use preparation preserves claim, lease and uncertain-delivery fences."""
import io
import subprocess
from types import SimpleNamespace
import uuid

import pytest

from app.services import worker_supervisor as supervisor
from test_worker_supervisor import Loop


class Input:
    def __init__(self, failure=False):
        self.data = b""
        self.closed = False
        self.failure = failure

    def write(self, data):
        self.data += data
        if self.failure:
            raise BrokenPipeError()

    def flush(self):
        pass

    def close(self):
        self.closed = True


class Process:
    def __init__(self, *, ready=True, failure=False, timeouts=0):
        self.stdin = Input(failure)
        self.stdout = io.BytesIO(b"chat-reader-executor-ready-v1\n" if ready else b"invalid-ready\n")
        self.timeouts = timeouts
        self.events = []
        self.returncode = None

    def poll(self):
        return self.returncode

    def wait(self, timeout):
        self.events.append(("wait", timeout))
        if self.timeouts:
            self.timeouts -= 1
            raise subprocess.TimeoutExpired("synthetic", timeout)
        self.returncode = 0
        return 0

    def terminate(self):
        self.events.append(("terminate",))

    def kill(self):
        self.events.append(("kill",))


@pytest.mark.parametrize("failure", [False, True])
def test_prepared_handoff_is_one_fenced_delivery_even_if_the_pipe_fails(failure):
    process = Process(failure=failure)
    prepared = supervisor.PreparedExecution(process)
    assert prepared.ready.wait(2) and prepared.valid
    ident, token = uuid.uuid4(), uuid.uuid4()
    assert prepared.activate("job", ident, token) is process
    assert process.stdin.data == f"job\t{ident}\t{token}\n".encode()
    assert process.stdin.closed
    assert not process.events  # No substitute spawn, wait, terminate or retry.
    with pytest.raises(RuntimeError, match="already been consumed"):
        prepared.activate("import", uuid.uuid4(), uuid.uuid4())
    assert process.stdin.data == f"job\t{ident}\t{token}\n".encode()
    process.wait(2)


@pytest.mark.parametrize(("kind", "ident", "token"), [
    ("maintenance", str(uuid.UUID(int=1)), str(uuid.UUID(int=2))),
    ("job", "invalid\tidentity", str(uuid.UUID(int=2))),
    ("import", str(uuid.UUID(int=1)), "invalid\nidentity"),
])
def test_bad_prepared_identity_is_rejected_before_any_delivery(kind, ident, token):
    process = Process()
    prepared = supervisor.PreparedExecution(process)
    assert prepared.ready.wait(2)
    with pytest.raises(ValueError):
        prepared.activate(kind, ident, token)
    assert process.stdin.data == b""
    prepared.close()


@pytest.mark.parametrize(("timeouts", "expected"), [
    (0, [("wait", 2)]),
    (1, [("wait", 2), ("terminate",), ("wait", 2)]),
    (2, [("wait", 2), ("terminate",), ("wait", 2), ("kill",), ("wait", 5)]),
])
def test_unused_child_close_is_bounded_without_a_task_or_execution_stop(timeouts, expected):
    process = Process(timeouts=timeouts)
    prepared = supervisor.PreparedExecution(process)
    assert prepared.ready.wait(2)
    prepared.close()
    assert process.stdin.closed and process.stdin.data == b""
    assert process.events == expected
    with pytest.raises(RuntimeError, match="already been consumed"):
        prepared.activate("job", uuid.uuid4(), uuid.uuid4())
    assert process.stdin.data == b""


@pytest.mark.parametrize("ready", [False, True])
def test_prepare_requires_the_actual_ready_protocol_and_never_a_synthetic_idle(monkeypatch, ready):
    process = Process(ready=ready)
    calls = []
    monkeypatch.setattr(supervisor, "spawn", lambda *args: calls.append(args) or process)
    shutdown = SimpleNamespace(requested=False)
    prepared = supervisor.prepare_execution_child(shutdown)
    assert calls == [("standby", uuid.UUID(int=0), uuid.UUID(int=0))]
    if ready:
        assert prepared is not None and prepared.process is process
        assert process.events == []
        prepared.close()
    else:
        assert prepared is None and process.events == [("wait", 2)]


def test_cold_preparation_stops_before_claim_or_heartbeat_registration(monkeypatch):
    shutdown = SimpleNamespace(requested=False)
    closed = []

    class Readiness:
        def wait(self, timeout):
            shutdown.requested = True
            return False

    child = SimpleNamespace(ready=Readiness(), valid=False, close=lambda: closed.append(True))
    monkeypatch.setattr(supervisor, "spawn", lambda *args: object())
    monkeypatch.setattr(supervisor, "PreparedExecution", lambda process: child)
    assert supervisor.prepare_execution_child(shutdown) is None
    assert closed == [True]


def _prepared_loop(monkeypatch, **kwargs):
    loop = Loop(monkeypatch, **kwargs)
    original_claim = loop.claim
    original_reconcile = loop.reconcile
    alive = []

    def claim(db):
        result = original_claim(db)
        if result is None:
            db.info["legacy_recovery_needed"] = False
        return result

    monkeypatch.setattr(supervisor, "claim", claim)
    monkeypatch.setattr(supervisor, "reconcile_pending", lambda retire_idle=None: original_reconcile())

    class Prepared:
        def __init__(self):
            self.alive = True
            self.process = SimpleNamespace(poll=lambda: None)
            loop.events.append(("prepared",))
            alive.append(self)

        def activate(self, *identity):
            loop.events.append(("activate", identity))
            self.alive = False
            return loop.spawn(*identity)

        def close(self):
            loop.events.append(("retire_prepared",))
            assert self.alive
            self.alive = False

    def prepare(shutdown):
        assert loop.held == {"guard", "execution"}
        assert not any(child.alive for child in alive)
        return Prepared()

    return loop, prepare, alive


def test_runtime_is_prepared_before_initial_idle_and_activation_follows_real_claim_and_lease_release(monkeypatch):
    loop, prepare, children = _prepared_loop(monkeypatch, jobs=1, stop_after_waits=1)
    supervisor.run_task_worker_forever(shutdown=loop.shutdown, prepare_child=prepare)
    labels = [event[0] for event in loop.events]
    assert labels.index("prepared") < labels.index("reporter_start") < labels.index("claim")
    activation = labels.index("activate")
    assert next(index for index, event in enumerate(loop.events) if event == ("lease_exit", "execution")) < activation
    assert loop.completed == 1
    assert not any(child.alive for child in children)
    assert labels[-1] == "reporter_stop"


def test_idle_preparation_is_retired_before_maintenance_and_not_kept_as_a_second_child(monkeypatch):
    loop, prepare, children = _prepared_loop(monkeypatch, jobs=0, stop_after_waits=2)
    original_wait = loop.wait
    original_spawn = loop.spawn

    def wait(seconds):
        original_wait(seconds)
        if loop.wait_count == 1:
            loop.clock += 31

    def spawn(*identity):
        assert not any(child.alive for child in children)
        return original_spawn(*identity)

    loop.shutdown.wait = wait
    monkeypatch.setattr(supervisor, "spawn", spawn)
    supervisor.run_task_worker_forever(shutdown=loop.shutdown, prepare_child=prepare)
    maintenance = next(index for index, event in enumerate(loop.events) if event[:2] == ("spawn", "maintenance"))
    assert loop.events[maintenance - 1] == ("retire_prepared",)
    assert not any(child.alive for child in children)


def test_lost_supervisor_guard_retires_the_idle_interpreter_before_backoff(monkeypatch):
    loop, prepare, children = _prepared_loop(monkeypatch, jobs=0, stop_after_waits=2)
    loop.guards.extend([True, False])
    supervisor.run_task_worker_forever(shutdown=loop.shutdown, prepare_child=prepare)
    assert sum(event[0] == "prepared" for event in loop.events) == 1
    lost = loop.events.index(("lease_enter", "guard", False))
    assert loop.events[lost + 1] == ("retire_prepared",)
    assert not any(child.alive for child in children)


@pytest.mark.parametrize("failure", ["database", "execution"])
def test_unknown_or_blocked_boundary_retires_preparation_before_original_backoff(monkeypatch, failure):
    from sqlalchemy.exc import SQLAlchemyError
    loop, prepare, children = _prepared_loop(monkeypatch, jobs=0, stop_after_waits=2)
    if failure == "database":
        loop.reconciliations.extend([True, SQLAlchemyError("synthetic unavailable")])
    else:
        loop.execution_leases.extend([True, False])
    supervisor.run_task_worker_forever(shutdown=loop.shutdown, prepare_child=prepare)
    retirement = loop.events.index(("retire_prepared",))
    assert loop.events[retirement + 1] == ("poll_wait", 1.0)
    assert not any(child.alive for child in children)


def test_stop_during_preparation_never_claims_a_task_or_registers_idle(monkeypatch):
    loop, _, _ = _prepared_loop(monkeypatch, jobs=1, stop_after_waits=1)

    def prepare(shutdown):
        shutdown.requested = True
        return None

    supervisor.run_task_worker_forever(shutdown=loop.shutdown, prepare_child=prepare)
    assert not any(event[0] in {"claim", "reporter_start", "busy", "spawn"} for event in loop.events)
    assert loop.completed == 0


def test_unavailable_readiness_keeps_original_backoff_without_idle_claim_or_fallback(monkeypatch):
    loop, _, _ = _prepared_loop(monkeypatch, jobs=1, stop_after_waits=2)
    supervisor.run_task_worker_forever(
        shutdown=loop.shutdown, prepare_child=lambda shutdown: None,
    )
    assert [event for event in loop.events if event[0] == "poll_wait"] == [("poll_wait", 1.0)] * 2
    assert not any(event[0] in {"claim", "reporter_start", "idle", "busy", "spawn"} for event in loop.events)
    assert loop.completed == 0 and len(loop.jobs) == 1


def test_real_launcher_uses_preparation_without_any_ci_or_environment_flag(monkeypatch):
    loop, prepare, _ = _prepared_loop(monkeypatch, jobs=0, stop_after_waits=1)
    import sys
    monkeypatch.setattr(sys.modules["__main__"], "__spec__", SimpleNamespace(name="app.workers.import_worker"))
    monkeypatch.setattr(supervisor, "prepare_execution_child", prepare)
    supervisor.run_task_worker_forever(shutdown=loop.shutdown)
    assert any(event[0] == "prepared" for event in loop.events)
