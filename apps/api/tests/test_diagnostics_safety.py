"""Admission happens before the expensive diagnostic import graph."""
from __future__ import annotations

import builtins
import io
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

from app.core import memory
from scripts import internal_diagnostics as cli


@pytest.mark.parametrize("line,expected", [
    ("MemAvailable: 1234 kB\n", 1234 * 1024),
    ("MemFree: 1234 kB\n", None),
    ("MemAvailable: broken kB\n", None),
    ("MemAvailable:\n", None),
])
def test_linux_memory_probe_is_cheap_and_unknown_safe(monkeypatch, line, expected):
    monkeypatch.setattr(memory, "sys", SimpleNamespace(platform="linux"))
    monkeypatch.setattr(memory, "open", lambda *a, **k: io.StringIO(line), raising=False)
    assert memory.available_memory_bytes() == expected


def test_memory_probe_io_failure_is_unknown(monkeypatch):
    monkeypatch.setattr(memory, "sys", SimpleNamespace(platform="linux"))

    def denied(*a, **k):
        raise PermissionError("synthetic private path")

    monkeypatch.setattr(memory, "open", denied, raising=False)
    assert memory.available_memory_bytes() is None


@pytest.mark.parametrize("argv,serving", [
    (b"/usr/local/bin/python\0/usr/local/bin/uvicorn\0app.main:app\0", True),
    (b"python\0-m\0uvicorn\0", True),
    (b"/usr/local/bin/gunicorn\0app.main:app\0", True),
    (b"python\0-m\0scripts.internal_diagnostics\0", False),
])
def test_serving_pid1_detection(monkeypatch, argv, serving):
    monkeypatch.setattr(cli, "sys", SimpleNamespace(platform="linux"))
    monkeypatch.setattr(Path, "read_bytes", lambda self: argv)
    assert cli.serving_container() is serving


def test_unreadable_linux_pid1_fails_closed(monkeypatch):
    monkeypatch.setattr(cli, "sys", SimpleNamespace(platform="linux"))

    def denied(self):
        raise PermissionError

    monkeypatch.setattr(Path, "read_bytes", denied)
    assert cli.serving_container() is True


@pytest.mark.parametrize("serving,isolated,available,expected", [
    (True, "1", 1024**3, 2),
    (True, "", 1024**3, 2),
    (False, "", 1024**3, 75),
    (False, "1", None, 75),
    (False, "1", 384 * 1024**2 - 1, 75),
])
def test_cli_refuses_before_heavy_imports(monkeypatch, capsys, serving, isolated, available, expected):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CHAT_READER_DIAGNOSTICS_ISOLATED", isolated)
    monkeypatch.setattr(cli, "serving_container", lambda: serving)
    monkeypatch.setattr(cli, "available_memory_bytes", lambda: available)
    original = builtins.__import__

    def guarded(name, *args, **kwargs):
        assert name not in {"app.core.config", "app.core.database", "app.services.diagnostics"}
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded)
    assert cli.main() == expected
    output = capsys.readouterr()
    assert output.out == ""
    payload = json.loads(output.err)
    assert payload["status"] == "unavailable"
    assert payload["use"] == "deploy/run_internal_diagnostics.sh"


@pytest.mark.parametrize("fail", [False, True])
def test_isolated_cli_rolls_back_and_cancels_deadline(monkeypatch, capsys, fail):
    from app.core import config, database
    from app.services import diagnostics

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CHAT_READER_DIAGNOSTICS_ISOLATED", "1")
    monkeypatch.setattr(cli, "serving_container", lambda: False)
    monkeypatch.setattr(cli, "available_memory_bytes", lambda: 1024**3)
    monkeypatch.setattr(cli, "sys", SimpleNamespace(platform="linux", stderr=sys.stderr))
    alarms = []
    monkeypatch.setattr(cli, "signal", SimpleNamespace(
        SIGALRM=14, signal=lambda *args: None, alarm=alarms.append,
    ))
    events = []

    class Session:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            events.append("close")

        def rollback(self):
            events.append("rollback")

    def collect(db, settings):
        if fail:
            raise RuntimeError("synthetic private DSN and storage identity")
        return {"aggregate": 3}

    monkeypatch.setattr(database, "SessionLocal", Session)
    monkeypatch.setattr(config, "get_settings", lambda: object())
    monkeypatch.setattr(diagnostics, "collect_diagnostics", collect)
    assert cli.main() == (1 if fail else 0)
    assert alarms == [25, 0]
    assert events == (["close"] if fail else ["rollback", "close"])
    output = capsys.readouterr()
    if fail:
        assert output.out == ""
        assert json.loads(output.err) == {"status": "unavailable", "reason": "BOUNDED_DIAGNOSTICS_FAILED"}
        assert "synthetic private" not in output.err
    else:
        assert json.loads(output.out) == {"aggregate": 3}
        assert output.err == ""


def test_cli_deadline_interrupts_report():
    with pytest.raises(TimeoutError):
        cli._deadline(14, None)
