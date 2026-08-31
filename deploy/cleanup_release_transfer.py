#!/usr/bin/env python3
"""Bounded release-transfer cleanup; dry-run unless --execute is explicit."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transfer-dir", required=True, type=Path)
    parser.add_argument(
        "--keep",
        action="append",
        default=[],
        help="Exact direct child name to retain; repeat for current/rollback artifacts.",
    )
    parser.add_argument("--execute", action="store_true", help="Remove eligible direct children.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    transfer_dir = args.transfer_dir
    if not transfer_dir.is_absolute():
        print("cleanup refused: --transfer-dir must be absolute", file=sys.stderr)
        return 2
    if transfer_dir == Path(transfer_dir.anchor or os.sep):
        print("cleanup refused: transfer directory is too broad", file=sys.stderr)
        return 2
    if not transfer_dir.is_dir() or transfer_dir.is_symlink():
        print(f"cleanup refused: transfer directory is missing or symlinked: {transfer_dir}", file=sys.stderr)
        return 1
    keep = set(args.keep)
    if len(keep) < 2:
        print("cleanup refused: provide at least current and rollback artifacts with --keep", file=sys.stderr)
        return 2
    if any(not name or name in {".", ".."} or Path(name).name != name for name in keep):
        print("cleanup refused: --keep values must be direct child names", file=sys.stderr)
        return 2
    missing_keep = sorted(name for name in keep if not (transfer_dir / name).exists())
    if missing_keep:
        print(f"cleanup refused: keep artifact is missing: {','.join(missing_keep)}", file=sys.stderr)
        return 1

    children = list(transfer_dir.iterdir())
    candidates = sorted(child for child in children if child.name not in keep and not child.is_symlink())
    symlinks = sorted(child.name for child in children if child.is_symlink() and child.name not in keep)
    print(f"transfer_dir={transfer_dir}")
    print(f"kept={','.join(sorted(keep)) or '(none)'}")
    print(f"candidates={len(candidates)}")
    if symlinks:
        print(f"symlinks_not_removed={','.join(symlinks)}")
    for child in candidates:
        print(f"candidate={child.name}")
    if not args.execute:
        print("dry_run=true; no files removed")
        return 0

    for child in candidates:
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    print(f"removed={len(candidates)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
