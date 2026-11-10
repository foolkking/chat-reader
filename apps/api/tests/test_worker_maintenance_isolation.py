"""Synthetic threading/transaction boundaries, never production jobs or files."""
import threading

import pytest

from app.services.worker_liveness import WorkerHeartbeatReporter
from app.services.worker_maintenance import run_worker_maintenance


def test_slow_maintenance_does_not_stop_heartbeats_or_start_parallel_cleanup(monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    next_heartbeats = threading.Event()
    pulses = []
    callbacks = []

    def maintenance():
        callbacks.append(threading.get_ident())
        entered.set()
        assert release.wait(3), "Synthetic cleanup was not released."

    reporter = WorkerHeartbeatReporter(interval_seconds=0.01, maintenance=maintenance)

    def pulse():
        reporter._registered = True
        pulses.append(threading.get_ident())
        if entered.is_set() and len(pulses) >= 4:
            next_heartbeats.set()
        return True

    monkeypatch.setattr(reporter, "pulse", pulse)
    reporter.start()
    try:
        assert entered.wait(1)
        assert next_heartbeats.wait(0.5), "Slow maintenance prevented subsequent heartbeats."
        assert len(callbacks) == 1, "Heartbeats queued overlapping maintenance."
        assert callbacks[0] != pulses[-1], "Maintenance still owns the heartbeat thread."
    finally:
        reporter._stop_event.set()
        release.set()
        reporter.stop()


def test_maintenance_exception_does_not_end_subsequent_maintenance_or_pulses(monkeypatch):
    recovered = threading.Event()
    calls = []
    reporter = None

    def maintenance():
        calls.append(True)
        if len(calls) == 1:
            raise OSError("synthetic private path must not be logged")
        recovered.set()

    reporter = WorkerHeartbeatReporter(interval_seconds=0.01, maintenance=maintenance)

    def pulse():
        reporter._registered = True
        return True

    monkeypatch.setattr(reporter, "pulse", pulse)
    reporter.start()
    try:
        assert recovered.wait(1)
    finally:
        reporter.stop()
    assert len(calls) >= 2


def test_superseded_worker_cannot_launch_new_cleanup(monkeypatch):
    calls = []
    reporter = WorkerHeartbeatReporter(interval_seconds=0.01, maintenance=lambda: calls.append(True))

    def pulse():
        reporter._superseded = True
        return False

    monkeypatch.setattr(reporter, "pulse", pulse)
    reporter.start()
    reporter.stop()
    assert calls == []


@pytest.mark.parametrize("reason", ["unregistered", "heartbeat_failed", "superseded", "stopping"])
def test_unavailable_worker_cannot_request_maintenance(reason):
    reporter = WorkerHeartbeatReporter(interval_seconds=0.01)
    reporter._registered = reason != "unregistered"
    reporter._worker_failure_active = reason == "heartbeat_failed"
    reporter._superseded = reason == "superseded"
    if reason == "stopping":
        reporter.stop()
    assert not reporter.maintenance_allowed


def test_stop_is_bounded_and_does_not_queue_cleanup_after_blocked_operation(monkeypatch):
    entered = threading.Event()
    release = threading.Event()
    calls = []
    reporter = WorkerHeartbeatReporter(interval_seconds=0.01)

    def pulse():
        reporter._registered = True
        return True

    def maintenance():
        calls.append(True)
        entered.set()
        assert release.wait(5)
        # A running OS call can finish, but the next item must not start.
        assert not reporter.maintenance_allowed

    reporter._maintenance = maintenance
    monkeypatch.setattr(reporter, "pulse", pulse)
    reporter.start()
    try:
        assert entered.wait(1)
        reporter.stop()
        assert reporter._maintenance_thread.is_alive()
        assert not reporter._thread.is_alive()
        assert not reporter.maintenance_allowed
    finally:
        release.set()
        reporter.stop()
    assert not reporter._maintenance_thread.is_alive()
    assert calls == [True]


def test_maintenance_family_failure_is_isolated_and_private(monkeypatch, tmp_path, caplog):
    from app.services import export_retention
    from app.services.sharing import share_service

    calls = []

    def exports(*args, **kwargs):
        assert kwargs["limit"] == 20 and kwargs["should_continue"]()
        calls.append("export")
        raise OSError("private/source/path")

    def shares(*args, **kwargs):
        assert kwargs["limit"] == 20 and kwargs["should_continue"]()
        calls.append("share")

    monkeypatch.setattr(export_retention, "reclaim_exports", exports)
    monkeypatch.setattr(share_service, "reclaim_expired_frozen_snapshots", shares)
    run_worker_maintenance(None, tmp_path, should_continue=lambda: True)
    assert calls == ["export", "share"]
    assert "worker_maintenance_failed" in caplog.text
    assert "private/source/path" not in caplog.text


def test_budget_exhaustion_defers_and_rotating_first_family_prevents_starvation(monkeypatch, tmp_path):
    from app.services import export_retention
    from app.services.sharing import share_service

    clock = [0.0]
    calls = []

    def exports(*args, **kwargs):
        calls.append("export")
        clock[0] += 2
        assert not kwargs["should_continue"]()

    monkeypatch.setattr(export_retention, "reclaim_exports", exports)
    monkeypatch.setattr(share_service, "reclaim_expired_frozen_snapshots", lambda *args, **kwargs: calls.append("share"))
    run_worker_maintenance(None, tmp_path, should_continue=lambda: True, monotonic=lambda: clock[0])
    assert calls == ["export"]
    run_worker_maintenance(None, tmp_path, should_continue=lambda: True, monotonic=lambda: clock[0], exports_first=False)
    assert calls == ["export", "share", "export"]
    run_worker_maintenance(None, tmp_path, should_continue=lambda: False)
    assert calls == ["export", "share", "export"]
