from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.artifact_lifecycle import (
    ArtifactLifecycleError,
    execute_cleanup_candidates,
    scan_cleanup_candidates,
)

ELIGIBLE_CATEGORIES = ("SAFE_TEMP", "ORPHAN_FINAL", "SUPERSEDED_ARTIFACT")


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify or explicitly clean internal export/offline artifacts.")
    parser.add_argument("--apply", action="store_true", help="Apply deletion; default is dry-run.")
    parser.add_argument("--category", choices=ELIGIBLE_CATEGORIES)
    parser.add_argument("--confirm-token", action="append", default=[])
    parser.add_argument("--grace-hours", type=int)
    args = parser.parse_args()

    settings = get_settings()
    grace_hours = args.grace_hours if args.grace_hours is not None else settings.artifact_cleanup_grace_hours
    if grace_hours < 1:
        parser.error("--grace-hours must be at least 1")
    roots = {
        "offline": Path(settings.offline_storage_dir),
        "export": Path(settings.export_storage_dir),
    }
    with SessionLocal() as db:
        try:
            if args.apply:
                if args.category is None:
                    parser.error("--apply requires --category")
                result = execute_cleanup_candidates(
                    db,
                    roots=roots,
                    category=args.category,
                    confirmed_tokens=args.confirm_token,
                    grace_seconds=grace_hours * 3600,
                ).as_dict()
                payload = {"dry_run": False, "grace_hours": grace_hours, "result": result}
            else:
                scan = scan_cleanup_candidates(db, roots=roots, grace_seconds=grace_hours * 3600)
                payload = {
                    "dry_run": True,
                    "grace_hours": grace_hours,
                    "scan_complete": scan.complete,
                    "categories": scan.summary,
                    "candidate_tokens": [
                        {
                            "token": item.token,
                            "storage_category": item.storage_category,
                            "candidate_type": item.candidate_type,
                            "byte_size": item.byte_size,
                        }
                        for item in scan.candidates
                    ],
                }
            db.rollback()
        except ArtifactLifecycleError as exc:
            parser.error(str(exc))
    print(json.dumps(payload, sort_keys=True))


if __name__ == "__main__":
    main()
