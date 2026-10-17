from __future__ import annotations

import builtins
import signal
import subprocess
import sys
import textwrap
import uuid
from types import SimpleNamespace

import pytest

from app.services import task_worker
from app.workers import import_worker
from app.workers import shutdown as shutdown_module


class _Reporter:
    def __init__(self, **kwargs) -> None:
        self.events: list[str] = []
        self.superseded = False

    def start(self) -> None:
        self.events.append("start")

    def stop(self) -> None:
        self.events.append("stop")

    def set_idle(self) -> bool:
        self.events.append("idle")
        return True

    def set_busy(self, task_kind: str, task_id: uuid.UUID) -> bool:
        self.events.append("busy")
        return True


def _loop_fixture(monkeypatch):
    reporter = _Reporter()
    monkeypatch.setattr(task_worker, "WorkerHeartbeatReporter", lambda **kwargs: reporter)
    monkeypatch.setattr(
        task_worker,
        "get_settings",
        lambda: SimpleNamespace(
            worker_heartbeat_interval_seconds=30,
            import_worker_poll_seconds=60,
            export_storage_dir="synthetic-exports",
        ),
    )
    return reporter


@pytest.mark.parametrize("signum", [signal.SIGTERM, signal.SIGINT])
def test_entrypoint_handles_real_python_stop_signal_and_restores_handlers(monkeypatch, signum) -> None:
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    requests: list[bool] = []

    def fake_loop(*, shutdown) -> None:
        assert not shutdown.requested
        signal.raise_signal(signum)
        requests.append(shutdown.requested)
        # Repeated signals must not interrupt draining work.
        signal.raise_signal(signum)
        assert shutdown.requested

    monkeypatch.setattr(task_worker, "run_task_worker_forever", fake_loop)
    import_worker.main()
    assert requests == [True]
    assert {sig: signal.getsignal(sig) for sig in previous} == previous


def test_entrypoint_restores_handlers_when_worker_fails(monkeypatch) -> None:
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}

    def fail_loop(*, shutdown) -> None:
        raise RuntimeError("synthetic worker failure")

    monkeypatch.setattr(task_worker, "run_task_worker_forever", fail_loop)
    with pytest.raises(RuntimeError, match="synthetic worker failure"):
        import_worker.main()
    assert {sig: signal.getsignal(sig) for sig in previous} == previous


def test_entrypoint_restores_first_handler_if_second_registration_fails(monkeypatch) -> None:
    previous = signal.getsignal(signal.SIGTERM)
    install = signal.signal

    def install_with_failure(signum, handler):
        if signum == signal.SIGINT:
            raise RuntimeError("synthetic signal registration failure")
        return install(signum, handler)

    monkeypatch.setattr(import_worker.signal, "signal", install_with_failure)
    with pytest.raises(RuntimeError, match="synthetic signal registration failure"):
        import_worker.main()
    assert signal.getsignal(signal.SIGTERM) == previous


def test_stopped_worker_does_not_enter_iteration(monkeypatch) -> None:
    reporter = _loop_fixture(monkeypatch)
    shutdown = task_worker.WorkerShutdown()
    shutdown.request(signal.SIGTERM, None)
    monkeypatch.setattr(
        task_worker, "run_task_worker_iteration", lambda *args, **kwargs: pytest.fail("claimed after stop"),
    )
    task_worker.run_task_worker_forever(shutdown=shutdown)
    assert reporter.events == []


def test_stop_during_service_import_is_remembered_before_any_worker_registration(monkeypatch) -> None:
    reporter = _loop_fixture(monkeypatch)
    original_import = builtins.__import__
    imports: list[bool] = []

    def controlled_import(name, *args, **kwargs):
        if name == "app.services.task_worker":
            imports.append(True)
            signal.raise_signal(signal.SIGTERM)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", controlled_import)
    import_worker.main()
    assert imports == [True]
    assert reporter.events == []


