import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.archive_restore import ArchiveRestoreReceipt
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.user import User
from app.models.user_preference import UserPreference
from app.services.background_jobs import claim_next_job, process_background_job
from app.services.exporting.archive_jobs import receive_personal_archive
from app.services.exporting.system_archive import SystemArchiveError
from app.services.ownership import OwnershipScope, ownership_scope_from_request
from test_personal_restore import restore_fixture
from test_system_archive_integrity import archive_db  # noqa: F401


@pytest.fixture
def archive_client(archive_db, monkeypatch):
    path, owner, _, _ = restore_fixture(archive_db)
    engine = archive_db.get_bind()
    monkeypatch.setenv("AUTH_ENABLED", "false")
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    active_owner = [owner]
    def database():
        with Session(engine) as db:
            yield db
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[ownership_scope_from_request] = lambda: OwnershipScope(active_owner[0])
    with TestClient(app) as client:
        yield client, path, owner, active_owner, engine
    app.dependency_overrides.clear()
    app.dependency_overrides.update(previous)
    get_settings.cache_clear()


def run_job(engine, job_id, kind):
    with Session(engine) as db:
        assert claim_next_job(db, job_type=kind) == uuid.UUID(job_id)
        db.commit()
    process_background_job(uuid.UUID(job_id), session_factory=sessionmaker(bind=engine))


def upload(client, path, key=None):
    return client.post("/api/me/archive/previews", headers={"Idempotency-Key": key or str(uuid.uuid4())},
                       files={"file": ("synthetic.cr", path.read_bytes(), "application/octet-stream")})


def ready_preview(client, path, engine):
    queued = upload(client, path)
    assert queued.status_code == 202
    job = queued.json()
    assert job["cancellable"]
    run_job(engine, job["job_id"], "personal_archive_preflight")
    task = client.get(f"/api/tasks/{job['job_id']}").json()
    assert task["status"] == "committed", task
    assert task["result"]["restore_mode"] == "additive"
    assert task["result"]["artifact_available"] is True
    return task


def test_personal_archive_api_requires_preview_keeps_ownership_and_reenters_tasks(archive_client):
    client, path, owner, active, engine = archive_client
    queued = upload(client, path, "synthetic-preview")
    assert queued.status_code == 202
    assert upload(client, path, "synthetic-preview").json()["job_id"] == queued.json()["job_id"]
    job_id = queued.json()["job_id"]
    assert client.post("/api/me/archive/restores", json={"preview_job_id": job_id, "content_digest": "a" * 64}).status_code == 409
    with Session(engine) as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(job_id)).one()
        assert client.get(f"/api/exports/{artifact.id}/download").status_code == 404
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 0
    run_job(engine, job_id, "personal_archive_preflight")
    task = client.get(f"/api/tasks/{job_id}").json()
    assert task["status"] == "committed", task
    payload = {"preview_job_id": job_id, "content_digest": task["result"]["content_digest"]}
    active[0] = uuid.uuid4()
    with Session(engine) as db:
        db.add(User(id=active[0], normalized_email="other-archive@example.test")); db.commit()
    assert client.get(f"/api/tasks/{job_id}").status_code == 404
    assert client.post("/api/me/archive/restores", json=payload).status_code == 404
    assert client.delete(f"/api/me/archive/previews/{job_id}").status_code == 404
    assert client.get("/api/me/archive/tasks").json() == []
    active[0] = owner
    recent = client.get("/api/me/archive/tasks").json()
    assert len(recent) == 1 and recent[0]["result"]["artifact_available"]
    restore = client.post("/api/me/archive/restores", json=payload)
    assert restore.status_code == 202
    assert client.post("/api/me/archive/restores", json=payload).json()["job_id"] == restore.json()["job_id"]
    assert client.post("/api/me/archive/restores", json={**payload, "include_preferences": True}).status_code == 409
    assert client.delete(f"/api/me/archive/previews/{job_id}").status_code == 409
    run_job(engine, restore.json()["job_id"], "personal_archive_restore")
    restored = client.get(f"/api/tasks/{restore.json()['job_id']}").json()
    assert restored["status"] == "committed", restored
    assert restored["result"]["counts"]["conversations"] == 1
    with Session(engine) as db:
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 1
        assert db.get(UserPreference, str(owner)).theme_mode == "light"
        assert db.query(ArchiveRestoreReceipt).count() == 1
        artifact_path = Path(db.query(ExportArtifact).filter_by(job_id=uuid.UUID(job_id)).one().storage_uri)
    assert client.delete(f"/api/me/archive/previews/{job_id}").status_code == 204
    assert not artifact_path.exists()
    assert client.get(f"/api/tasks/{job_id}").json()["result"]["artifact_available"] is False
    assert client.delete(f"/api/me/archive/previews/{job_id}").status_code == 204
    with Session(engine) as db:
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 1


