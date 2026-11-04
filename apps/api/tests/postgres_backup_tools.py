"""Matching-major backup clients for explicitly disposable PostgreSQL fixtures."""
import os
from pathlib import Path
import re
import subprocess

from sqlalchemy.engine import URL


def backup_clients(url: URL, major: int):
    assert url.host in {"localhost", "127.0.0.1", "::1"}, "Backup fixtures must be loopback-only"
    directory = Path(os.environ.get("PG_BIN", f"/usr/lib/postgresql/{major}/bin"))
    suffix = ".exe" if os.name == "nt" else ""
    binaries = {name: directory / f"{name}{suffix}" for name in ("pg_dump", "pg_restore")}
    if all(path.is_file() for path in binaries.values()):
        commands = {name: [str(path)] for name, path in binaries.items()}
        flags = ["-h", url.host, "-p", str(url.port or 5432), "-U", url.username or ""]
    else:
        assert not os.environ.get("PG_BIN"), f"Explicit PG_BIN has missing clients: {directory}"
        run, attempt, job = (os.environ.get(key, "") for key in
                             ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB"))
        assert re.fullmatch(r"[0-9]+", run) and re.fullmatch(r"[0-9]+", attempt) \
            and re.fullmatch(r"[A-Za-z0-9_-]+", job), (
                f"PostgreSQL {major} requires matching clients at {directory} "
                "or the job-owned pinned CI container"
            )
        container = f"chat-reader-ci-postgres-{run}-{attempt}-{job}"
        prefix = ["docker", "exec", "-i", "-e", f"PGPASSWORD={url.password or ''}", container]
        commands = {name: [*prefix, name] for name in binaries}
        # Commands execute inside the fixture. Never use its host-mapped port.
        flags = ["-h", "127.0.0.1", "-p", "5432", "-U", url.username or ""]
    for command in commands.values():
        version = subprocess.check_output([*command, "--version"], text=True, timeout=30)
        assert f"(PostgreSQL) {major}." in version, version
    return commands, flags
