"""Run the real operator shells against synthetic Docker, never production."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[3]
GIT_SH = Path("C:/Program Files/Git/bin/sh.exe")
SH = str(GIT_SH) if os.name == "nt" and GIT_SH.exists() else shutil.which("sh")
pytestmark = pytest.mark.skipif(SH is None, reason="POSIX shell required for operator script tests")

DOCKER = r"""#!/bin/sh
printf '%s\n' "$*" >> "$CALL_LOG"
for last do :; done
case "$*" in
  *" ps -q "*) printf 'synthetic-%s\n' "$last" ;;
  inspect\ *)
    case "$*" in
      *oneoff*) printf '%s\n' "${ONEOFF:-True}" ;;
      *".Image"*)
        case "$last" in
          chat-reader-diagnostics-*) printf '%s\n' "${ONEOFF_IMAGE:-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
          *) printf '%s\n' "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ;;
        esac ;;
      *".State.Running"*) printf 'true\n' ;;
      *".State.Health"*)
        if [ "$last" = "synthetic-${BAD_SERVICE:-none}" ]; then echo unhealthy; else echo healthy; fi ;;
      *) printf '%s\n' "${WORKER_STATUS:-running}" ;;
    esac ;;
  *" exec -T import-worker "*) printf '%s' "${STALE_AFTER-120}" ;;
  *" exec -T -e PGOPTIONS="*)
    test "${QUERY_FAIL:-0}" = 0 || exit 2
    printf '%s' "${HEARTBEAT-alive_idle}" ;;
  ps\ -aq\ *) : ;;
  *" run --rm --no-deps "*)
    test "${HOLD_SECONDS:-0}" = 0 || sleep "$HOLD_SECONDS"
    printf '{"aggregate":1}\n'
    exit "${RUN_EXIT:-0}" ;;
  rm\ -f\ *) : ;;
  *) echo "Unexpected synthetic Docker call" >&2; exit 99 ;;
esac
"""

AWK = r"""#!/bin/sh
if [ -f "$AWK_COUNT" ]; then
  printf '%s\n' "${SECOND_MEM_KB-${MEM_KB-1048576}}"
else
  : > "$AWK_COUNT"
  printf '%s\n' "${MEM_KB-1048576}"
