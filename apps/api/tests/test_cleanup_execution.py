from __future__ import annotations

import os
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.services.artifact_lifecycle import execute_cleanup_candidates, scan_cleanup_candidates, staging_path


def _zip(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", b"{}")


def _old(path: Path) -> None:
    value = (datetime.now(timezone.utc) - timedelta(days=2)).timestamp()
    os.utime(path, (value, value))


def _factory(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'cleanup.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def test_classifier_protects_recent_active_canonical_unknown_and_assets(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    export_root = tmp_path / "exports"
    offline_root = tmp_path / "offline"
    asset_root = tmp_path / "assets"
    active_id = uuid.uuid4()
    current_id = uuid.uuid4()
    active_temp = staging_path(export_root / str(active_id) / "active.zip")
    current = export_root / str(current_id) / "current.zip"
    recent = export_root / str(uuid.uuid4()) / "recent.zip"
    unknown = export_root / "unknown.zip"
    asset = asset_root / "objects" / "business.bin"
    for path in (active_temp, current, recent, unknown, asset):
        _zip(path)
    _old(active_temp)
    _old(unknown)
    _old(asset)
    job = BackgroundJob(id=current_id, job_type="conversation_export", status="committed")
    artifact = ExportArtifact(
        id=uuid.uuid4(),
        job_id=job.id,
        conversation_id=None,
        scope_type="system",
        format="system",
        filename=current.name,
        storage_uri=str(current),
        sha256="hash",
        byte_size=current.stat().st_size,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    with factory() as db:
        db.add_all([job, artifact, BackgroundJob(id=active_id, job_type="conversation_export", status="processing")])
        db.commit()
        scan = scan_cleanup_candidates(
            db,
            roots={"export": export_root, "offline": offline_root, "asset": asset_root},
        )
    assert scan.summary["UNSAFE_PROTECTED"]["candidate_count"] == 5
    assert not scan.candidates


def test_recent_server_generated_staging_file_is_protected(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "exports"
    recent = staging_path(root / str(uuid.uuid4()) / "recent.zip")
    _zip(recent)
    with factory() as db:
        scan = scan_cleanup_candidates(db, roots={"export": root})
    assert scan.summary["UNSAFE_PROTECTED"] == {
        "candidate_count": 1,
        "candidate_bytes": recent.stat().st_size,
    }
    assert not scan.candidates


def test_canonical_retained_conversation_export_is_protected(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "exports"
    job = BackgroundJob(id=uuid.uuid4(), job_type="conversation_export", status="committed")
    retained = root / str(job.id) / "retained.zip"
    _zip(retained)
    _old(retained)
    artifact = ExportArtifact(
        id=uuid.uuid4(),
        job_id=job.id,
        conversation_id=None,
        scope_type="conversation",
        format="markdown_bundle",
        filename=retained.name,
        storage_uri=str(retained),
        sha256="hash",
        byte_size=retained.stat().st_size,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    with factory() as db:
        db.add_all([job, artifact])
        db.commit()
        scan = scan_cleanup_candidates(db, roots={"export": root})
    assert scan.summary["UNSAFE_PROTECTED"]["candidate_count"] == 1
    assert not scan.candidates


def test_current_offline_artifact_is_protected_and_superseded_artifact_is_classified(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "offline"
    current_job_id = uuid.uuid4()
    old_job_id = uuid.uuid4()
    current = root / f"offline-all-{current_job_id}.crpkg"
    old = root / f"offline-all-{old_job_id}.crpkg"
    for path in (current, old):
        _zip(path)
        _old(path)
    current_job = BackgroundJob(
        id=current_job_id,
        job_type="offline_package",
        status="committed",
        result={"filename": current.name},
    )
    old_job = BackgroundJob(
        id=old_job_id,
        job_type="offline_package",
        status="committed",
        result={"filename": old.name},
    )
    artifact = OfflinePackageArtifact(
        id=uuid.uuid4(),
        job_id=current_job_id,
        subject_key="local:default",
        scope_type="all",
        scope_id=None,
        catalog_revision="revision",
        filename=current.name,
        storage_uri=str(current),
        sha256="hash",
        byte_size=current.stat().st_size,
        conversation_count=1,
    )
    with factory() as db:
        db.add_all([current_job, old_job, artifact])
        db.commit()
        scan = scan_cleanup_candidates(db, roots={"offline": root})
    assert scan.summary["UNSAFE_PROTECTED"]["candidate_count"] == 1
    assert scan.summary["SUPERSEDED_ARTIFACT"]["candidate_count"] == 1
    assert len(scan.candidates) == 1
    assert scan.candidates[0].candidate_type == "SUPERSEDED_ARTIFACT"
    assert scan.candidates[0].path == old.resolve()


def test_dry_run_and_manual_apply_are_two_pass_explicit_and_idempotent(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "exports"
    orphan = root / str(uuid.uuid4()) / "orphan.zip"
    _zip(orphan)
    _old(orphan)
    with factory() as db:
        first = scan_cleanup_candidates(db, roots={"export": root})
        second = scan_cleanup_candidates(db, roots={"export": root})
        assert first.summary == second.summary
        assert first.candidates[0].token == second.candidates[0].token
        assert orphan.exists()
        result = execute_cleanup_candidates(
            db,
            roots={"export": root},
            category="ORPHAN_FINAL",
            confirmed_tokens=[first.candidates[0].token],
        )
        assert result.deleted_count == 1
        repeated = execute_cleanup_candidates(
            db,
            roots={"export": root},
            category="ORPHAN_FINAL",
            confirmed_tokens=[first.candidates[0].token],
        )
    assert not orphan.exists()
    assert repeated.deleted_count == 0
    assert repeated.skipped_changed_count == 1


def test_apply_rejects_confirmed_token_from_another_category(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "exports"
    orphan = root / str(uuid.uuid4()) / "orphan.zip"
    _zip(orphan)
    _old(orphan)
    with factory() as db:
        candidate = scan_cleanup_candidates(db, roots={"export": root}).candidates[0]
        result = execute_cleanup_candidates(
            db,
            roots={"export": root},
            category="SAFE_TEMP",
            confirmed_tokens=[candidate.token],
        )
    assert result.deleted_count == 0
    assert result.skipped_changed_count == 1
    assert orphan.exists()


def test_diagnostics_scan_budget_is_reported_as_incomplete(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "exports"
    for _ in range(3):
        path = root / str(uuid.uuid4()) / "orphan.zip"
        _zip(path)
        _old(path)
    with factory() as db:
        scan = scan_cleanup_candidates(db, roots={"export": root}, max_files=2)
    assert scan.complete is False
    assert sum(value["candidate_count"] for value in scan.summary.values()) == 2


def test_recheck_skips_candidate_that_becomes_canonical_or_active(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "exports"
    canonical_job_id = uuid.uuid4()
    active_job_id = uuid.uuid4()
    canonical_path = root / str(canonical_job_id) / "canonical.zip"
    active_path = root / str(active_job_id) / "active.zip"
    for path in (canonical_path, active_path):
        _zip(path)
        _old(path)
    with factory() as db:
        scan = scan_cleanup_candidates(db, roots={"export": root})
        tokens = {item.path: item.token for item in scan.candidates}

        def become_referenced() -> None:
            job = BackgroundJob(id=canonical_job_id, job_type="conversation_export", status="committed")
            db.add_all(
                [
                    job,
                    ExportArtifact(
                        id=uuid.uuid4(),
                        job_id=job.id,
                        conversation_id=None,
                        scope_type="system",
                        format="system",
                        filename=canonical_path.name,
                        storage_uri=str(canonical_path),
                        sha256="hash",
                        byte_size=canonical_path.stat().st_size,
                        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
                    ),
                    BackgroundJob(id=active_job_id, job_type="conversation_export", status="processing"),
                ]
            )
            db.commit()

        result = execute_cleanup_candidates(
            db,
            roots={"export": root},
            category="ORPHAN_FINAL",
            confirmed_tokens=[tokens[canonical_path], tokens[active_path]],
            before_recheck=become_referenced,
        )
    assert result.skipped_changed_count == 2
    assert canonical_path.exists() and active_path.exists()


def test_apply_handles_disappearance_and_partial_permission_failure(tmp_path: Path, monkeypatch) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "offline"
    first = root / f"offline-all-{uuid.uuid4()}.crpkg"
    second = root / f"offline-all-{uuid.uuid4()}.crpkg"
    for path in (first, second):
        _zip(path)
        _old(path)
    with factory() as db:
        current_job = BackgroundJob(id=uuid.uuid4(), job_type="offline_package", status="committed")
        current = root / f"offline-all-{current_job.id}.crpkg"
        _zip(current)
        _old(current)
        current_artifact = OfflinePackageArtifact(
            id=uuid.uuid4(),
            job_id=current_job.id,
            subject_key="local:default",
            scope_type="all",
            scope_id=None,
            catalog_revision="current",
            filename=current.name,
            storage_uri=str(current),
            sha256="hash",
            byte_size=current.stat().st_size,
            conversation_count=1,
        )
        db.add_all([current_job, current_artifact])
        db.commit()
        canonical_before = (
            db.query(BackgroundJob).count(),
            db.query(OfflinePackageArtifact).count(),
            db.get(OfflinePackageArtifact, current_artifact.id).storage_uri,
        )
        scan = scan_cleanup_candidates(db, roots={"offline": root})
        tokens = {item.path: item.token for item in scan.candidates}
        original_unlink = Path.unlink

        def fail_second(path: Path, *args, **kwargs):
            if path == second:
                raise PermissionError("injected")
            return original_unlink(path, *args, **kwargs)

        monkeypatch.setattr(Path, "unlink", fail_second)
        result = execute_cleanup_candidates(
            db,
            roots={"offline": root},
            category="ORPHAN_FINAL",
            confirmed_tokens=[tokens[first], tokens[second]],
        )
        db.expire_all()
        canonical_after = (
            db.query(BackgroundJob).count(),
            db.query(OfflinePackageArtifact).count(),
            db.get(OfflinePackageArtifact, current_artifact.id).storage_uri,
        )
    assert result.deleted_count == 1
    assert result.failed_count == 1
    assert result.as_dict()["failure_categories"] == {"unlink_failed": 1}
    assert canonical_after == canonical_before
    assert current.exists()
    assert not first.exists() and second.exists()


def test_file_disappearing_before_recheck_is_idempotent_skip(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "offline"
    orphan = root / f"offline-all-{uuid.uuid4()}.crpkg"
    _zip(orphan)
    _old(orphan)
    with factory() as db:
        token = scan_cleanup_candidates(db, roots={"offline": root}).candidates[0].token
        result = execute_cleanup_candidates(
            db,
            roots={"offline": root},
            category="ORPHAN_FINAL",
            confirmed_tokens=[token],
            before_recheck=orphan.unlink,
        )
    assert result.already_absent_count == 1


def test_outside_symlink_is_never_eligible(tmp_path: Path) -> None:
    factory = _factory(tmp_path)
    root = tmp_path / "exports"
    outside = tmp_path / "outside.zip"
    _zip(outside)
    link = root / str(uuid.uuid4()) / "link.zip"
    link.parent.mkdir(parents=True)
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("symlink creation is unavailable in this environment")
    with factory() as db:
        scan = scan_cleanup_candidates(db, roots={"export": root}, grace_seconds=0)
    assert scan.summary["UNSAFE_PROTECTED"]["candidate_count"] == 1
    assert not scan.candidates
