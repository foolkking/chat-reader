"""Deterministic, isolated API capacity characterization.

This script is intentionally an operator/CI benchmark, not an application path.
It talks to the real API endpoints, samples API/worker RSS when PIDs are supplied,
and never writes benchmark output into the Web bundle or a production database.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable

import httpx


SEED = 20260814
FIXTURE_VERSION = "release-d-reader-capacity-v1"


def fixture(messages: int, profile: str) -> tuple[bytes, dict[str, Any]]:
    rows: list[dict[str, str]] = []
    math_blocks = 0
    code_blocks = 0
    table_blocks = 0
    for index in range(messages):
        role = "Prompt" if index % 2 == 0 else "Response"
        if role == "Prompt":
            text = f"Synthetic capacity prompt {index} seed {SEED}."
        elif profile == "plain":
            text = f"Synthetic capacity response {index}.\n\nThis is a bounded paragraph for tier {messages}."
        elif profile == "math":
            text = (
                f"Formula {index}: \\(x_{{{index}}}^2 + y^2 = z^2\\).\n\n"
                "\\[\\begin{aligned} a &= b+c \\\\\n"
                "d &= \\frac{\\sqrt{n^6+n}}{n^3} \\\\\n"
                "e &= \\sum_{k=1}^{n} k^2 \\end{aligned}\\]"
            )
            math_blocks += 2
        elif profile == "mixed":
            text = (
                f"## Mixed section {index}\n\n"
                f"A paragraph with \\(x_{{{index}}}\\) and a safe link.\n\n"
                "| key | value |\n| --- | ---: |\n| row | 1 |\n\n"
                "```typescript\nconst value = 1;\n```\n\n"
                "* [ ] pending\n* [x] complete\n\n"
                "Text[^1]\n\n[^1]: Synthetic footnote."
            )
            math_blocks += 1
            code_blocks += 1
            table_blocks += 1
        elif profile == "attachment_metadata":
            text = (
                f"Attachment metadata row {index}.\n\n"
                f"![synthetic-{index}](attachment://synthetic-{index})\n\n"
                "The binary payload is intentionally not part of this benchmark."
            )
        else:
            raise ValueError(f"unsupported profile: {profile}")
        rows.append({"role": role, "say": text})
    body = json.dumps(
        {
            "metadata": {"title": f"Release D {profile} {messages}", "powered_by": "ChatGPT Exporter"},
            "messages": rows,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return body, {
        "fixture_version": FIXTURE_VERSION,
        "seed": SEED,
        "message_count": messages,
        "profile": profile,
        "source_bytes": len(body),
        "math_block_count": math_blocks,
        "code_block_count": code_blocks,
        "table_count": table_blocks,
        "attachment_count": 0,
    }


def rss_bytes(pid: str | None) -> int | None:
    if not pid or os.name == "nt":
        return None
    try:
        status = Path(f"/proc/{int(pid)}/status").read_text(encoding="utf-8")
        line = next(line for line in status.splitlines() if line.startswith("VmRSS:"))
        return int(line.split()[1]) * 1024
    except (OSError, StopIteration, ValueError):
        return None


def tree_bytes(path: str | None) -> int:
    if not path:
        return 0
    root = Path(path)
    if not root.exists():
        return 0
    total = 0
    for item in root.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


class Sampler:
    def __init__(self, pids: list[str | None], roots: list[str | None]) -> None:
        self.pids = pids
        self.roots = roots
        self.samples: list[dict[str, int | float]] = []
        self.running = False
        self.thread: threading.Thread | None = None

    def start(self) -> None:
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self) -> dict[str, Any]:
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)
        rss = [int(item["rss_bytes"]) for item in self.samples if item["rss_bytes"]]
        disk = [int(item["disk_bytes"]) for item in self.samples]
        return {
            "peak_rss_bytes": max(rss) if rss else None,
            "disk_before_bytes": disk[0] if disk else tree_bytes(self.roots[0] if self.roots else None),
            "disk_peak_bytes": max(disk) if disk else None,
            "sample_count": len(self.samples),
        }

    def _run(self) -> None:
        while self.running:
            rss_values = [rss_bytes(pid) or 0 for pid in self.pids]
            self.samples.append({
                "at": time.monotonic(),
                "rss_bytes": sum(rss_values),
                "disk_bytes": sum(tree_bytes(root) for root in self.roots),
            })
            time.sleep(0.05)


def timed(label: str, fn: Callable[[], Any], sampler: Sampler) -> tuple[Any, dict[str, Any]]:
    sampler.start()
    started = time.perf_counter()
    try:
        value = fn()
    finally:
        sample = sampler.stop()
    sample.update({"operation": label, "elapsed_ms": round((time.perf_counter() - started) * 1000, 2)})
    return value, sample


def wait_for(client: httpx.Client, url: str, terminal: set[str], failure: set[str]) -> dict[str, Any]:
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        response = client.get(url)
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") in terminal:
            if payload.get("status") in failure:
                raise RuntimeError(payload.get("error_message") or f"task failed: {payload.get('status')}")
            return payload
        time.sleep(0.25)
    raise TimeoutError(f"timed out waiting for {url}")


def run(args: argparse.Namespace) -> dict[str, Any]:
    body, spec = fixture(args.messages, args.profile)
    client = httpx.Client(base_url=args.base_url.rstrip("/"), timeout=1800.0)
    pids = [args.api_pid, args.worker_pid]
    roots = [args.import_root, args.export_root, args.offline_root]
    result: dict[str, Any] = {"fixture": spec, "operations": []}

    def preview() -> dict[str, Any]:
        response = client.post(
            "/api/imports/preview",
            files={"files": (f"release-d-{args.profile}-{args.messages}.json", body, "application/json")},
        )
        response.raise_for_status()
        return response.json()

    preview_payload, preview_metric = timed("import_preview", preview, Sampler(pids, roots))
    result["operations"].append({**preview_metric, "input_bytes": len(body)})
    import_id = preview_payload["import_id"]

    def commit() -> dict[str, Any]:
        response = client.post(f"/api/imports/{import_id}/commit")
        response.raise_for_status()
        return wait_for(client, f"/api/imports/{import_id}/status", {"committed", "failed"}, {"failed"})

    status, commit_metric = timed("import_commit", commit, Sampler(pids, roots))
    result["operations"].append(commit_metric)
    conversation_id = status["conversation_ids"][0]
    result["conversation_id"] = conversation_id

    for export_name, path in (("markdown", f"/api/conversations/{conversation_id}/exports/markdown"), ("canjson", f"/api/conversations/{conversation_id}/exports/canjson?compression=gzip")):
        def download(url: str = path) -> int:
            response = client.get(url)
            response.raise_for_status()
            return sum(len(chunk) for chunk in response.iter_bytes())

        byte_count, export_metric = timed(f"conversation_export_{export_name}", download, Sampler(pids, roots))
        result["operations"].append({**export_metric, "artifact_bytes": byte_count})

    if args.system_archive:
        def system_export() -> dict[str, Any]:
            response = client.post("/api/system/archive/exports", json={"include_archived": True})
            response.raise_for_status()
            task = response.json()
            return wait_for(client, f"/api/tasks/{task['job_id']}", {"committed", "failed"}, {"failed"})

        task, archive_metric = timed("cr_v4_export", system_export, Sampler(pids, roots))
        result["operations"].append(archive_metric)
        result["cr_v4"] = task.get("result", {})
        download_url = result["cr_v4"].get("download_url")
        if isinstance(download_url, str):
            archive_path = args.output.with_suffix(".cr")
            with client.stream("GET", download_url) as response:
                response.raise_for_status()
                with archive_path.open("wb") as output:
                    for chunk in response.iter_bytes():
                        output.write(chunk)
            result["cr_v4"]["local_archive"] = str(archive_path)

    client.close()
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.getenv("BENCHMARK_BASE_URL", "http://127.0.0.1:8000"))
    parser.add_argument("--messages", type=int, choices=[398, 1000, 10000], required=True)
    parser.add_argument("--profile", choices=["plain", "math", "mixed", "attachment_metadata"], default="plain")
    parser.add_argument("--api-pid", default=os.getenv("BENCHMARK_API_PID"))
    parser.add_argument("--worker-pid", default=os.getenv("BENCHMARK_WORKER_PID"))
    parser.add_argument("--import-root", default=os.getenv("IMPORT_STORAGE_DIR"))
    parser.add_argument("--export-root", default=os.getenv("EXPORT_STORAGE_DIR"))
    parser.add_argument("--offline-root", default=os.getenv("OFFLINE_STORAGE_DIR"))
    parser.add_argument("--system-archive", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(run(args), ensure_ascii=False, indent=2), encoding="utf-8")
    print(args.output)


if __name__ == "__main__":
    main()