fi
"""


@pytest.fixture
def harness(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, source in (("docker", DOCKER), ("awk", AWK)):
        target = bin_dir / name
        target.write_text(source, encoding="utf-8", newline="\n")
        target.chmod(0o755)
    if os.name == "nt":
        # Git for Windows lacks flock. Real contention is tested on Linux;
        # this stub only permits other shell behavior to run on Windows.
        (bin_dir / "flock").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8", newline="\n")
    log = tmp_path / "calls.txt"
    env = {
        **os.environ,
        "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
        "TEST_BIN": ("/" + bin_dir.as_posix()[0].lower() + bin_dir.as_posix()[2:]) if os.name == "nt" else str(bin_dir),
        "CALL_LOG": log.as_posix(),
        "AWK_COUNT": (tmp_path / "awk-count").as_posix(),
        "DIAGNOSTICS_LOCK_FILE": (tmp_path / "diagnostics.lock").as_posix(),
        "COMPOSE_FILE": "synthetic-compose.yml",
        "COMPOSE_ENV_FILE": "synthetic.env",
    }
    return env, log


def shell_command(path):
    # MSYS prepends its own utilities at startup; put synthetic tools first
    # inside the shell as well, so tests cannot accidentally call real Docker.
    return [SH, "-c", 'PATH="$TEST_BIN:$PATH"; export PATH; exec sh "$1"', "test", str(path)]


def run_script(name, harness, **changes):
    env, log = harness
    result = subprocess.run(
        shell_command(ROOT / "deploy" / name), env={**env, **changes},
        cwd=ROOT, text=True, encoding="utf-8", capture_output=True, timeout=12,
    )
    return result, log.read_text(encoding="utf-8") if log.exists() else ""


@pytest.mark.parametrize("heartbeat", ["alive_idle", "alive_busy"])
def test_health_reads_only_bounded_readonly_singleton(harness, heartbeat):
    result, calls = run_script("verify_runtime_health.sh", harness, HEARTBEAT=heartbeat, STALE_AFTER="300")
    assert result.returncode == 0, result.stderr
    assert heartbeat in result.stdout
    assert "default_transaction_read_only=on" in calls
    assert "statement_timeout=5000" in calls
    assert "lock_timeout=1000" in calls
    assert "psql -X -q -v ON_ERROR_STOP=1" in calls
    assert "FROM worker_runtime_states WHERE worker_key = 'primary'" in calls
    assert "make_interval(secs => 300)" in calls
    assert "heartbeat_at > CURRENT_TIMESTAMP" in calls
    assert "heartbeat_at <=" in calls
    assert "internal_diagnostics" not in calls
    assert " exec -T api " not in calls
    assert "python" not in calls


@pytest.mark.parametrize("changes", [
    {"HEARTBEAT": "stale"}, {"HEARTBEAT": "unavailable"}, {"HEARTBEAT": ""},
    {"HEARTBEAT": "alive_idle\nalive_busy"}, {"QUERY_FAIL": "1"},
    {"STALE_AFTER": "120); SELECT 1;--"}, {"STALE_AFTER": ""},
    {"STALE_AFTER": "0"}, {"STALE_AFTER": "86401"}, {"STALE_AFTER": "9" * 80},
    {"WORKER_STATUS": "exited"}, {"BAD_SERVICE": "api"},
    {"BAD_SERVICE": "web"}, {"BAD_SERVICE": "postgres"},
])
def test_health_fails_closed_on_unknown_or_invalid_state(harness, changes):
    result, calls = run_script("verify_runtime_health.sh", harness, **changes)
    assert result.returncode != 0
    assert "Runtime services and worker heartbeat are healthy" not in result.stdout
    assert "internal_diagnostics" not in calls
    assert "python" not in calls


@pytest.mark.parametrize("available", ["", "unknown", "524287", "0"])
def test_full_report_low_or_unknown_ram_never_calls_docker(harness, available):
    result, calls = run_script("run_internal_diagnostics.sh", harness, MEM_KB=available)
    assert result.returncode == 75, result.stderr
    assert calls == ""
    assert "deferred" in result.stderr


@pytest.mark.parametrize("exit_code", ["0", "124", "137"])
def test_full_report_uses_current_image_oneoff_and_owns_its_cleanup(harness, exit_code):
    result, calls = run_script("run_internal_diagnostics.sh", harness, RUN_EXIT=exit_code)
    assert result.returncode == int(exit_code), result.stderr
    assert "-f " in calls and "diagnostics.resources.yml run --rm --no-deps -T --name chat-reader-diagnostics-" in calls
    assert "-e CHAT_READER_DIAGNOSTICS_ISOLATED=1 api python -m scripts.internal_diagnostics" in calls
    assert "rm -f chat-reader-diagnostics-" in calls
    assert "rm -f synthetic-api" not in calls
    assert " exec " not in calls and " up " not in calls and " restart " not in calls
    assert " down " not in calls and " build " not in calls


def test_changed_headroom_after_lock_does_not_start_report(harness):
    result, calls = run_script("run_internal_diagnostics.sh", harness, SECOND_MEM_KB="1")
    assert result.returncode == 75
    assert " run --rm " not in calls


def test_cleanup_never_removes_a_non_oneoff(harness):
    result, calls = run_script("run_internal_diagnostics.sh", harness, ONEOFF="False")
    assert result.returncode == 0, result.stderr
    assert "rm -f" not in calls


def test_cleanup_never_removes_an_unexpected_image(harness):
    result, calls = run_script("run_internal_diagnostics.sh", harness, ONEOFF_IMAGE="sha256:unexpected")
    assert result.returncode == 0, result.stderr
    assert "rm -f" not in calls


@pytest.mark.skipif(os.name == "nt", reason="host-wide flock is a Linux production requirement")
def test_different_release_copies_share_one_lock(harness, tmp_path):
    env, log = harness
    copies = []
    for name in ("release-a", "release-b"):
        folder = tmp_path / name
        folder.mkdir()
        for source in ("run_internal_diagnostics.sh", "diagnostics.resources.yml"):
            shutil.copyfile(ROOT / "deploy" / source, folder / source)
        copies.append(folder / "run_internal_diagnostics.sh")
    first = subprocess.Popen(
        shell_command(copies[0]), env={**env, "HOLD_SECONDS": "3"},
        text=True, encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    try:
        # Wait for the first synthetic report, not for a guessed scheduling delay.
        import time
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if log.exists() and " run --rm " in log.read_text(encoding="utf-8"):
                break
            time.sleep(0.02)
        else:
            pytest.fail("first synthetic report did not acquire its lock")
        second = subprocess.run(
            shell_command(copies[1]), env=env, capture_output=True, text=True,
            encoding="utf-8", timeout=5,
        )
        assert second.returncode == 75, second.stderr
        assert "already running" in second.stderr
    finally:
        first.communicate(timeout=8)
    assert first.returncode == 0
    assert log.read_text(encoding="utf-8").count(" run --rm ") == 1


def test_oneoff_resource_overlay_is_not_a_serving_api_limit():
    overlay = (ROOT / "deploy" / "diagnostics.resources.yml").read_text(encoding="utf-8")
    for value in (
        "pull_policy: never", "mem_limit: 256m", "memswap_limit: 384m",
        "cpus: 0.5", 'restart: "no"', "read_only: true",
        "import-storage:/data/imports:ro", "asset-storage:/data/assets:ro",
    ):
        assert value in overlay
    wrapper = (ROOT / "deploy" / "run_internal_diagnostics.sh").read_text(encoding="utf-8")
    assert "timeout -k 5s 35s" in wrapper
    assert 'API_IMAGE="$(docker inspect' in wrapper
    assert "/run/lock/chat-reader-internal-diagnostics.lock" in wrapper