def test_personal_export_download_and_expiry_rebuild(archive_client):
    client, path, owner, active, engine = archive_client
    request = {"headers": {"Idempotency-Key": "synthetic-export"}, "json": {"include_archived": True}}
    queued = client.post("/api/me/archive/exports", **request)
    assert queued.status_code == 202
    assert client.post("/api/me/archive/exports", **request).json()["job_id"] == queued.json()["job_id"]
    run_job(engine, queued.json()["job_id"], "personal_archive_export")
    task = client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert task["status"] == "committed", task
    data = client.get(task["result"]["download_url"])
    assert data.status_code == 200
    import zipfile
    with zipfile.ZipFile(io.BytesIO(data.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["format"] == "chat-reader-personal-archive"
        assert archive.read("data/conversations.jsonl") == b""  # The target account is empty.
    with Session(engine) as db:
        artifact = db.get(ExportArtifact, uuid.UUID(task["result"]["artifact_id"]))
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    assert client.get(task["result"]["download_url"]).status_code == 410
    assert not client.get("/api/me/archive/tasks").json()[0]["result"]["artifact_available"]
    rebuilt = client.post("/api/me/archive/exports", json={}, headers={"Idempotency-Key": "new-export"})
    assert rebuilt.status_code == 202 and rebuilt.json()["job_id"] != queued.json()["job_id"]


def test_expired_preview_requires_upload_but_already_admitted_restore_can_finish(archive_client):
    client, path, owner, _, engine = archive_client
    preview = ready_preview(client, path, engine)
    payload = {"preview_job_id": preview["job_id"], "content_digest": preview["result"]["content_digest"]}
    with Session(engine) as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(preview["job_id"])).one()
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1); db.commit()
    assert client.post("/api/me/archive/restores", json=payload).status_code == 410
    assert client.get(f"/api/tasks/{preview['job_id']}").json()["result"]["artifact_available"] is False
    with Session(engine) as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(preview["job_id"])).one()
        artifact.expires_at = datetime.now(timezone.utc) + timedelta(hours=1); db.commit()
    queued = client.post("/api/me/archive/restores", json=payload).json()
    with Session(engine) as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(preview["job_id"])).one()
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1); db.commit()
    run_job(engine, queued["job_id"], "personal_archive_restore")
    assert client.get(f"/api/tasks/{queued['job_id']}").json()["status"] == "committed"


def test_corrupt_upload_is_a_failed_retryable_task_with_no_import(archive_client, tmp_path):
    client, _, owner, _, engine = archive_client
    path = tmp_path / "bad.cr"; path.write_bytes(b"synthetic malformed archive")
    job = upload(client, path).json()
    run_job(engine, job["job_id"], "personal_archive_preflight")
    task = client.get(f"/api/tasks/{job['job_id']}").json()
    assert task["status"] == "failed" and "malformed" in task["error_message"]
    assert client.post(f"/api/tasks/{job['job_id']}/retry").json()["status"] == "queued"
    assert client.post(f"/api/tasks/{job['job_id']}/cancel").json()["status"] == "cancelled"
    assert client.delete(f"/api/me/archive/previews/{job['job_id']}").status_code == 204
    with Session(engine) as db:
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 0


def test_worker_failure_is_redacted_and_restore_retries_without_duplicates(archive_client, monkeypatch):
    client, path, owner, _, engine = archive_client
    preview = ready_preview(client, path, engine)
    queued = client.post("/api/me/archive/restores", json={"preview_job_id": preview["job_id"],
        "content_digest": preview["result"]["content_digest"]}).json()
    from app.services.exporting import archive_jobs
    real = archive_jobs.restore_personal_archive
    def fail(*args, **kwargs):
        real(*args, **kwargs)
        raise RuntimeError("synthetic-private-body SQL parameters C:/private/path")
    monkeypatch.setattr(archive_jobs, "restore_personal_archive", fail)
    run_job(engine, queued["job_id"], "personal_archive_restore")
    task = client.get(f"/api/tasks/{queued['job_id']}").json()
    assert task["status"] == "failed" and "synthetic-private" not in task["error_message"]
    with Session(engine) as db:
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 0
        assert db.query(ArchiveRestoreReceipt).count() == 0
    monkeypatch.setattr(archive_jobs, "restore_personal_archive", real)
    client.post(f"/api/tasks/{queued['job_id']}/retry")
    run_job(engine, queued["job_id"], "personal_archive_restore")
    assert client.get(f"/api/tasks/{queued['job_id']}").json()["status"] == "committed"
    with Session(engine) as db:
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 1


def test_upload_size_failure_and_outer_rollback_remove_staged_files(archive_db, monkeypatch):
    owner = User(normalized_email="upload-owner@example.test")
    archive_db.add(owner); archive_db.commit()
    root = Path(get_settings().export_storage_dir)
    monkeypatch.setenv("BUNDLE_MAX_COMPRESSED_BYTES", "10"); get_settings.cache_clear()
    with pytest.raises(SystemArchiveError):
        receive_personal_archive(archive_db, io.BytesIO(b"too large synthetic content"), owner=owner.id, key="size")
    archive_db.rollback()
    assert not list(root.rglob("*.cr")) and not list(root.rglob("*.tmp.*"))
    receive_personal_archive(archive_db, io.BytesIO(b"synthetic"), owner=owner.id, key="rollback")
    archive_db.rollback()
    assert not list(root.rglob("*.cr"))
