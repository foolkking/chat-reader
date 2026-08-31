from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from types import SimpleNamespace
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from scripts import artifact_cleanup_dry_run


def test_cleanup_debt_report_is_bounded_aggregate_and_marks_incomplete(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    export_root = tmp_path / "exports"
    offline_root = tmp_path / "offline"
    for _ in range(3):
        _old_file(export_root / str(uuid.uuid4()) / "orphan.zip")
    _patch_runtime(monkeypatch, tmp_path, export_root, offline_root)
    monkeypatch.setattr("sys.argv", ["artifact_cleanup_dry_run", "--max-files", "2"])

    assert artifact_cleanup_dry_run.main() == 2
    output = capsys.readouterr().out
    payload = json.loads(output)
    assert payload["aggregate_only"] is True
    assert payload["scan_complete"] is False
    assert payload["scanned_file_count"] == 2
    assert payload["max_files"] == 2
    assert "candidate_tokens" not in payload
    assert str(export_root) not in output


def test_cleanup_debt_report_only_fails_on_debt_when_requested(
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    export_root = tmp_path / "exports"
    offline_root = tmp_path / "offline"
    orphan = export_root / str(uuid.uuid4()) / "orphan.zip"
    _old_file(orphan)
    _patch_runtime(monkeypatch, tmp_path, export_root, offline_root)

    monkeypatch.setattr("sys.argv", ["artifact_cleanup_dry_run"])
    assert artifact_cleanup_dry_run.main() == 0
    report = json.loads(capsys.readouterr().out)
    assert report["scan_complete"] is True
    assert report["eligible_candidate_count"] == 1
    assert report["eligible_candidate_bytes"] == orphan.stat().st_size
    assert report["cleanup_debt"]["ORPHAN_FINAL"]["candidate_count"] == 1
    assert orphan.is_file()

    monkeypatch.setattr("sys.argv", ["artifact_cleanup_dry_run", "--fail-on-debt"])
    assert artifact_cleanup_dry_run.main() == 1
    second = json.loads(capsys.readouterr().out)
    assert second["categories"] == report["categories"]
    assert orphan.is_file()


def _patch_runtime(monkeypatch, tmp_path: Path, export_root: Path, offline_root: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'cleanup-report.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr(artifact_cleanup_dry_run, "SessionLocal", factory)
    monkeypatch.setattr(
        artifact_cleanup_dry_run,
        "get_settings",
        lambda: SimpleNamespace(
            export_storage_dir=str(export_root),
            offline_storage_dir=str(offline_root),
            artifact_cleanup_grace_hours=24,
        ),
    )


def _old_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"artifact")
    old = (datetime.now(timezone.utc) - timedelta(days=2)).timestamp()
    os.utime(path, (old, old))
