#!/usr/bin/env python3
"""Run the exact release worker with real 320-MiB cgroup admission, no swap.

All resources belong to this disposable CI job. Control-plane ORM processes
run in separate containers; no diagnostic Python process enters the worker.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path

MIB = 1024**2


def docker(*args: str, timeout: int = 120) -> str:
    try:
        return subprocess.run(["docker", *args], check=True, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except subprocess.CalledProcessError as exc:
        # This gate refuses serving resources; its bounded diagnostics contain
        # only disposable synthetic fixture data, never production inputs.
        raise RuntimeError("Disposable Docker operation failed:\n" + exc.stderr[-4000:]) from None


def main() -> None:
    revision = os.environ.get("GITHUB_SHA", "")
    owner = ":".join(os.environ.get(key, "") for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB"))
    if os.environ.get("CI") != "true" or not re.fullmatch(r"[a-f0-9]{40}", revision) or not re.fullmatch(r"\d+:\d+:[a-zA-Z0-9_-]+", owner):
        raise SystemExit("A disposable GitHub CI job and exact revision are required.")
    name = "chat-reader-small-zip-" + owner.replace(":", "-")
    volume = name + "-data"
    label = "chat-reader.ci-small-zip"
    image = "chat-reader-api:" + revision
    if docker("image", "inspect", "-f", '{{ index .Config.Labels "org.opencontainers.image.revision" }}', image) != revision:
        raise SystemExit("Worker image does not match the source under test.")
    report = {"revision": revision, "passed": False, "real_sensor": True,
              "memory_limit_bytes": 320 * MIB, "memory_swap_limit_bytes": 320 * MIB}
    common = [
        "--network", "host", "--volume", volume + ":/data",
        "--env", "DATABASE_URL=postgresql+psycopg://chat_reader:chat_reader_ci@127.0.0.1:5432/chat_reader",
        "--env", "APP_ENV=test", "--env", "SMALL_IMPORT_MEMORY_GATE=1",
        "--env", "IMPORT_SMALL_ZIP_ENABLED=true", "--env", "ALLOW_UNSCANNED_ATTACHMENTS=true",
        "--env", "IMPORT_STORAGE_DIR=/data/imports", "--env", "ASSET_STORAGE_DIR=/data/assets",
        "--env", "EXPORT_STORAGE_DIR=/data/exports", "--env", "OFFLINE_STORAGE_DIR=/data/offline",
        "--env", "IMPORT_WORKER_POLL_SECONDS=0.25", "--env", "WORKER_HEARTBEAT_INTERVAL_SECONDS=1",
    ]
    created_volume = created_worker = False

    def helper(action: str) -> dict:
        output = docker("run", "--rm", *common, image, "python", "-m", "scripts.verify_small_zip_memory", action)
        return json.loads(output.splitlines()[-1])

    def wait_for(predicate, *, timeout: int = 180) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            status = helper("status")
            if status["analysis"] in {"failed", "cancelled"} or status["import"] == "failed":
                raise RuntimeError("The real constrained worker failed: " + str(status.get("failure_code") or "TASK_FAILED"))
            if predicate(status):
                return status
            time.sleep(1)
        raise RuntimeError("The constrained worker exceeded its bounded deadline.")

    def memory_stats() -> dict:
        # Each cat executes in the existing cgroup with negligible memory; no
        # ORM/interpreter, no monkeypatch and no synthetic MemAvailable value.
        raw = docker("exec", name, "sh", "-c", """
if [ -f /sys/fs/cgroup/memory.current ]; then
  cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events
else
  cat /sys/fs/cgroup/memory/memory.usage_in_bytes /sys/fs/cgroup/memory/memory.max_usage_in_bytes /sys/fs/cgroup/memory/memory.failcnt
