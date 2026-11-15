"""Pure failed-gate projection controls, without fake CI or Docker execution."""
import importlib.util
from pathlib import Path
import subprocess

import pytest


@pytest.fixture
def gate():
    path = Path(__file__).resolve().parents[3] / "scripts/ci/small-import-memory-gate.py"
    spec = importlib.util.spec_from_file_location("memory_failure_evidence_controls", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_failed_observations_do_not_turn_into_a_memory_pass(gate):
    report = {"passed": False, "revision": "synthetic"}
    memory = {"current": 150_000_000, "peak": 160_000_000, "oom": 0, "oom_kill": 0}
    task = {"resource_wait": {"reason": "UPLOAD_MEMORY_PRESSURE"}, "analysis": "queued"}
    gate.capture_failure_evidence(
        report, "analysis_wait", RuntimeError("must-not-persist"),
        (("failure_memory_measurement", lambda: memory), ("task_diagnostics", lambda: task)),
    )
    assert report["passed"] is False
    assert report["failure"] == {"stage": "analysis_wait", "error_class": "RuntimeError"}
    assert report["failure_memory_measurement"] is memory
    assert report["task_diagnostics"] is task
    assert "must-not-persist" not in str(report)
    assert "workspace_peak_delta_bytes" not in report


@pytest.mark.parametrize("error", [
    RuntimeError("private source or credential"),
    subprocess.TimeoutExpired(["must-not-persist"], 15),
    ValueError("private malformed payload"),
])
def test_unavailable_failure_probe_has_no_invented_zero_and_does_not_hide_other_probes(gate, error):
    def unavailable():
        raise error

    observed = {"running": False, "oom_killed": True, "restarts": 0}
    report = {"passed": False}
    gate.capture_failure_evidence(
        report, "commit_wait", RuntimeError("unavailable task"),
        (("failure_memory_measurement", unavailable), ("failure_worker_state", lambda: observed)),
    )
    assert report["passed"] is False
    assert "failure_memory_measurement" not in report
    assert report["diagnostic_errors"] == {"failure_memory_measurement": type(error).__name__}
    assert report["failure_worker_state"] is observed
    assert "private" not in str(report) and "must-not-persist" not in str(report)


def test_failure_before_worker_start_does_not_invent_worker_or_sensor_evidence(gate):
    report = {"passed": False}
    gate.capture_failure_evidence(report, "migration", RuntimeError("private"), ())
    assert report == {
        "passed": False,
        "failure": {"stage": "migration", "error_class": "RuntimeError"},
    }
