"""Synthetic per-message reuse benchmark; does not read user/production data."""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import platform
from pathlib import Path
import sys
import time
import tracemalloc
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.services import content_cleanup as cleanup  # noqa: E402


def measure(text: str, rules: list, *, shared: bool) -> dict:
    gc.collect()
    tracemalloc.start()
    started = time.perf_counter()
    context = cleanup._DetectionContext(text) if shared else None
    digest = hashlib.sha256()
    count = 0
    for revision in rules:
        matches = cleanup.detect_occurrences(
            "assistant", text, SimpleNamespace(detector_id=None), revision, context=context,
        )
        for hit in matches:
            digest.update(f"{hit.start}:{hit.end}:{hit.decision}:{hit.match_mode}\n".encode())
        count += len(matches)
    elapsed = time.perf_counter() - started
    _current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return {
        "milliseconds": round(elapsed * 1000, 3),
        "peak_traced_bytes": peak, "matches": count, "range_digest": digest.hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--units", type=int, default=1500)
    parser.add_argument("--mixed-case-profiles", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.units <= 10000:
        parser.error("--units must be 1..10000")
    rows = []
    for label, unit in (
        ("ascii", "Retained plain text noise-token and context.\n"),
        ("unicode", "保留 e\u0301 ＮＯＩＳＥ-token 🙂 上下文。\r\n"),
    ):
        text = unit * args.units + "`noise-token`"
        for rule_count in (1, 5, 20):
            rules = [
                SimpleNamespace(
                    match_value="noise-token" if index == 0 else "noise-token-" + str(index),
                    matcher_mode="NORMALIZED",
                    case_sensitive=bool(index % 2) if args.mixed_case_profiles else False,
                    boundary_mode="ANYWHERE",
                )
                for index in range(rule_count)
            ]
            isolated = measure(text, rules, shared=False)
            reused = measure(text, rules, shared=True)
            if (isolated["range_digest"], isolated["matches"]) != (reused["range_digest"], reused["matches"]):
                raise RuntimeError("Reuse changed the original ranges or protection decisions.")
            rows.append({
                "input": label, "characters": len(text), "rules": rule_count,
                "profiles": len({rule.case_sensitive for rule in rules}),
                "isolated": isolated, "reused": reused,
            })
    report = json.dumps({
        "version": 2, "platform": platform.system(), "python": platform.python_version(),
        "measurement": "Synthetic function-only wall time and tracemalloc; not RSS/OOM/load acceptance.",
        "source_sha256": {
            name: hashlib.sha256((ROOT / "apps/api/app/services" / name).read_bytes()).hexdigest()
            for name in ("content_cleanup.py", "cleanup_normalization.py")
        },
        "rows": rows,
    }, indent=2) + "\n"
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report, end="")


if __name__ == "__main__":
    main()
