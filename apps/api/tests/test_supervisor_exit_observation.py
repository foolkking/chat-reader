"""Exercise the real supervision loop, with explicit process/DB/clock adapters."""
from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.services import worker_supervisor as supervisor


class Supervision:
    def __init__(self, monkeypatch, *, exits_after=.01, stopping=False, terminate_timeout=False):
        self.clock = 100.0
        self.events = []
        self.end = self.clock + exits_after
        self.returncode = None
        self.terminate_timeout = terminate_timeout
        self.unavailable_after = None
        self.control = SimpleNamespace(
            token=uuid.uuid4(), progress_at=datetime.now(timezone.utc),
            stop_requested_at=None, stop_reason=None, source_disposition=None,
            finished_at=None,
        )
        self.shutdown = SimpleNamespace(requested=stopping)
        self.reporter = SimpleNamespace(superseded=False)
        monkeypatch.setattr(supervisor, "time", SimpleNamespace(monotonic=lambda: self.clock, sleep=self.sleep))
        monkeypatch.setattr(supervisor, "_seconds", lambda _value: 0)
        monkeypatch.setattr(supervisor, "bound_worker_transaction", lambda _db: None)

    def poll(self):
        if self.clock >= self.end:
            self.returncode = 0
        return self.returncode

    def sleep(self, seconds):
        self.events.append(("sleep", seconds))
        self.clock += seconds

    def wait(self, *, timeout):
        self.events.append(("wait", timeout))
        if timeout == 2 and self.terminate_timeout:
            raise supervisor.subprocess.TimeoutExpired("synthetic child", timeout)
        if self.returncode is not None:
            return self.returncode
        if self.end <= self.clock + timeout:
            self.clock = self.end
            self.returncode = 0
            return 0
        self.clock += timeout
        raise supervisor.subprocess.TimeoutExpired("synthetic child", timeout)

    def terminate(self):
        self.events.append(("terminate",))
        if not self.terminate_timeout:
            self.returncode = -15

    def kill(self):
        self.events.append(("kill",))
        self.returncode = -9

    @contextmanager
    def factory(self):
        self.events.append(("database", self.clock))
        if self.unavailable_after is not None and self.clock >= self.unavailable_after:
            raise SQLAlchemyError("synthetic control outage")
        loop = self

        class Query:
            def filter_by(self, **values):
                assert values == {"slot": supervisor.SLOT, "token": loop.control.token}
                return self

            def with_for_update(self, *, skip_locked):
                assert skip_locked is True
                return self

            def one_or_none(self):
                return loop.control

        yield SimpleNamespace(
            query=lambda model: Query(),
            commit=lambda: self.events.append(("control_commit",)),
        )

    def run(self):
        supervisor.supervise(
            self, self.control.token, self.reporter, self.shutdown,
            factory=self.factory, grace_seconds=.3,
        )


def test_process_exit_wakes_supervision_without_an_unconditional_poll_sleep(monkeypatch):
    loop = Supervision(monkeypatch)
    loop.run()
    assert loop.clock == 100.01
    assert [event for event in loop.events if event[0] == "wait"] == [("wait", .25)]
    assert not any(event[0] == "sleep" for event in loop.events)
    # Exit observation does not claim/reconcile anything; the scheduling loop
    # still owns the separate canonical/DB-lease checks tested by the PG suite.
    assert len([event for event in loop.events if event[0] == "database"]) == 1


def test_live_process_keeps_the_original_control_check_interval(monkeypatch):
    loop = Supervision(monkeypatch, exits_after=.52)
    loop.run()
    assert [event for event in loop.events if event[0] == "database"] == [
        ("database", 100.0), ("database", 100.25), ("database", 100.5),
    ]
    assert [event for event in loop.events if event[0] == "wait"] == [("wait", .25)] * 3
    assert not any(event[0] == "sleep" for event in loop.events)


@pytest.mark.parametrize("terminate_timeout", [False, True])
def test_stop_grace_and_terminate_kill_bounds_are_unchanged(monkeypatch, terminate_timeout):
    loop = Supervision(monkeypatch, exits_after=600, stopping=True, terminate_timeout=terminate_timeout)
    loop.run()
    assert loop.clock == 100.5
    assert loop.control.stop_requested_at is not None
    assert ("terminate",) in loop.events
    waits = [event for event in loop.events if event[0] == "wait"]
    assert waits == [("wait", .25), ("wait", .25), ("wait", 2)] + (
        [("wait", 5)] if terminate_timeout else []
    )
    assert (("kill",) in loop.events) == terminate_timeout


def test_observed_stop_grace_does_not_restart_after_control_outage(monkeypatch):
    loop = Supervision(monkeypatch, exits_after=600, stopping=True)
    loop.unavailable_after = 100.25
    loop.run()
    assert loop.clock == 100.5
    assert [event for event in loop.events if event[0] == "terminate"] == [("terminate",)]
    assert [event for event in loop.events if event[0] == "wait"] == [
        ("wait", .25), ("wait", .25), ("wait", 2),
    ]
