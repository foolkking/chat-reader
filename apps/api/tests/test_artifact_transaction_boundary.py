from __future__ import annotations

import uuid
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.models.offline_package_artifact import OfflinePackageArtifact
from app.services.background_jobs import claim_next_job, process_background_job
from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import commit_edit_sample


class CommitFailureSession(Session):
    def commit(self) -> None:
        raise RuntimeError("injected outer commit failure")


def _factory_from_client() -> sessionmaker:
    override = app.dependency_overrides[get_db]
    generator = override()
    db = next(generator)
    factory = sessionmaker(bind=db.get_bind(), autoflush=False, autocommit=False)
    db.close()
    generator.close()
    return factory


def _claim(factory: sessionmaker) -> uuid.UUID:
    with factory() as db:
        job_id = claim_next_job(db)
        assert job_id is not None
        db.commit()
        return job_id


def _process_with_final_commit_failure(job_id: uuid.UUID, factory: sessionmaker) -> None:
    calls = 0

    def sessions():
        nonlocal calls
        calls += 1
        if calls == 1:
            return CommitFailureSession(bind=factory.kw["bind"], autoflush=False, autocommit=False)
        return factory()

    process_background_job(job_id, sessions)


def test_offline_outer_commit_failure_preserves_previous_committed_package(client, monkeypatch, tmp_path: Path) -> None:
    root = tmp_path / "offline"
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(root))
    get_settings.cache_clear()
    conversation_id = commit_edit_sample(client)["conversation_id"]
    factory = _factory_from_client()

    first = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "release-b-offline-first"},
    ).json()
    first_job = _claim(factory)
    assert str(first_job) == first["job_id"]
    process_background_job(first_job, factory)
    with factory() as db:
        old = db.get(OfflinePackageArtifact, uuid.UUID(first["package_id"]))
        assert old is not None
        old_path = Path(old.storage_uri)
        assert old_path.is_file()

    second = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "release-b-offline-second"},
    ).json()
    second_job = _claim(factory)
    assert str(second_job) == second["job_id"]
    _process_with_final_commit_failure(second_job, factory)

    with factory() as db:
        assert db.get(OfflinePackageArtifact, uuid.UUID(first["package_id"])) is not None
        assert db.get(OfflinePackageArtifact, uuid.UUID(second["package_id"])) is None
        failed = db.get(BackgroundJob, second_job)
        assert failed is not None and failed.status == "failed"
    assert old_path.is_file()
    assert client.get(f"/api/offline/packages/{first['package_id']}/download").status_code == 200


def test_export_outer_commit_failure_never_exposes_uncommitted_artifact(client, tmp_path: Path) -> None:
    conversation_id = commit_edit_sample(client)["conversation_id"]
    factory = _factory_from_client()
    queued = client.post(
        f"/api/conversations/{conversation_id}/exports",
        headers={"Idempotency-Key": "release-b-export-commit-failure"},
    ).json()
    job_id = _claim(factory)
    assert str(job_id) == queued["job_id"]
    _process_with_final_commit_failure(job_id, factory)

    with factory() as db:
        assert db.query(ExportArtifact).filter(ExportArtifact.job_id == job_id).first() is None
        failed = db.get(BackgroundJob, job_id)
        assert failed is not None and failed.status == "failed"
    published_files = list((tmp_path / "storage" / "exports" / str(job_id)).glob("*.cr"))
    assert len(published_files) == 1  # Allowed orphan; no committed DB reference exists.


