"""Restore one `.cr v4` artifact into a disposable isolated database."""

from __future__ import annotations

import argparse
import json
import resource
import time
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    started = time.perf_counter()
    before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    from app.core.database import SessionLocal
    from app.services.exporting.system_archive import restore_system_archive

    with SessionLocal() as db:
        restored = restore_system_archive(db, args.archive)
        db.commit()
    after = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    result = {
        "archive_bytes": args.archive.stat().st_size,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
        "process_peak_rss_bytes": after,
        "process_rss_delta_bytes": max(0, after - before),
        "restored_counts": restored,
        "database_url_present": bool(__import__("os").environ.get("DATABASE_URL")),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
