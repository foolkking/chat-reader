"""The actual scheduling loop with controlled leases/children, never a service."""
from collections import deque
from contextlib import contextmanager
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.services import worker_supervisor as supervisor


class Loop:
    def __init__(self, monkeypatch, *, jobs=0, stop_after_waits=None):
        self.events = []
        self.clock = 100.0
        self.shutdown = SimpleNamespace(requested=False, wait=self.wait)
        self.reporter = SimpleNamespace(
            superseded=False,
            start=lambda: self.events.append(("reporter_start",)),
            stop=lambda: self.events.append(("reporter_stop",)),
            set_idle=lambda: self.events.append(("idle",)),
            set_busy=lambda kind, ident, **kwargs: self.events.append(("busy", ident, kwargs["execution"])),
        )
        self.jobs = deque(("job", uuid.UUID(int=index + 1), uuid.UUID(int=index + 101)) for index in range(jobs))
        self.guards = deque()
        self.execution_leases = deque()
        self.reconciliations = deque()
        self.held = set()
        self.active_child = None
        self.completed = 0
        self.wait_count = 0
        self.stop_after_waits = stop_after_waits
        self.after_child = lambda: None
        self.maintenance_timeout = False
        self.spawn_error = False
        loop = self

        class Session:
            def __enter__(self):
                self.info = {}
                loop.events.append(("session_enter",))
                return self

            def __exit__(self, *args):
                loop.events.append(("session_exit",))

        monkeypatch.setattr(supervisor, "engine", object())
        monkeypatch.setattr(supervisor, "SessionLocal", Session)
        monkeypatch.setattr(supervisor, "get_settings", lambda: SimpleNamespace(
            worker_heartbeat_interval_seconds=30, import_worker_poll_seconds=1.0,
        ))
        monkeypatch.setattr(supervisor, "WorkerHeartbeatReporter", lambda **kwargs: self.reporter)
        monkeypatch.setattr(supervisor.time, "monotonic", lambda: self.clock)
        monkeypatch.setattr(supervisor, "session_lease", self.lease)
        monkeypatch.setattr(supervisor, "reconcile_pending", self.reconcile)
        monkeypatch.setattr(supervisor, "claim", self.claim)
        monkeypatch.setattr(supervisor, "spawn", self.spawn)
        monkeypatch.setattr(supervisor, "supervise", self.supervise)

    def wait(self, seconds):
        if self.shutdown.requested:
            return
        self.events.append(("poll_wait", seconds))
        self.clock += seconds
        self.wait_count += 1
        # An accidental busy-spin fails rather than hanging this unit test.
        assert self.wait_count <= 6
        if self.stop_after_waits is not None and self.wait_count >= self.stop_after_waits:
            self.shutdown.requested = True

    @contextmanager
    def lease(self, engine, key):
        lane = "guard" if key == supervisor.SUPERVISION_LOCK else "execution"
        assert key in (supervisor.SUPERVISION_LOCK, supervisor.EXECUTION_LOCK)
        assert self.active_child is None
        values = self.guards if lane == "guard" else self.execution_leases
        acquired = values.popleft() if values else True
        self.events.append(("lease_enter", lane, acquired))
        if acquired:
            assert lane not in self.held
            self.held.add(lane)
        try:
            yield object() if acquired else None
        finally:
            if acquired:
                self.held.remove(lane)
            self.events.append(("lease_exit", lane))

    def reconcile(self):
        assert "guard" in self.held and self.active_child is None
        self.events.append(("reconcile",))
        result = self.reconciliations.popleft() if self.reconciliations else True
        if isinstance(result, Exception):
            raise result
        return result

    def claim(self, db):
        assert self.held == {"guard", "execution"} and self.active_child is None
        assert sum(event[0] == "claim" for event in self.events) <= 6
        identity = self.jobs.popleft() if self.jobs else None
        self.events.append(("claim", identity))
        if identity:
            db.info["supervised_execution"] = (1, "synthetic-start", identity[2].hex)
        return identity

    def spawn(self, kind, ident, token):
        assert self.held == {"guard"} and self.active_child is None
        self.events.append(("spawn", kind, ident))
        if self.spawn_error and kind == "job":
            raise OSError("synthetic spawn failure")
        loop = self

        class Child:
            returncode = None

            def wait(self, *, timeout):
                loop.events.append(("child_wait", kind, timeout))
                if kind == "maintenance" and loop.maintenance_timeout and self.returncode is None:
                    raise supervisor.subprocess.TimeoutExpired("synthetic-maintenance", timeout)
                if self.returncode is None:
                    self.returncode = 0
                loop.active_child = None
                return self.returncode

            def kill(self):
                loop.events.append(("child_kill", kind))
                self.returncode = -9

        child = Child()
        child.identity = kind, ident, token
        self.active_child = child
        return child

    def supervise(self, child, token, reporter, shutdown):
        assert self.held == {"guard"} and self.active_child is child
        assert child.identity[2] == token and reporter is self.reporter and shutdown is self.shutdown
        self.events.append(("supervise", child.identity[1]))
        child.returncode = 0
        self.active_child = None
        self.completed += 1
        self.events.append(("child_exited", child.identity[1]))
        self.after_child()

    def run(self):
        supervisor.run_task_worker_forever(shutdown=self.shutdown)
        assert self.active_child is None and not self.held
        assert self.events[-1] == ("reporter_stop",)


