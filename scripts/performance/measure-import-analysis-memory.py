"""Measure synthetic adaptive-JSON analysis allocation without user data."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
import tracemalloc
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.services.adaptive_import.analysis import analyze_json  # noqa: E402
from app.services.adaptive_import.contracts import AdaptiveImportError  # noqa: E402


def _measure(label: str, content: bytes) -> dict:
    tracemalloc.start()
    started = time.perf_counter()
    outcome = "accepted"
    try:
        analysis = analyze_json(content)
        outcome = analysis.handling_class
    except AdaptiveImportError as exc:
        outcome = exc.code
    elapsed_ms = (time.perf_counter() - started) * 1000
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {
        "case": label,
        "source_bytes": len(content),
        "peak_traced_bytes": peak,
        "peak_over_input": round(peak / max(len(content), 1), 2),
        "milliseconds": round(elapsed_ms, 3),
        "outcome": outcome,
        "source_sha256": hashlib.sha256(content).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transcript-records", type=int, default=25_000)
    parser.add_argument("--dense-records", type=int, default=200_000)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.transcript_records <= 100_000:
        parser.error("--transcript-records must be 1..100000")
    if not 1 <= args.dense_records <= 1_000_000:
        parser.error("--dense-records must be 1..1000000")

    transcript_record = (
        b'{"role":"user","content":"A representative transcript message '
        b'with enough body text to dominate metadata."}'
    )
    transcript = b'{"messages":[' + b",".join(
        [transcript_record] * args.transcript_records
    ) + b"]}"
    dense_record = b'{"x":0}'
    dense = b"[" + b",".join([dense_record] * args.dense_records) + b"]"

    report = json.dumps({
        "version": 1,
        "platform": platform.system(),
        "python": platform.python_version(),
        "measurement": (
            "Synthetic adaptive analyze_json tracemalloc and wall time; "
            "not RSS/cgroup/OOM acceptance."
        ),
        "source_sha256": {
            "analysis.py": hashlib.sha256(
                (ROOT / "apps/api/app/services/adaptive_import/analysis.py").read_bytes()
            ).hexdigest(),
            "contracts.py": hashlib.sha256(
                (ROOT / "apps/api/app/services/adaptive_import/contracts.py").read_bytes()
            ).hexdigest(),
            "config.py": hashlib.sha256(
                (ROOT / "apps/api/app/core/config.py").read_bytes()
            ).hexdigest(),
        },
        "data": "Synthetic only; generated in memory; no user or production files.",
        "rows": [
            _measure("transcript-like", transcript),
            _measure("dense-small-objects", dense),
        ],
    }, indent=2) + "\n"
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report, end="")


if __name__ == "__main__":
    main()
