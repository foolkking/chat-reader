"""Exercise real backup/preflight shells with synthetic Docker and archive data."""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

import pytest

ROOT = Path(__file__).resolve().parents[3]
GIT_SH = Path("C:/Program Files/Git/bin/sh.exe")
SH = str(GIT_SH) if os.name == "nt" and GIT_SH.exists() else shutil.which("sh")
pytestmark = pytest.mark.skipif(SH is None, reason="POSIX shell required")
IMAGE = "sha256:" + "a" * 64
CONTAINER = "b" * 64
SCRIPTS = ["preflight_release_space.sh", "backup.sh"]


class Harness(tuple):
    def __repr__(self):
        return "<synthetic operator harness; environment omitted>"


def shell_path(path):
    value = path.as_posix()
    return "/" + value[0].lower() + value[2:] if os.name == "nt" else value


DOCKER = r"""#!/bin/sh
printf '%s\n' "$*" >> "$CALL_LOG"
for last do :; done
case "$*" in
  *" ps -a -q api")
    printf '%s\n' "${SOURCE_CONTAINER-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}" ;;
  inspect\ *)
    case "$*" in
      *".Image"*) printf '%s\n' "${SOURCE_IMAGE-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
      *".Mounts"*)
        for component in imports exports offline assets; do
          test "$component" = "${MISSING_MOUNT:-none}" || printf '/data/%s\n' "$component"
        done ;;
      *) exit 94 ;;
    esac ;;
  image\ inspect\ *)
    test "${IMAGE_MISSING:-0}" = 0 || exit 95
    printf '%s\n' "${LOCAL_IMAGE-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
  run\ *)
    component="${last##*/}"
    test "$component" != "${FAIL_COMPONENT:-none}" || exit 96
    case "$*" in
      *"exec du -sk"*)
        if [ "${BAD_USAGE:-0}" = 1 ]; then echo invalid; else printf '32\t/data/%s\n' "$component"; fi ;;
      *"exec tar -C"*)
        test "$component" != "${FAIL_ARCHIVE:-none}" || exit 97
        exec tar -C "$SYNTHETIC_DATA/$component" -czf - . ;;
      *) exit 98 ;;
    esac ;;
  *" exec -T postgres "*)
    case "$*" in
      *pg_database_size*) printf '1024\n' ;;
      *pg_restore*) printf 'synthetic dump table of contents\n' ;;
      *"--version"*) printf 'pg_dump synthetic shell fixture\n' ;;
      *pg_dump*) printf 'synthetic dump bytes\n' ;;
      *) exit 93 ;;
    esac ;;
  info\ *) printf '%s\n' "$SYNTHETIC_DOCKER_ROOT" ;;
  *) echo 'Unexpected synthetic Docker invocation (build/run fallback refused)' >&2; exit 99 ;;
esac
"""


@pytest.fixture
def harness(tmp_path):
    root = tmp_path / "synthetic task"
    root.mkdir()
    bin_dir = root / "bin"
    bin_dir.mkdir()
    for name, source in (
        ("docker", DOCKER),
        ("df", "#!/bin/sh\nprintf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nsynthetic 99999999 1 99999998 1%% /\\n'\n"),
    ):
        path = bin_dir / name
        path.write_text(source, encoding="utf-8", newline="\n")
        path.chmod(0o755)
    data = root / "data"
    for component in ("imports", "exports", "offline", "assets"):
        folder = data / component
        folder.mkdir(parents=True)
        (folder / "synthetic.txt").write_text("synthetic " + component, encoding="utf-8")
    backups = root / "backups"
    backups.mkdir()
    archive = root / "synthetic release.tar.gz"
    with tarfile.open(archive, "w:gz") as stream:
        body = b"synthetic release"
        info = tarfile.TarInfo("synthetic.txt")
        info.size = len(body)
        stream.addfile(info, io.BytesIO(body))
    log = root / "calls.txt"
    env = {
        **os.environ,
        "TEST_BIN": shell_path(bin_dir),
        "CALL_LOG": shell_path(log),
        "SYNTHETIC_DATA": shell_path(data),
        "SYNTHETIC_DOCKER_ROOT": shell_path(root),
        "COMPOSE_FILE": "synthetic-compose.yml",
        "COMPOSE_ENV_FILE": "synthetic.env",
        "BACKUP_DIR": shell_path(backups),
        "BACKUP_DEDUPLICATE": "0",
        "SOURCE_SHA": "synthetic",
    }
    return Harness((env, log, backups, archive))