def test_offline_replacement_cleans_old_artifact_only_after_commit(client, monkeypatch, tmp_path: Path) -> None:
    root = tmp_path / "offline"
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(root))
    get_settings.cache_clear()
    conversation_id = commit_edit_sample(client)["conversation_id"]
    factory = _factory_from_client()

    first = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "release-b-offline-replace-first"},
    ).json()
    first_job = _claim(factory)
    process_background_job(first_job, factory)
    with factory() as db:
        old = db.get(OfflinePackageArtifact, uuid.UUID(first["package_id"]))
        assert old is not None
        old_path = Path(old.storage_uri)
        assert old_path.is_file()

    second = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "release-b-offline-replace-second"},
    ).json()
    second_job = _claim(factory)
    process_background_job(second_job, factory)
    with factory() as db:
        current = db.get(OfflinePackageArtifact, uuid.UUID(second["package_id"]))
        assert current is not None
        assert db.get(OfflinePackageArtifact, uuid.UUID(first["package_id"])) is None
        committed = db.get(BackgroundJob, second_job)
        assert committed is not None and committed.status == "committed"
    assert not old_path.exists()
    assert client.get(f"/api/offline/packages/{second['package_id']}/download").status_code == 200


def test_offline_cleanup_failure_is_debt_not_publication_failure(client, monkeypatch, tmp_path: Path) -> None:
    root = tmp_path / "offline"
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(root))
    get_settings.cache_clear()
    conversation_id = commit_edit_sample(client)["conversation_id"]
    factory = _factory_from_client()

    first = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "release-b-offline-debt-first"},
    ).json()
    process_background_job(_claim(factory), factory)
    with factory() as db:
        old = db.get(OfflinePackageArtifact, uuid.UUID(first["package_id"]))
        assert old is not None
        old_path = Path(old.storage_uri)

    monkeypatch.setattr(
        "app.services.background_jobs.cleanup_committed_artifacts",
        lambda *_args, **_kwargs: 1,
    )
    second = client.post(
        "/api/offline/packages",
        json={"scope": "conversation", "conversation_id": conversation_id},
        headers={"Idempotency-Key": "release-b-offline-debt-second"},
    ).json()
    second_job = _claim(factory)
    process_background_job(second_job, factory)
    with factory() as db:
        current = db.get(OfflinePackageArtifact, uuid.UUID(second["package_id"]))
        committed = db.get(BackgroundJob, second_job)
        assert current is not None
        assert committed is not None and committed.status == "committed"
    assert old_path.is_file()
    assert client.get(f"/api/offline/packages/{second['package_id']}/download").status_code == 200


def test_download_rejects_artifacts_until_the_owning_job_commits(client, tmp_path: Path) -> None:
    factory = _factory_from_client()
    export_path = tmp_path / "storage" / "exports" / "pending.cr"
    export_path.parent.mkdir(parents=True, exist_ok=True)
    export_path.write_bytes(b"PK\x03\x04")
    offline_path = tmp_path / "storage" / "offline" / "pending.crpkg"
    offline_path.parent.mkdir(parents=True, exist_ok=True)
    offline_path.write_bytes(b"PK\x03\x04")
    export_job_id = uuid.uuid4()
    offline_job_id = uuid.uuid4()
    export_id = uuid.uuid4()
    offline_id = uuid.uuid4()
    with factory() as db:
        db.add_all([
            BackgroundJob(id=export_job_id, job_type="conversation_export", status="processing"),
            BackgroundJob(id=offline_job_id, job_type="offline_package", status="processing"),
            ExportArtifact(
                id=export_id, job_id=export_job_id, conversation_id=None, scope_type="system", format="system",
                filename=export_path.name, storage_uri=str(export_path), sha256="pending", byte_size=export_path.stat().st_size,
                expires_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc) + __import__("datetime").timedelta(hours=1),
            ),
            OfflinePackageArtifact(
                id=offline_id, job_id=offline_job_id, subject_key="local:default", scope_type="all", scope_id=None,
                catalog_revision="pending", filename=offline_path.name, storage_uri=str(offline_path), sha256="pending",
                byte_size=offline_path.stat().st_size, conversation_count=0,
            ),
        ])
        db.commit()
    assert client.get(f"/api/exports/{export_id}/download").status_code == 409
    assert client.get(f"/api/offline/packages/{offline_id}").status_code == 409
    assert client.get(f"/api/offline/packages/{offline_id}/download").status_code == 409