fi
""")
        lines = raw.splitlines()
        if len(lines) == 3 and " " not in lines[2]:
            return {"current": int(lines[0]), "peak": int(lines[1]),
                    "oom": 0, "oom_kill": 0, "failcnt": int(lines[2])}
        events = dict(line.split() for line in lines[2:])
        return {"current": int(lines[0]), "peak": int(lines[1]),
                "oom": int(events.get("oom", 0)), "oom_kill": int(events.get("oom_kill", 0)),
                "failcnt": 0}

    try:
        # Refuse collisions rather than deleting or replacing any existing data.
        for resource, resource_name in (("container", name), ("volume", volume)):
            probe = subprocess.run(["docker", resource, "inspect", resource_name], capture_output=True)
            if probe.returncode == 0:
                raise RuntimeError("The disposable resource identity is already in use.")
        docker("volume", "create", "--label", f"{label}={owner}", volume)
        created_volume = True
        docker("run", "--rm", *common, image, "python", "-m", "alembic", "upgrade", "head")
        docker("run", "--detach", "--name", name, "--label", f"{label}={owner}",
               "--memory=320m", "--memory-swap=320m", *common,
               image, "python", "-m", "app.workers.import_worker")
        created_worker = True
        deadline = time.monotonic() + 60
        while not helper("idle")["idle"]:
            if time.monotonic() >= deadline:
                raise RuntimeError("The real worker never reached idle.")
            time.sleep(1)
        baseline = memory_stats()
        if baseline["oom"] or baseline["oom_kill"] or baseline["failcnt"]:
            raise RuntimeError("The worker experienced startup memory pressure.")
        fixture = helper("prepare")
        if not 1_400_000 <= fixture["archive_bytes"] <= 1_600_000 or fixture["entries"] != 18:
            raise RuntimeError("The fixture no longer represents the reported archive shape.")
        wait_for(lambda result: result["state"] == "READY" and result["analysis"] == "committed")
        helper("queue-commit")
        wait_for(lambda result: result["import"] == "committed")
        verified = helper("verify")
        final = memory_stats()
        inspection = json.loads(docker("container", "inspect", name))[0]
        delta = max(0, final["peak"] - baseline["current"])
        if (
            delta > 64 * MIB or final["oom"] or final["oom_kill"] or final["failcnt"] != baseline["failcnt"]
            or inspection["State"]["OOMKilled"] or not inspection["State"]["Running"]
            or inspection["RestartCount"] != 0
            or inspection["HostConfig"]["Memory"] != 320 * MIB
            or inspection["HostConfig"]["MemorySwap"] != 320 * MIB
        ):
            raise RuntimeError("The worker exceeded its real memory/no-OOM contract.")
        report.update(verified, archive_bytes=fixture["archive_bytes"], entries=18,
                      baseline_bytes=baseline["current"], peak_bytes=final["peak"],
                      workspace_peak_delta_bytes=delta, oom=0, oom_kill=0,
                      failcnt_delta=final["failcnt"] - baseline["failcnt"], restarts=0)
        print(json.dumps(report, sort_keys=True))
    finally:
        try:
            Path("small-zip-memory.json").write_text(json.dumps(report, indent=2) + "\n")
        finally:
            if created_worker or subprocess.run(["docker", "container", "inspect", name], capture_output=True).returncode == 0:
                try:
                    actual = docker("container", "inspect", "-f", '{{ index .Config.Labels "' + label + '" }}', name)
                    if actual != owner:
                        raise RuntimeError("Refusing to remove a worker owned by another job.")
                    if not report["passed"]:
                        print(docker("logs", "--tail", "45", name))
                    docker("rm", "--force", name)
                finally:
                    if created_volume:
                        actual = docker("volume", "inspect", "-f", '{{ index .Labels "' + label + '" }}', volume)
                        if actual != owner:
                            raise RuntimeError("Refusing to remove a volume owned by another job.")
                        docker("volume", "rm", volume)
            elif created_volume:
                actual = docker("volume", "inspect", "-f", '{{ index .Labels "' + label + '" }}', volume)
                if actual != owner:
                    raise RuntimeError("Refusing to remove a volume owned by another job.")
                docker("volume", "rm", volume)


if __name__ == "__main__":
    main()