def test_busy_queue_rechecks_guard_reconciliation_and_lease_without_mandatory_poll(monkeypatch):
    loop = Loop(monkeypatch, jobs=2)
    identities = list(loop.jobs)
    loop.after_child = lambda: setattr(loop.shutdown, "requested", loop.completed == 2)
    loop.run()
    assert loop.wait_count == 0
    first_exit = loop.events.index(("child_exited", identities[0][1]))
    next_claim = loop.events.index(("claim", identities[1]))
    assert loop.events[first_exit + 1:next_claim] == [
        ("lease_exit", "guard"),
        ("lease_enter", "guard", True),
        ("reconcile",),
        ("lease_enter", "execution", True),
        ("session_enter",),
    ]
    assert [event for event in loop.events if event[0] == "busy"] == [
        ("busy", identity[1], (1, "synthetic-start", identity[2].hex)) for identity in identities
    ]


def test_empty_queue_keeps_original_poll_deadline_and_does_not_busy_spin(monkeypatch):
    loop = Loop(monkeypatch, stop_after_waits=3)
    loop.run()
    assert [event for event in loop.events if event[0] == "poll_wait"] == [("poll_wait", 1.0)] * 3
    assert len([event for event in loop.events if event[0] == "claim"]) == 3
    assert len([event for event in loop.events if event[0] == "idle"]) == 3
    assert len([event for event in loop.events if event[:2] == ("spawn", "recovery")]) == 1


def test_completed_child_immediately_checks_empty_queue_then_backs_off(monkeypatch):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=1)
    loop.run()
    assert loop.completed == 1 and loop.wait_count == 1
    assert len([event for event in loop.events if event[0] == "claim"]) == 2
    assert ("idle",) in loop.events
    assert loop.events.index(("idle",)) < loop.events.index(("poll_wait", 1.0))


@pytest.mark.parametrize("blocked_at", ["guard", "reconciliation", "execution", "database"])
def test_unavailable_scheduling_boundary_keeps_poll_and_never_claims(monkeypatch, blocked_at):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=3)
    if blocked_at == "guard":
        loop.guards.extend([False] * 3)
    elif blocked_at == "reconciliation":
        loop.reconciliations.extend([False] * 3)
    elif blocked_at == "execution":
        loop.execution_leases.extend([False] * 3)
    else:
        loop.reconciliations.extend([SQLAlchemyError("synthetic database unavailable")] * 3)
    loop.run()
    assert loop.wait_count == 3 and loop.completed == 0
    assert not any(event[0] in {"claim", "spawn"} for event in loop.events)


@pytest.mark.parametrize("blocked_at", ["guard", "reconciliation", "execution", "database"])
def test_os_exit_does_not_bypass_next_iterations_failed_boundary(monkeypatch, blocked_at):
    loop = Loop(monkeypatch, jobs=2)
    if blocked_at == "guard":
        loop.guards.extend([True, False, True])
    elif blocked_at == "reconciliation":
        loop.reconciliations.extend([True, False, True])
    elif blocked_at == "execution":
        loop.execution_leases.extend([True, False, True])
    else:
        loop.reconciliations.extend([True, SQLAlchemyError("synthetic database unavailable"), True])
    loop.after_child = lambda: setattr(loop.shutdown, "requested", loop.completed == 2)
    loop.run()
    assert loop.completed == 2 and loop.wait_count == 1
    exited = [index for index, event in enumerate(loop.events) if event[0] == "child_exited"]
    assert any(event == ("poll_wait", 1.0) for event in loop.events[exited[0]:exited[1]])
    assert len([event for event in loop.events if event[0] == "claim"]) == 2


@pytest.mark.parametrize("stop_kind", ["shutdown", "superseded"])
def test_after_child_stop_prevents_any_next_admission(monkeypatch, stop_kind):
    loop = Loop(monkeypatch, jobs=2)
    loop.after_child = lambda: setattr(
        loop.shutdown if stop_kind == "shutdown" else loop.reporter,
        "requested" if stop_kind == "shutdown" else "superseded", True,
    )
    loop.run()
    assert loop.completed == 1
    assert len([event for event in loop.events if event[0] == "claim"]) == 1
    assert len([event for event in loop.events if event[0] == "reconcile"]) == 1


@pytest.mark.parametrize("timeout", [False, True])
def test_busy_queue_still_runs_bounded_single_lane_maintenance_and_checks_lease(monkeypatch, timeout):
    loop = Loop(monkeypatch, jobs=2)
    loop.maintenance_timeout = timeout
    if timeout:
        # A killed helper's OS exit does not prove PostgreSQL teardown.
        loop.execution_leases.extend([True, False, True])

    def after_child():
        if loop.completed == 1:
            loop.clock += 31
        else:
            loop.shutdown.requested = True

    loop.after_child = after_child
    loop.run()
    assert loop.completed == 2
    assert loop.wait_count == (1 if timeout else 0)
    maintenance = [index for index, event in enumerate(loop.events) if event[:2] == ("spawn", "maintenance")]
    assert len(maintenance) == 1
    index = maintenance[0]
    assert loop.events[index + 1] == ("child_wait", "maintenance", 5)
    if timeout:
        assert loop.events[index + 2:index + 6] == [
            ("child_kill", "maintenance"), ("child_wait", "maintenance", 5),
            ("lease_enter", "execution", False), ("poll_wait", 1.0),
        ]
    else:
        assert loop.events[index + 2] == ("lease_enter", "execution", True)


def test_spawn_error_backs_off_instead_of_busy_retrying_claimed_work(monkeypatch):
    loop = Loop(monkeypatch, jobs=1, stop_after_waits=1)
    loop.spawn_error = True
    loop.run()
    assert loop.completed == 0 and loop.wait_count == 1
    assert len([event for event in loop.events if event[0] == "claim"]) == 1
    assert not any(event[0] == "supervise" for event in loop.events)


def test_startup_stop_never_registers_or_queries(monkeypatch):
    loop = Loop(monkeypatch)
    loop.shutdown.requested = True
    supervisor.run_task_worker_forever(shutdown=loop.shutdown)
    assert loop.events == []