def test_active_iteration_drains_before_reporter_stops_and_no_second_claim(monkeypatch) -> None:
    reporter = _loop_fixture(monkeypatch)
    shutdown = task_worker.WorkerShutdown()
    events: list[str] = []

    def iteration(settings, active_reporter, *, shutdown) -> bool:
        assert active_reporter is reporter
        events.append("active")
        shutdown.request(signal.SIGTERM, None)
        assert reporter.events == ["start"]
        events.append("finished")
        return True

    monkeypatch.setattr(task_worker, "run_task_worker_iteration", iteration)
    task_worker.run_task_worker_forever(shutdown=shutdown)
    assert events == ["active", "finished"]
    assert reporter.events == ["start", "stop"]


def test_idle_wait_retains_poll_deadline_but_observes_stop_within_one_slice(monkeypatch) -> None:
    shutdown = task_worker.WorkerShutdown()
    sleeps: list[float] = []
    monkeypatch.setattr(shutdown_module.time, "monotonic", lambda: 100.0)

    def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        shutdown.request(signal.SIGTERM, None)

    monkeypatch.setattr(shutdown_module.time, "sleep", sleep)
    shutdown.wait(60)
    assert sleeps == [0.25]


def test_idle_loop_does_not_start_another_iteration_after_stop(monkeypatch) -> None:
    reporter = _loop_fixture(monkeypatch)
    shutdown = task_worker.WorkerShutdown()
    iterations: list[bool] = []
    monkeypatch.setattr(
        task_worker, "run_task_worker_iteration",
        lambda *args, **kwargs: iterations.append(True) or False,
    )
    monkeypatch.setattr(
        shutdown_module.time, "sleep", lambda seconds: shutdown.request(signal.SIGTERM, None),
    )
    task_worker.run_task_worker_forever(shutdown=shutdown)
    assert iterations == [True]
    assert reporter.events == ["start", "stop"]


def test_idle_wait_does_not_poll_database_faster_than_configured(monkeypatch) -> None:
    shutdown = task_worker.WorkerShutdown()
    clock = [0.0]
    sleeps: list[float] = []
    monkeypatch.setattr(shutdown_module.time, "monotonic", lambda: clock[0])

    def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        clock[0] += seconds

    monkeypatch.setattr(shutdown_module.time, "sleep", sleep)
    shutdown.wait(0.6)
    assert sum(sleeps) == pytest.approx(0.6)
    assert all(0 < seconds <= 0.25 for seconds in sleeps)
    assert not shutdown.requested


def test_reporter_stops_if_startup_fails(monkeypatch) -> None:
    reporter = _loop_fixture(monkeypatch)

    def start() -> None:
        reporter.events.append("start")
        raise RuntimeError("synthetic startup failure")

    monkeypatch.setattr(reporter, "start", start)
    with pytest.raises(RuntimeError, match="synthetic startup failure"):
        task_worker.run_task_worker_forever(shutdown=task_worker.WorkerShutdown())
    assert reporter.events == ["start", "stop"]


