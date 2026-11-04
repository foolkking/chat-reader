from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

from postgres_backup_tools import backup_clients


@pytest.fixture
def clients(monkeypatch):
    for name in ("PG_BIN", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB"):
        monkeypatch.delenv(name, raising=False)
    calls = []
    monkeypatch.setattr(Path, "is_file", lambda _: False)
    def version(command, **kwargs):
        calls.append(command)
        return "PostgreSQL client (PostgreSQL) 16.15"
    monkeypatch.setattr("postgres_backup_tools.subprocess.check_output", version)
    return calls


def test_pinned_container_clients_use_internal_port_and_streams(clients, monkeypatch):
    monkeypatch.setenv("GITHUB_RUN_ID", "101")
    monkeypatch.setenv("GITHUB_RUN_ATTEMPT", "2")
    monkeypatch.setenv("GITHUB_JOB", "api-quality")
    tools, flags = backup_clients(make_url("postgresql://synthetic:synthetic@127.0.0.1:65438/test"), 16)
    assert flags == ["-h", "127.0.0.1", "-p", "5432", "-U", "synthetic"]
    for name in ("pg_dump", "pg_restore"):
        assert tools[name] == ["docker", "exec", "-i", "-e", "PGPASSWORD=synthetic",
                               "chat-reader-ci-postgres-101-2-api-quality", name]
        assert [*tools[name], "--version"] in clients


def test_explicit_matching_local_clients_keep_the_selected_port(clients, monkeypatch, tmp_path):
    monkeypatch.setenv("PG_BIN", str(tmp_path))
    monkeypatch.setattr(Path, "is_file", lambda _: True)
    tools, flags = backup_clients(make_url("postgresql://synthetic@127.0.0.1:65439/test"), 16)
    assert len(tools["pg_dump"]) == 1
    assert str(tmp_path) in tools["pg_dump"][0]
    assert flags[flags.index("-p") + 1] == "65439"


@pytest.mark.parametrize("variables", [
    {}, {"GITHUB_RUN_ID": "../other", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_JOB": "api-quality"},
    {"GITHUB_RUN_ID": "101", "GITHUB_RUN_ATTEMPT": "2", "GITHUB_JOB": "api-quality;false"},
    {"PG_BIN": "/missing-explicit-tools"},
])
def test_unavailable_or_unowned_clients_fail_without_running_a_tool(clients, monkeypatch, variables):
    for key, value in variables.items():
        monkeypatch.setenv(key, value)
    with pytest.raises(AssertionError):
        backup_clients(make_url("postgresql://synthetic@127.0.0.1/test"), 16)
    assert clients == []


def test_wrong_client_major_is_not_accepted(clients, monkeypatch):
    monkeypatch.setenv("PG_BIN", "/synthetic-tools")
    monkeypatch.setattr(Path, "is_file", lambda _: True)
    with pytest.raises(AssertionError, match="16.15"):
        backup_clients(make_url("postgresql://synthetic@127.0.0.1/test"), 17)


def test_remote_database_is_never_a_restore_fixture(clients):
    with pytest.raises(AssertionError, match="loopback"):
        backup_clients(make_url("postgresql://synthetic@remote.invalid/test"), 16)
    assert clients == []
