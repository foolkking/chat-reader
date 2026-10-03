#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from _context_package.inspection import inspect_package


def main() -> int:
    p = argparse.ArgumentParser(description="Inspect a Chat Reader Context Package without semantic interpretation.")
    p.add_argument("package")
    p.add_argument("--pretty", action="store_true")
    p.add_argument("--output")
    p.add_argument("--verify-hashes", choices=["none", "core", "all"], default="core")
    p.add_argument("--detail", choices=["summary", "index"], default="summary")
    args = p.parse_args()
    report = inspect_package(args.package, verify_hashes=args.verify_hashes, detail=args.detail)
    text = json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, separators=None if args.pretty else (",", ":"))
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    sys.stdout.write(text + "\n")
    state = report.get("status")
    if state in {"ok", "degraded"}:
        return 0
    if state == "ambiguous":
        return 3
    if state == "unsupported":
        return 4
    return 5


if __name__ == "__main__":
    raise SystemExit(main())