@pytest.mark.skipif(sys.platform == "win32", reason="Windows send_signal(SIGTERM) forcibly terminates, unlike POSIX")
@pytest.mark.parametrize("signum", [signal.SIGTERM, signal.SIGINT])
@pytest.mark.parametrize("busy", [False, True])
def test_posix_process_observes_external_stop_and_exits_successfully(signum, busy) -> None:
    source = textwrap.dedent(
        """
        import sys, time
        from types import SimpleNamespace
        from app.services import task_worker
        from app.workers import import_worker

        class Reporter:
            superseded = False
            stopped = False
            def __init__(self, **kwargs): pass
            def start(self): print("START", flush=True)
            def stop(self):
                self.stopped = True
                print("STOP", flush=True)

        reporter = Reporter()
        task_worker.WorkerHeartbeatReporter = lambda **kwargs: reporter
        task_worker.get_settings = lambda: SimpleNamespace(
            worker_heartbeat_interval_seconds=30,
            import_worker_poll_seconds=60,
            export_storage_dir="synthetic-unused-exports",
        )
        def iteration(settings, active_reporter, *, shutdown):
            print("READY", flush=True)
            if sys.argv[1] == "busy":
                deadline = time.monotonic() + 5
                while not shutdown.requested:
                    assert time.monotonic() < deadline
                    time.sleep(0.01)
                assert not reporter.stopped
                print("DRAINED", flush=True)
                return True
            return False
        task_worker.run_task_worker_iteration = iteration
        import_worker.main()
        """
    )
    process = subprocess.Popen(
        [sys.executable, "-u", "-c", source, "busy" if busy else "idle"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        assert process.stdout is not None
        assert process.stdout.readline().strip() == "START"
        assert process.stdout.readline().strip() == "READY"
        process.send_signal(signum)
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stderr
        assert stdout.splitlines() == (["DRAINED", "STOP"] if busy else ["STOP"])
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)


@pytest.mark.parametrize("task_kind", ["job", "noise", "import"])
@pytest.mark.parametrize("stop_at", ["before_iteration", "before_claim", "after_claim", "before_process", "processing"])
def test_shutdown_claim_boundaries_preserve_unstarted_work_and_drain_started_work(
    monkeypatch, task_kind, stop_at,
) -> None:
    shutdown = task_worker.WorkerShutdown()
    reporter = _Reporter()
    task_id = uuid.uuid4()
    events: list[object] = []
    expected_worker_kind = "job" if task_kind == "noise" else task_kind

    class Session:
        def __enter__(self):
            events.append("session")
            return self

        def __exit__(self, *args) -> None:
            return None

        def commit(self) -> None:
            events.append("commit")
            if stop_at == "after_claim":
                shutdown.request(signal.SIGTERM, None)

    def oldest(db):
        if stop_at == "before_claim":
            shutdown.request(signal.SIGTERM, None)
        return task_kind

    def claim(db, **kwargs):
        events.append("claim")
        return task_id

    def busy(kind, ident):
        assert (kind, ident) == (expected_worker_kind, task_id)
        reporter.events.append("busy")
        if stop_at == "before_process":
            shutdown.request(signal.SIGTERM, None)
        return True

    def process(ident):
        assert ident == task_id
        events.append("process")
        if stop_at == "processing":
            shutdown.request(signal.SIGTERM, None)
            assert "stop" not in reporter.events
        events.append("completed")

    monkeypatch.setattr(task_worker, "SessionLocal", Session)
    monkeypatch.setattr("app.services.context_return_jobs.expire_context_returns", lambda db: [])
    monkeypatch.setattr(task_worker, "recover_stale_imports", lambda *args: 0)
    monkeypatch.setattr(task_worker, "recover_stale_jobs", lambda *args: 0)
    monkeypatch.setattr(task_worker, "_oldest_task_kind", oldest)
    monkeypatch.setattr(task_worker, "claim_next_job", claim)
    monkeypatch.setattr(task_worker, "claim_next_import", claim)
    monkeypatch.setattr(task_worker, "process_import", process)
    monkeypatch.setattr(task_worker, "process_background_job", process)
    monkeypatch.setattr(reporter, "set_busy", busy)
    monkeypatch.setattr(task_worker, "_requeue_unstarted_task", lambda kind, ident: events.append(("requeue", kind, ident)))
    if stop_at == "before_iteration":
        shutdown.request(signal.SIGTERM, None)
    processed = task_worker.run_task_worker_iteration(
        SimpleNamespace(import_stale_after_seconds=300), reporter, shutdown=shutdown,
    )
    if stop_at in {"before_iteration", "before_claim"}:
        assert not processed
        assert "claim" not in events
        assert "process" not in events
        assert not any(isinstance(event, tuple) for event in events)
    elif stop_at in {"after_claim", "before_process"}:
        assert not processed
        assert "process" not in events
        assert events.count(("requeue", expected_worker_kind, task_id)) == 1
    else:
        assert processed
        assert events[-2:] == ["process", "completed"]
        assert not any(isinstance(event, tuple) for event in events)
    if stop_at in {"before_process", "processing"}:
        assert reporter.events[-1] == "idle"
