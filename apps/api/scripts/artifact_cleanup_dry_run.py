from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.artifact_lifecycle import scan_cleanup_candidates


ELIGIBLE_CATEGORIES = ("SAFE_TEMP", "ORPHAN_FINAL", "SUPERSEDED_ARTIFACT")
DEFAULT_MAX_FILES = 100_000


def main() -> int:
    parser = argparse.ArgumentParser(description="Bounded, aggregate-only artifact cleanup debt report.")
    parser.add_argument("--max-files", type=int, default=DEFAULT_MAX_FILES)
    parser.add_argument("--grace-hours", type=int)
    parser.add_argument(
        "--fail-on-debt",
        action="store_true",
        help="Return 1 when a complete report contains eligible cleanup debt.",
    )
    args = parser.parse_args()
    if args.max_files < 1:
        parser.error("--max-files must be at least 1")

    settings = get_settings()
    grace_hours = args.grace_hours if args.grace_hours is not None else settings.artifact_cleanup_grace_hours
    if grace_hours < 1:
        parser.error("--grace-hours must be at least 1")
    with SessionLocal() as db:
        scan = scan_cleanup_candidates(
            db,
            roots={"offline": Path(settings.offline_storage_dir), "export": Path(settings.export_storage_dir)},
            grace_seconds=grace_hours * 3600,
            max_files=args.max_files,
        )
        db.rollback()

    debt = {category: scan.summary[category] for category in ELIGIBLE_CATEGORIES}
    scanned_file_count = sum(item["candidate_count"] for item in scan.summary.values())
    eligible_candidate_count = sum(item["candidate_count"] for item in debt.values())
    eligible_candidate_bytes = sum(item["candidate_bytes"] for item in debt.values())
    payload = {
        "dry_run": True,
        "aggregate_only": True,
        "grace_hours": grace_hours,
        "max_files": args.max_files,
        "scan_complete": scan.complete,
        "scanned_file_count": scanned_file_count,
        "eligible_candidate_count": eligible_candidate_count,
        "eligible_candidate_bytes": eligible_candidate_bytes,
        "cleanup_debt": debt,
        "categories": scan.summary,
    }
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    if not scan.complete:
        return 2
    if args.fail_on_debt and eligible_candidate_count:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
