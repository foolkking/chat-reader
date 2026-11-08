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


def main(*, bounded_case: str | None = None, memory_mib: int = 320) -> None:
    revision = os.environ.get("GITHUB_SHA", "")
    owner = ":".join(os.environ.get(key, "") for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_JOB"))
    if os.environ.get("CI") != "true" or not re.fullmatch(r"[a-f0-9]{40}", revision) or not re.fullmatch(r"\d+:\d+:[a-zA-Z0-9_-]+", owner):
        raise SystemExit("A disposable GitHub CI job and exact revision are required.")
    name = "chat-reader-small-zip-" + owner.replace(":", "-")
    if bounded_case is not None:
        if bounded_case not in {"small", "assets100", "assets500", "long"} or memory_mib not in {320, 640}:
            raise SystemExit("Unsupported disposable gate case.")
        name += "-" + bounded_case
    volume = name + "-data"
    label = "chat-reader.ci-small-zip"
    image = "chat-reader-api:" + revision
    if docker("image", "inspect", "-f", '{{ index .Config.Labels "org.opencontainers.image.revision" }}', image) != revision:
        raise SystemExit("Worker image does not match the source under test.")
    report = {"revision": revision, "passed": False, "real_sensor": True,
              "memory_limit_bytes": memory_mib * MIB, "memory_swap_limit_bytes": memory_mib * MIB}
    database = "chat_reader" if bounded_case is None else "chat_reader_bounded_" + bounded_case
    common = [
        "--network", "host", "--volume", volume + ":/data",
        "--env", "DATABASE_URL=postgresql+psycopg://chat_reader:chat_reader_ci@127.0.0.1:5432/" + database,
        "--env", "APP_ENV=test", "--env", "SMALL_IMPORT_MEMORY_GATE=1",
        "--env", "IMPORT_SMALL_ZIP_ENABLED=true", "--env", "ALLOW_UNSCANNED_ATTACHMENTS=true",
        "--env", "IMPORT_BOUNDED_ZIP_ENABLED=false",
        "--env", "IMPORT_STORAGE_DIR=/data/imports", "--env", "ASSET_STORAGE_DIR=/data/assets",
        "--env", "EXPORT_STORAGE_DIR=/data/exports", "--env", "OFFLINE_STORAGE_DIR=/data/offline",
        "--env", "IMPORT_WORKER_POLL_SECONDS=0.25", "--env", "WORKER_HEARTBEAT_INTERVAL_SECONDS=1",
    ]
    if bounded_case is not None:
        common[common.index("IMPORT_BOUNDED_ZIP_ENABLED=false")] = "IMPORT_BOUNDED_ZIP_ENABLED=true"
        common.extend(["--env", "BOUNDED_IMPORT_CASE=" + bounded_case])
        report["case"] = bounded_case
    created_volume = created_worker = False

    def helper(action: str) -> dict:
        module = "scripts.verify_small_zip_memory" if bounded_case is None else "scripts.verify_bounded_zip_memory"
        output = docker("run", "--rm", *common, image, "python", "-m", module, action, timeout=600)
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
  grep -E '^(anon|file) ' /sys/fs/cgroup/memory.stat
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
                "failcnt": 0, "anon": int(events.get("anon", 0)), "file": int(events.get("file", 0))}

    try:
        # Refuse collisions rather than deleting or replacing any existing data.
        for resource, resource_name in (("container", name), ("volume", volume)):
            probe = subprocess.run(["docker", resource, "inspect", resource_name], capture_output=True)
            if probe.returncode == 0:
                raise RuntimeError("The disposable resource identity is already in use.")
        docker("volume", "create", "--label", f"{label}={owner}", volume)
        created_volume = True
        if bounded_case is not None:
            helper("create-database")
        docker("run", "--rm", *common, image, "python", "-m", "alembic", "upgrade", "head")
        limits = ["--memory=320m", "--memory-swap=320m"] if memory_mib == 320 else ["--memory=640m", "--memory-swap=640m"]
        docker("run", "--detach", "--name", name, "--label", f"{label}={owner}",
               *limits, *common,
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
        if bounded_case is None and (not 1_400_000 <= fixture["archive_bytes"] <= 1_600_000 or fixture["entries"] != 18):
            raise RuntimeError("The fixture no longer represents the reported archive shape.")
        if bounded_case in {"assets100", "assets500"}:
            target = 100 if bounded_case == "assets100" else 500
            if not (target - 2) * MIB <= fixture["archive_bytes"] <= target * MIB:
                raise RuntimeError("The large fixture no longer covers its declared ZIP size.")
        wait_for(lambda result: result["state"] == "READY" and result["analysis"] == "committed", timeout=600 if bounded_case else 180)
        helper("queue-commit")
        wait_for(lambda result: result["import"] == "committed", timeout=600 if bounded_case else 180)
        verified = helper("verify")
        final = memory_stats()
        inspection = json.loads(docker("container", "inspect", name))[0]
        delta = max(0, final["peak"] - baseline["current"])
        if (
            delta > 64 * MIB or final["oom"] or final["oom_kill"] or final["failcnt"] != baseline["failcnt"]
            or inspection["State"]["OOMKilled"] or not inspection["State"]["Running"]
            or inspection["RestartCount"] != 0
            or inspection["HostConfig"]["Memory"] != memory_mib * MIB
            or inspection["HostConfig"]["MemorySwap"] != memory_mib * MIB
        ):
            raise RuntimeError("The worker exceeded its real memory/no-OOM contract.")
        report.update(verified, archive_bytes=fixture["archive_bytes"],
                      baseline_bytes=baseline["current"], peak_bytes=final["peak"],
                      workspace_peak_delta_bytes=delta, oom=0, oom_kill=0,
                      failcnt_delta=final["failcnt"] - baseline["failcnt"], restarts=0,
                      baseline_anon_bytes=baseline.get("anon"), final_anon_bytes=final.get("anon"),
                      baseline_file_bytes=baseline.get("file"), final_file_bytes=final.get("file"))
        if bounded_case is None:
            report["entries"] = 18
        print(json.dumps(report, sort_keys=True))
    finally:
        try:
            output = "small-zip-memory.json" if bounded_case is None else f"bounded-zip-{bounded_case}.json"
            Path(output).write_text(json.dumps(report, indent=2) + "\n")
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
