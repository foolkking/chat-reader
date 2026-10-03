#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from _context_package.validation import validate_continuation


def main() -> int:
    p = argparse.ArgumentParser(description="Deterministically validate a Continuation Pair against its Raw source.")
    p.add_argument("package")
    p.add_argument("--detail", choices=["summary", "full"], default="summary")
    p.add_argument("--pretty", action="store_true")
    p.add_argument("--output")
    args = p.parse_args()
    try:
        report = validate_continuation(args.package, detail=args.detail)
    except Exception as e:
        report = {
            "report_schema": "chat-reader-continuation-validation",
            "report_version": "1.0.0",
            "tool": {"name": "validate_continuation", "version": "1.0.0"},
            "runtime_state": "invalid",
            "usable_for_restore": False,
            "findings": [{"severity": "error", "code": "validator_internal_failure", "detail": str(e)}],
        }
        code = 4
    else:
        code = 0
    text = json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, separators=None if args.pretty else (",", ":"))
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    sys.stdout.write(text + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
