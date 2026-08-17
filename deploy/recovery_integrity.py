#!/usr/bin/env python3
"""Aggregate-only integrity audit for an isolated Chat Reader recovery."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.message_version import MessageVersion
from app.services.editing.transient_upload_references import find_transient_upload_references


TABLES = (
    "conversations",
    "messages",
    "message_versions",
    "attachments",
    "message_version_attachments",
    "asset_objects",
    "imports",
    "source_artifacts",
    "export_artifacts",
    "offline_package_artifacts",
    "shares",
    "worker_runtime_states",
    "background_jobs",
)


def _check_file(path: Path, *, byte_size: int, result: dict[str, int]) -> None:
    if not path.is_file():
        result["missing"] += 1
        return
    if path.stat().st_size != byte_size:
        result["size_mismatch"] += 1
        return


def _storage_usage(root: Path) -> dict[str, int]:
    files = [path for path in root.rglob("*") if path.is_file()] if root.exists() else []
    return {"files": len(files), "bytes": sum(path.stat().st_size for path in files)}


def audit(snapshot: dict) -> dict:
    settings = get_settings()
    roots = {
        "imports": Path(settings.import_storage_dir).resolve(),
        "exports": Path(settings.export_storage_dir).resolve(),
        "offline": Path(settings.offline_storage_dir).resolve(),
        "assets": Path(settings.asset_storage_dir).resolve(),
    }
    report: dict = {
        "rows": {},
        "storage": {},
        "relations": {},
        "files": {"checked": 0, "missing": 0, "size_mismatch": 0},
    }
    with SessionLocal() as db:
        for table in TABLES:
            report["rows"][table] = int(db.execute(text(f"select count(*) from {table}")).scalar_one())
        report["relations"] = {
            "dangling_current_message_version": int(
                db.execute(
                    text(
                        "select count(*) from messages m left join message_versions v "
                        "on v.id=m.current_version_id where m.current_version_id is not null "
                        "and (v.id is null or v.message_id<>m.id)"
                    )
                ).scalar_one()
            ),
            "active_message_without_current_version": int(
                db.execute(text("select count(*) from messages where not is_deleted and current_version_id is null")).scalar_one()
            ),
            "dangling_attachment_asset": int(
                db.execute(
                    text(
                        "select count(*) from attachments a left join asset_objects o on o.id=a.asset_object_id "
                        "where a.asset_object_id is not null and o.id is null"
                    )
                ).scalar_one()
            ),
            "dangling_occurrence_attachment": int(
                db.execute(
                    text(
                        "select count(*) from message_version_attachments x left join attachments a "
                        "on a.id=x.attachment_id where a.id is null"
                    )
                ).scalar_one()
            ),
            "dangling_occurrence_version": int(
                db.execute(
                    text(
                        "select count(*) from message_version_attachments x left join message_versions v "
                        "on v.id=x.message_version_id where v.id is null"
                    )
                ).scalar_one()
            ),
            "dangling_source_import": int(
                db.execute(
                    text(
                        "select count(*) from source_artifacts s left join imports i on i.id=s.import_id "
                        "where i.id is null"
                    )
                ).scalar_one()
            ),
            "dangling_export_job": int(
                db.execute(
                    text(
                        "select count(*) from export_artifacts a left join background_jobs j on j.id=a.job_id "
                        "where j.id is null"
                    )
                ).scalar_one()
            ),
            "dangling_offline_job": int(
                db.execute(
                    text(
                        "select count(*) from offline_package_artifacts a left join background_jobs j on j.id=a.job_id "
                        "where j.id is null"
                    )
                ).scalar_one()
            ),
            "dangling_share_conversation": int(
                db.execute(
                    text(
                        "select count(*) from shares s left join conversations c on c.id=s.conversation_id "
                        "where c.id is null"
                    )
                ).scalar_one()
            ),
            "dedupe_asset_groups": int(
                db.execute(
                    text(
                        "select count(*) from (select asset_object_id from attachments "
                        "where asset_object_id is not null group by asset_object_id having count(*)>1) x"
                    )
                ).scalar_one()
            ),
            "active_unreferenced_attachments": int(
                db.execute(
                    text(
                        "select count(*) from (select a.id from attachments a "
                        "left join message_version_attachments x on x.attachment_id=a.id "
                        "where a.status='available' group by a.id having count(x.id)=0) x"
                    )
                ).scalar_one()
            ),
        }

        for storage_key, byte_size in db.execute(
            text("select storage_key,byte_size from asset_objects where status='available'")
        ):
            report["files"]["checked"] += 1
            _check_file(roots["assets"] / storage_key, byte_size=byte_size, result=report["files"])
        for import_id, safe_filename, byte_size in db.execute(
            text("select import_id,safe_filename,byte_size from source_artifacts")
        ):
            report["files"]["checked"] += 1
            _check_file(
                roots["imports"] / str(import_id) / safe_filename,
                byte_size=byte_size,
                result=report["files"],
            )
        for table, root_key in (("export_artifacts", "exports"), ("offline_package_artifacts", "offline")):
            for storage_uri, byte_size in db.execute(
                text(f"select storage_uri,byte_size from {table}")
            ):
                path = Path(storage_uri).resolve()
                report["files"]["checked"] += 1
                if not path.is_relative_to(roots[root_key]):
                    report["files"]["missing"] += 1
                    continue
                _check_file(path, byte_size=byte_size, result=report["files"])

        report["transient_upload_reference_count"] = sum(
            bool(find_transient_upload_references(source))
            for (source,) in db.query(MessageVersion.display_text).yield_per(250)
        )

    for name, root in roots.items():
        report["storage"][name] = _storage_usage(root)
    report["rows_match_snapshot"] = all(
        report["rows"].get(name) == expected for name, expected in snapshot["rows"].items()
    )
    report["storage_match_snapshot"] = all(
        report["storage"].get(name) == expected for name, expected in snapshot["storage"].items()
    )
    report["canonical_dangling_reference_count"] = sum(
        value for key, value in report["relations"].items() if key.startswith("dangling_")
    )
    report["canonical_missing_required_file_count"] = (
        report["files"]["missing"] + report["files"]["size_mismatch"]
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    report = audit(json.loads(args.snapshot.read_text(encoding="utf-8")))
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if (
        report["rows_match_snapshot"]
        and report["storage_match_snapshot"]
        and report["canonical_dangling_reference_count"] == 0
        and report["canonical_missing_required_file_count"] == 0
        and report["transient_upload_reference_count"] == 0
    ) else 1


if __name__ == "__main__":
    raise SystemExit(main())
