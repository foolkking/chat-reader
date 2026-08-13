from __future__ import annotations

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
from app.services.artifact_lifecycle import (
    ArtifactLifecycleError,
    classify_artifact_files,
    cleanup_committed_artifacts,
    publish_zip_artifact,
    staging_path,
    validate_final_artifact,
)


def _zip(path: Path, entry: str = "manifest.json", payload: bytes = b"{}") -> None:
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(entry, payload)


def test_staging_validation_publish_and_download_integrity(tmp_path: Path) -> None:
    final = tmp_path / "artifact.cr"
    temporary = staging_path(final)
    assert temporary.parent == final.parent
    _zip(temporary)
    published = publish_zip_artifact(
        temporary,
        final,
        category="export",
        artifact_id=uuid.uuid4(),
        required_entries=("manifest.json",),
    )
    assert not temporary.exists()
    assert validate_final_artifact(final, expected_sha256=published.sha256, expected_size=published.byte_size)
    assert validate_final_artifact(
        final,
        expected_sha256=published.sha256,
        expected_size=published.byte_size,
        verify_hash=True,
    )


def test_validation_and_rename_failures_never_publish(monkeypatch, tmp_path: Path) -> None:
    final = tmp_path / "artifact.crpkg"
    invalid = staging_path(final)
    invalid.write_bytes(b"not-a-zip")
    with pytest.raises(ArtifactLifecycleError):
        publish_zip_artifact(invalid, final, category="offline", artifact_id=uuid.uuid4())
    assert not final.exists()

    temporary = staging_path(final)
    _zip(temporary, "package.json")
    monkeypatch.setattr("app.services.artifact_lifecycle.os.replace", lambda *_: (_ for _ in ()).throw(OSError("injected")))
    with pytest.raises(ArtifactLifecycleError):
        publish_zip_artifact(
            temporary,
            final,
            category="offline",
            artifact_id=uuid.uuid4(),
            required_entries=("package.json",),
        )
    assert not final.exists()


def test_outer_rollback_preserves_previous_offline_artifact(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'lifecycle.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    root = tmp_path / "offline"
    root.mkdir()
    old_path = root / "offline-conversation-old.crpkg"
    _zip(old_path, "package.json")
    old_job = BackgroundJob(id=uuid.uuid4(), job_type="offline_package", status="committed")
    old_id = uuid.uuid4()
    old = OfflinePackageArtifact(
        id=old_id,
        job_id=old_job.id,
        subject_key="local:default",
        scope_type="all",
        scope_id=None,
        catalog_revision="old",
        filename=old_path.name,
        storage_uri=str(old_path),
        sha256="old",
        byte_size=old_path.stat().st_size,
        conversation_count=1,
    )
    with factory() as db:
        db.add_all([old_job, old])
        db.commit()

    new_path = root / "offline-all-new.crpkg"
    _zip(new_path, "package.json")
    with factory() as db:
        previous = db.get(OfflinePackageArtifact, old_id)
        assert previous is not None
        db.delete(previous)
        db.add(BackgroundJob(id=uuid.uuid4(), job_type="offline_package", status="processing"))
        db.flush()
        db.rollback()

    with factory() as db:
        assert db.get(OfflinePackageArtifact, old_id) is not None
    assert old_path.is_file()
    assert new_path.is_file()  # Allowed orphan; canonical state remains intact.


def test_cleanup_failure_is_debt_and_classifier_protects_references(monkeypatch, tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'classifier.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    export_root = tmp_path / "exports"
    offline_root = tmp_path / "offline"
    export_root.mkdir()
    offline_root.mkdir()
    current = export_root / "current.cr"
    orphan = export_root / "orphan.zip"
    temporary = staging_path(offline_root / "package.crpkg")
    user_named = export_root / "user.tmp.final.cr"
    _zip(current)
    _zip(orphan)
    temporary.write_bytes(b"temp")
    _zip(user_named)
    job = BackgroundJob(id=uuid.uuid4(), job_type="conversation_export", status="committed")
    artifact = ExportArtifact(
        id=uuid.uuid4(),
        job_id=job.id,
        conversation_id=None,
        scope_type="system",
        format="system",
        filename=current.name,
        storage_uri=str(current),
        sha256="declared",
        byte_size=current.stat().st_size,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    with factory() as db:
        db.add_all([job, artifact])
        db.commit()
        result = classify_artifact_files(db, roots={"export": export_root, "offline": offline_root})
    assert result["UNSAFE_PROTECTED"]["candidate_count"] == 1
    assert result["ORPHAN_FINAL"]["candidate_count"] == 2
    assert result["SAFE_TEMP"]["candidate_count"] == 1
    assert result["UNSAFE_PROTECTED"]["candidate_count"] == 1

    monkeypatch.setattr(Path, "unlink", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("injected")))
    assert cleanup_committed_artifacts([orphan], root=export_root, category="export") == 1
    assert orphan.exists()


def test_context_staging_name_is_a_safe_temp_candidate(tmp_path: Path) -> None:
    final = tmp_path / "exports" / "conversation.canjsonl"
    temporary = staging_path(final)
    assert temporary.name.startswith(".conversation.canjsonl.tmp.")
