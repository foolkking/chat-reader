from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.assets.attachment_storage_integrity import audit_local_attachment_storage


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only reconciliation of local attachment metadata and asset files.",
    )
    parser.add_argument("--verify-sha256", action="store_true", help="Read and verify every available local object.")
    parser.add_argument("--include-identities", action="store_true", help="Include object ids and relative storage keys.")
    parser.add_argument("--max-details", type=int, default=100)
    parser.add_argument("--max-records", type=int, default=1_000_000)
    parser.add_argument("--max-files", type=int, default=1_000_000)
    args = parser.parse_args()
    if args.max_details < 1 or args.max_records < 1 or args.max_files < 1:
        parser.error("all limits must be at least 1")

    settings = get_settings()
    backend = settings.asset_storage_backend.strip().lower()
    if backend != "local":
        print(json.dumps({
            "read_only": True,
            "applicable": False,
            "storage_backend": backend,
            "reason": "LOCAL_FILESYSTEM_AUDIT_NOT_APPLICABLE",
        }, sort_keys=True, separators=(",", ":")))
        return 2

    with SessionLocal() as db:
        report = audit_local_attachment_storage(
            db,
            Path(settings.asset_storage_dir),
            max_records=args.max_records,
            max_files=args.max_files,
            verify_sha256=args.verify_sha256,
        )
        db.rollback()

    payload: dict[str, object] = {
        "read_only": True,
        "applicable": True,
        "storage_backend": "local",
        "complete": report.complete,
        "clean": report.clean,
        "scanned_asset_object_count": report.scanned_asset_object_count,
        "scanned_active_attachment_count": report.scanned_active_attachment_count,
        "scanned_file_count": report.scanned_file_count,
        "sha256_verified_count": report.sha256_verified_count,
        "issue_count": len(report.issues),
        "issue_counts": report.issue_counts,
    }
    if args.include_identities:
        payload["issues"] = [
            {
                "code": issue.code,
                "asset_object_id": str(issue.asset_object_id) if issue.asset_object_id else None,
                "attachment_id": str(issue.attachment_id) if issue.attachment_id else None,
                "storage_key": issue.storage_key,
                "expected_bytes": issue.expected_bytes,
                "actual_bytes": issue.actual_bytes,
            }
            for issue in report.issues[:args.max_details]
        ]
        payload["details_truncated"] = len(report.issues) > args.max_details
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
    return 0 if report.clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
