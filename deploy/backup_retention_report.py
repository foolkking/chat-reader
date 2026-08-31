#!/usr/bin/env python3
"""Produce a bounded, read-only retention report for Chat Reader backups."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


REQUIRED_FILES = frozenset(
    {
        "MANIFEST",
        "SHA256SUMS",
        "postgres.dump",
        "postgres.toc",
        "imports.tar.gz",
        "exports.tar.gz",
        "offline.tar.gz",
        "assets.tar.gz",
    }
)


@dataclass
class BackupEntry:
    name: str
    created_at: datetime
    created_at_source: str
    size_bytes: int
    structurally_complete: bool
    missing_files: list[str]
    classification: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Report backup retention categories without deleting or modifying backups. "
            "REVIEW_OLDER_COMPLETE is an operator-review state, not deletion approval."
        )
    )
    parser.add_argument("--backup-dir", default=os.environ.get("BACKUP_DIR", "./backups"))
    parser.add_argument("--keep-latest", type=non_negative_int, default=3)
    parser.add_argument("--minimum-age-days", type=non_negative_int, default=30)
    parser.add_argument("--protect-name", action="append", default=[])
    parser.add_argument("--max-entries", type=positive_int, default=10_000)
    parser.add_argument("--max-files", type=positive_int, default=1_000_000)
    parser.add_argument("--include-identities", action="store_true")
    parser.add_argument("--fail-on-review-candidates", action="store_true")
    parser.add_argument("--now", type=parse_timestamp, default=None, help=argparse.SUPPRESS)
    return parser.parse_args()


def positive_int(raw: str) -> int:
    value = int(raw)
    if value <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return value


def non_negative_int(raw: str) -> int:
    value = int(raw)
    if value < 0:
        raise argparse.ArgumentTypeError("must be zero or greater")
    return value


def parse_timestamp(raw: str) -> datetime:
    value = raw.strip()
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise argparse.ArgumentTypeError("timestamp must be UTC YYYYMMDDTHHMMSSZ or YYYY-MM-DDTHH:MM:SSZ")


def validate_protected_names(names: Iterable[str]) -> set[str]:
    result: set[str] = set()
    for raw_name in names:
        name = raw_name.strip()
        if not name or name in {".", ".."} or Path(name).name != name or "/" in name or "\\" in name:
            raise ValueError(f"invalid protected backup name: {raw_name!r}")
        result.add(name)
    return result


def manifest_timestamp(path: Path) -> datetime | None:
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                key, separator, value = line.partition("=")
                if separator and key.strip() == "created_at":
                    try:
                        return parse_timestamp(value.strip())
                    except argparse.ArgumentTypeError:
                        return None
    except (OSError, UnicodeError):
        return None
    return None


def directory_size(path: Path, remaining_files: list[int]) -> tuple[int, bool]:
    total = 0
    for root, directories, files in os.walk(path, followlinks=False):
        directories[:] = [name for name in directories if not (Path(root) / name).is_symlink()]
        for name in files:
            if remaining_files[0] <= 0:
                return total, False
            remaining_files[0] -= 1
            file_path = Path(root) / name
            if file_path.is_symlink():
                continue
            try:
                total += file_path.stat().st_size
            except OSError:
                return total, False
    return total, True


def collect_entries(root: Path, max_entries: int, max_files: int) -> tuple[list[BackupEntry], Counter[str], bool]:
    entries: list[BackupEntry] = []
    held = Counter()
    scan_complete = True
    remaining_files = [max_files]
    with os.scandir(root) as iterator:
        for index, dir_entry in enumerate(iterator):
            if index >= max_entries:
                scan_complete = False
                break
            if dir_entry.is_symlink():
                held["HOLD_UNSAFE_ENTRY"] += 1
                continue
            if not dir_entry.is_dir(follow_symlinks=False):
                held["HOLD_NON_BACKUP_ENTRY"] += 1
                continue
            path = Path(dir_entry.path)
            present = {child.name for child in path.iterdir() if child.is_file() and not child.is_symlink()}
            missing = sorted(REQUIRED_FILES - present)
            created_at = manifest_timestamp(path / "MANIFEST")
            created_at_source = "manifest"
            if created_at is None:
                created_at = datetime.fromtimestamp(dir_entry.stat(follow_symlinks=False).st_mtime, tz=timezone.utc)
                created_at_source = "filesystem_mtime"
            size_bytes, size_complete = directory_size(path, remaining_files)
            if not size_complete:
                scan_complete = False
            entries.append(
                BackupEntry(
                    name=dir_entry.name,
                    created_at=created_at,
                    created_at_source=created_at_source,
                    size_bytes=size_bytes,
                    structurally_complete=not missing and created_at_source == "manifest",
                    missing_files=missing,
                )
            )
            if not size_complete:
                break
    return entries, held, scan_complete


def classify(entries: list[BackupEntry], protected: set[str], keep_latest: int, minimum_age_days: int, now: datetime) -> None:
    complete = sorted((entry for entry in entries if entry.structurally_complete), key=lambda entry: entry.created_at, reverse=True)
    latest_names = {entry.name for entry in complete[:keep_latest]}
    for entry in entries:
        age_seconds = (now - entry.created_at).total_seconds()
        if entry.name in protected:
            entry.classification = "RETAIN_EXPLICIT"
        elif not entry.structurally_complete or age_seconds < 0:
            entry.classification = "HOLD_INCOMPLETE_OR_UNKNOWN"
        elif entry.name in latest_names:
            entry.classification = "RETAIN_LATEST"
        elif age_seconds < minimum_age_days * 86_400:
            entry.classification = "RETAIN_RECENT"
        else:
            entry.classification = "REVIEW_OLDER_COMPLETE"


def build_report(args: argparse.Namespace) -> tuple[dict[str, object], int]:
    root = Path(args.backup_dir).resolve()
    protected = validate_protected_names(args.protect_name)
    if not root.is_dir():
        return {"scan_complete": False, "error": "backup_directory_unavailable"}, 2
    now = args.now or datetime.now(timezone.utc)
    entries, held, scan_complete = collect_entries(root, args.max_entries, args.max_files)
    classify(entries, protected, args.keep_latest, args.minimum_age_days, now)

    counts = Counter(entry.classification for entry in entries)
    bytes_by_class: defaultdict[str, int] = defaultdict(int)
    for entry in entries:
        bytes_by_class[entry.classification] += entry.size_bytes
    counts.update(held)
    report: dict[str, object] = {
        "schema_version": 1,
        "mode": "read_only",
        "scan_complete": scan_complete,
        "policy": {
            "keep_latest": args.keep_latest,
            "minimum_age_days": args.minimum_age_days,
            "explicitly_protected_count": len(protected),
        },
        "scanned_backup_count": len(entries),
        "scanned_bytes": sum(entry.size_bytes for entry in entries),
        "counts": dict(sorted(counts.items())),
        "bytes": dict(sorted(bytes_by_class.items())),
        "review_candidate_count": counts["REVIEW_OLDER_COMPLETE"],
        "review_candidate_bytes": bytes_by_class["REVIEW_OLDER_COMPLETE"],
        "warning": "REVIEW_OLDER_COMPLETE requires separate verification and explicit operator approval; this report never deletes data.",
    }
    if args.include_identities:
        report["entries"] = [
            {
                "name": entry.name,
                "classification": entry.classification,
                "created_at": entry.created_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "created_at_source": entry.created_at_source,
                "size_bytes": entry.size_bytes,
                "missing_files": entry.missing_files,
            }
            for entry in sorted(entries, key=lambda item: (item.classification, item.name))
        ]
    if not scan_complete:
        return report, 2
    if args.fail_on_review_candidates and counts["REVIEW_OLDER_COMPLETE"]:
        return report, 1
    return report, 0


def main() -> int:
    args = parse_args()
    try:
        report, status = build_report(args)
    except (OSError, ValueError) as exc:
        report = {"scan_complete": False, "error": type(exc).__name__}
        status = 2
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return status


if __name__ == "__main__":
    raise SystemExit(main())
