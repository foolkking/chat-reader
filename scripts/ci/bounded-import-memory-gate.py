#!/usr/bin/env python3
"""Additional exact-image gates; never replaces the original 320 MiB gate."""
import importlib.util
import json
import os
from pathlib import Path

if __name__ == "__main__":
    spec = importlib.util.spec_from_file_location("small_memory_gate", Path(__file__).with_name("small-import-memory-gate.py"))
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    cases = [("small", 320), ("assets100", 320), ("assets500", 640), ("long", 320)]
    reports = []
    try:
        for case, limit in cases:
            gate.main(bounded_case=case, memory_mib=limit)
            reports.append(json.loads(Path(f"bounded-zip-{case}.json").read_text()))
    finally:
        Path("bounded-zip-memory.json").write_text(json.dumps({
            "revision": os.environ.get("GITHUB_SHA"), "passed": len(reports) == len(cases) and all(r["passed"] for r in reports),
            "real_sensor": True, "cases": reports,
        }, indent=2) + "\n")
