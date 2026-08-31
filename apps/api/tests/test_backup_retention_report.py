from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "deploy" / "backup_retention_report.py"
REQUIRED_FILES = (
    "MANIFEST",
    "SHA256SUMS",
    "postgres.dump",
    "postgres.toc",
    "imports.tar.gz",
    "exports.tar.gz",
    "offline.tar.gz",
    "assets.tar.gz",
)


def make_backup(root: Path, name: str, created_at: str, *, complete: bool = True) -> Path:
    backup = root / name
    backup.mkdir()
    files = REQUIRED_FILES if complete else ("MANIFEST", "postgres.dump")
    for filename in files:
        content = f"schema_version=1\ncreated_at={created_at}\n" if filename == "MANIFEST" else filename
        (backup / filename).write_text(content, encoding="utf-8")
    return backup


def run_report(root: Path, *arguments: str) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--backup-dir", str(root), "--now", "2026-08-31T00:00:00Z", *arguments],
        check=False,
        capture_output=True,
        text=True,
    )
    return result, json.loads(result.stdout)


def test_report_classifies_latest_recent_review_and_incomplete_without_identities(tmp_path: Path) -> None:
    make_backup(tmp_path, "latest", "20260830T000000Z")
    make_backup(tmp_path, "recent", "20260820T000000Z")
    make_backup(tmp_path, "older", "20260601T000000Z")
    make_backup(tmp_path, "broken", "20260501T000000Z", complete=False)

    result, report = run_report(tmp_path, "--keep-latest", "1", "--minimum-age-days", "30")

    assert result.returncode == 0
    assert report["scan_complete"] is True
    assert report["counts"] == {
        "HOLD_INCOMPLETE_OR_UNKNOWN": 1,
        "RETAIN_LATEST": 1,
        "RETAIN_RECENT": 1,
        "REVIEW_OLDER_COMPLETE": 1,
    }
    assert report["review_candidate_count"] == 1
    assert "entries" not in report
    assert sorted(path.name for path in tmp_path.iterdir()) == ["broken", "latest", "older", "recent"]


def test_explicit_protection_and_identity_output_are_opt_in(tmp_path: Path) -> None:
    make_backup(tmp_path, "protected-baseline", "20260101T000000Z")
    result, report = run_report(
        tmp_path,
        "--keep-latest",
        "0",
        "--minimum-age-days",
        "0",
        "--protect-name",
        "protected-baseline",
        "--include-identities",
    )

    assert result.returncode == 0
    assert report["counts"] == {"RETAIN_EXPLICIT": 1}
    assert report["entries"][0]["name"] == "protected-baseline"
    assert report["entries"][0]["classification"] == "RETAIN_EXPLICIT"


def test_review_candidates_only_fail_when_requested(tmp_path: Path) -> None:
    make_backup(tmp_path, "old", "20260101T000000Z")
    normal, _ = run_report(tmp_path, "--keep-latest", "0", "--minimum-age-days", "0")
    strict, _ = run_report(
        tmp_path,
        "--keep-latest",
        "0",
        "--minimum-age-days",
        "0",
        "--fail-on-review-candidates",
    )
    assert normal.returncode == 0
    assert strict.returncode == 1


def test_bounded_scan_never_reports_truncated_inventory_as_complete(tmp_path: Path) -> None:
    make_backup(tmp_path, "one", "20260830T000000Z")
    make_backup(tmp_path, "two", "20260829T000000Z")
    result, report = run_report(tmp_path, "--max-entries", "1")
    assert result.returncode == 2
    assert report["scan_complete"] is False
    assert report["scanned_backup_count"] == 1