def run_script(name, harness, **changes):
    env, log, _, archive = harness
    args = [shell_path(archive)] if name == "preflight_release_space.sh" else []
    result = subprocess.run(
        [SH, "-c", 'PATH="$TEST_BIN:$PATH"; export PATH; exec sh "$@"',
         "synthetic", shell_path(ROOT / "deploy" / name), *args],
        env={**env, **changes}, cwd=ROOT, text=True, encoding="utf-8",
        capture_output=True, timeout=20,
    )
    return result, log.read_text(encoding="utf-8") if log.exists() else ""


def assert_no_service_mutations(calls):
    for line in calls.splitlines():
        if line.startswith("compose "):
            assert " run " not in line
        for command in (" build ", " pull ", " up ", " restart ", " down ", " rm "):
            assert command not in " " + line + " "


@pytest.mark.parametrize("script", SCRIPTS)
def test_existing_source_is_pinned_readonly_and_never_built(harness, script):
    result, calls = run_script(script, harness)
    assert result.returncode == 0, result.stderr
    assert " ps -a -q api" in calls  # stopped-writer backups remain supported
    runs = [line for line in calls.splitlines() if line.startswith("run ")]
    assert len(runs) == (4 if script == SCRIPTS[0] else 8)
    for line in runs:
        for flag in ("--pull=never", "--network none", "--read-only",
                     "--cap-drop ALL", "--security-opt no-new-privileges",
                     "--memory 64m", "--memory-swap 64m", "--pids-limit 32",
                     f"--volumes-from {CONTAINER}:ro", f"--entrypoint sh {IMAGE}"):
            assert flag in line
    assert_no_service_mutations(calls)
    if script == "backup.sh":
        directory, = harness[2].glob("chat-reader-*")
        assert len(list(directory.iterdir())) == 8
        for line in (directory / "SHA256SUMS").read_text().splitlines():
            digest, name = line.split()
            name = name.removeprefix("*")  # Git/MSYS sha256sum binary-mode marker
            assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest
        with tarfile.open(directory / "assets.tar.gz") as stream:
            assert stream.extractfile("./synthetic.txt").read() == b"synthetic assets"


@pytest.mark.parametrize("script", SCRIPTS)
@pytest.mark.parametrize("changes", [
    {"SOURCE_CONTAINER": ""},
    {"SOURCE_CONTAINER": CONTAINER + "\n" + "c" * 64},
    {"SOURCE_CONTAINER": "not-a-container-id"},
    {"SOURCE_IMAGE": "chat-reader-api:latest"},
    {"SOURCE_IMAGE": "sha256:short"},
    {"IMAGE_MISSING": "1"},
    {"LOCAL_IMAGE": "sha256:" + "c" * 64},
    {"MISSING_MOUNT": "assets"},
])
def test_unverifiable_source_fails_before_reading_data(harness, script, changes):
    result, calls = run_script(script, harness, **changes)
    assert result.returncode != 0
    assert not any(line.startswith("run ") for line in calls.splitlines())
    assert " exec -T postgres " not in calls
    assert not list(harness[2].glob("chat-reader-*"))
    assert not (harness[2] / ".backup-operation.lock").exists()
    assert_no_service_mutations(calls)


@pytest.mark.parametrize("script", SCRIPTS)
@pytest.mark.parametrize("changes", [
    {"FAIL_COMPONENT": "exports"},
    {"BAD_USAGE": "1"},
])
def test_failed_size_read_is_not_hidden_by_pipeline(harness, script, changes):
    result, calls = run_script(script, harness, **changes)
    assert result.returncode != 0
    if "FAIL_COMPONENT" in changes:
        assert result.returncode == 96
    assert not list(harness[2].glob("chat-reader-*"))
    assert not (harness[2] / ".backup-operation.lock").exists()
    assert_no_service_mutations(calls)


def test_failed_archive_never_publishes_partial_backup(harness):
    result, calls = run_script("backup.sh", harness, FAIL_ARCHIVE="offline")
    assert result.returncode != 0
    assert not list(harness[2].iterdir())
    assert_no_service_mutations(calls)


@pytest.mark.parametrize("value", ["not-an-integer", "-1", "1.5"])
def test_backup_invalid_headroom_fails_before_docker(harness, value):
    result, calls = run_script("backup.sh", harness, BACKUP_HEADROOM_KB=value)
    assert result.returncode != 0
    assert calls == ""
    assert not list(harness[2].iterdir())


def test_empty_optional_headroom_keeps_the_existing_default(harness):
    result, calls = run_script("backup.sh", harness, BACKUP_HEADROOM_KB="")
    assert result.returncode == 0, result.stderr
    assert_no_service_mutations(calls)
