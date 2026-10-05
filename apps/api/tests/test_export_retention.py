"""Actual file/DB/HTTP lifecycle results; all payloads are synthetic."""
import asyncio
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.api.routes.archive_exports import router
from app.core.config import get_settings
from app.core.database import Base, get_db
from app.models.administration import InstanceFeaturePolicy
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact, ExportArtifactLease
from app.models.user import User
from app.services.export_download import ExportFileResponse
from app.services.export_retention import (
    acquire_download, acquire_viewer, artifact_status, claim_download,
    finalize_export_lifetime, owned_export, reclaim_exports, release_download,
    release_viewer, renew_download, utc,
)
from app.services.ownership import OwnershipScope, ownership_scope_from_request
from test_import_preview_api import client  # noqa: F401

NOW = datetime(2026, 10, 6, 0, 0, tzinfo=timezone.utc)
BODY = b"synthetic export bytes\n" * 10000


def test_status_missing_file_offers_regeneration_without_claiming_reclaimed(exports):
    factory, _, make, _ = exports
    identity, path, _ = make()
    path.unlink()
    with factory() as db:
        row = db.get(ExportArtifact, identity)
        result = artifact_status(row, now=NOW)
        assert result["status"] == "unavailable"
        assert result["download_url"] is None
        assert result["next_action"] == "regenerate"
        assert row.lifecycle_state == "active"


@pytest.fixture
def exports(tmp_path, monkeypatch):
    root = tmp_path / "exports"
    root.mkdir()
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(root))
    get_settings.cache_clear()
    engine = create_engine(f"sqlite:///{tmp_path / 'state.db'}")
    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        owners = [User(normalized_email=f"export-{i}@example.test") for i in range(2)]
        db.add_all(owners)
        db.commit()
        owner_ids = [row.id for row in owners]
    def make(*, scope="conversation", status="committed", job_type="conversation_export", owner=None, expires=None):
        with factory() as db:
            job = BackgroundJob(job_type=job_type, status=status, owner_user_id=owner or owner_ids[0])
            db.add(job)
            db.flush()
            path = root / str(job.id) / "synthetic.context.zip"
            path.parent.mkdir()
            path.write_bytes(BODY)
            artifact = ExportArtifact(job_id=job.id, scope_type=scope, format="context_package",
                                      filename=path.name, storage_uri=str(path), byte_size=len(BODY),
                                      sha256=hashlib.sha256(BODY).hexdigest(), release_on_close=True,
                                      expires_at=expires or NOW + timedelta(minutes=3))
            db.add(artifact)
            db.flush()
            job.result = {"artifact_id": str(artifact.id), "download_url": f"/api/exports/{artifact.id}/download"}
            db.commit()
            return artifact.id, path, job.id
    yield factory, root, make, owner_ids
    engine.dispose()
    get_settings.cache_clear()


def test_lifetime_starts_at_publication_and_partial_policy_update_preserves_values(exports):
    from app.services.feature_policies import update_feature_policy
    factory, root, make, owners = exports
    identity, path, job_id = make(status="processing")
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        result = dict(job.result)
        policy = InstanceFeaturePolicy(id=1, export_retention_minutes=7, export_release_on_close=False)
        db.add(policy)
        db.flush()
        update_feature_policy(db, actor_user_id=owners[0], values={"allow_share_links": False})
        finalize_export_lifetime(db, job, result, now=NOW)
        job.result = result
        db.commit()
    with factory() as db:
        artifact = db.get(ExportArtifact, identity)
        assert utc(artifact.expires_at) == NOW + timedelta(minutes=7)
        assert artifact.retention_seconds == 420 and not artifact.release_on_close
        assert db.get(BackgroundJob, job_id).result["retention_seconds"] == 420
    assert path.read_bytes() == BODY


def test_two_windows_close_independently_and_reclaim_exact_file(exports):
    factory, root, make, owners = exports
    identity, path, job_id = make()
    first, second = uuid.uuid4(), uuid.uuid4()
    with factory() as db:
        artifact = owned_export(db, identity, OwnershipScope(owners[0]), lock=True)
        acquire_viewer(db, artifact, first, now=NOW)
        acquire_viewer(db, artifact, second, now=NOW)
        release_viewer(db, artifact, first, now=NOW)
        db.commit()
    assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == 0
    assert path.is_file()
    with factory() as db:
        artifact = owned_export(db, identity, OwnershipScope(owners[0]), lock=True)
        release_viewer(db, artifact, second, now=NOW)
        db.commit()
    result = reclaim_exports(factory, root, now=NOW)
    assert result["reclaimed"] == 1 and result["bytes"] == len(BODY)
    assert not path.exists()
    assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == 0
    with factory() as db:
        assert db.get(ExportArtifact, identity).lifecycle_state == "reclaimed"
        assert db.get(BackgroundJob, job_id).result["download_url"] is None


def test_viewer_and_claim_never_extend_expiry(exports):
    factory, root, make, _ = exports
    identity, path, _ = make()
    with factory() as db:
        artifact = db.get(ExportArtifact, identity)
        acquire_viewer(db, artifact, uuid.uuid4(), now=NOW + timedelta(seconds=179))
        claim_download(db, artifact, uuid.uuid4(), now=NOW + timedelta(seconds=179))
        assert all(utc(row.expires_at) == NOW + timedelta(seconds=180) for row in db.query(ExportArtifactLease))
        db.commit()
    assert reclaim_exports(factory, root, now=NOW + timedelta(seconds=180))["reclaimed"] == 1
    assert not path.exists()


def test_download_claim_protects_click_then_close_and_is_single_use(exports):
    factory, root, make, _ = exports
    identity, path, _ = make()
    viewer, claim = uuid.uuid4(), uuid.uuid4()
    with factory() as db:
        artifact = db.get(ExportArtifact, identity)
        acquire_viewer(db, artifact, viewer, now=NOW)
        claim_download(db, artifact, claim, now=NOW)
        release_viewer(db, artifact, viewer, now=NOW)
        db.commit()
    assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == 0
    with factory() as db:
        artifact = db.get(ExportArtifact, identity)
        assert acquire_download(db, artifact, claim_id=claim, now=NOW) == claim
        db.commit()
        with pytest.raises(HTTPException) as error:
            acquire_download(db, artifact, claim_id=claim, now=NOW)
        assert error.value.status_code == 410
    release_download(factory, identity, claim)
    assert reclaim_exports(factory, root, now=NOW)["reclaimed"] == 1
    assert not path.exists()


def test_live_download_survives_expiry_then_reclaims_and_new_download_is_denied(exports):
    factory, root, make, _ = exports
    identity, path, _ = make()
    with factory() as db:
        lease = acquire_download(db, db.get(ExportArtifact, identity), now=NOW + timedelta(seconds=170))
        db.commit()
    after = NOW + timedelta(seconds=200)
    assert renew_download(factory, identity, lease, now=after)
    assert reclaim_exports(factory, root, now=after)["reclaimed"] == 0
    assert path.read_bytes() == BODY
    with factory() as db:
        with pytest.raises(HTTPException) as error:
            acquire_download(db, db.get(ExportArtifact, identity), now=after)
        assert error.value.status_code == 410
    release_download(factory, identity, lease)
    assert reclaim_exports(factory, root, now=after)["bytes"] == len(BODY)


def test_crashed_download_lease_expires_without_indefinite_retention(exports):
    factory, root, make, _ = exports
    identity, path, _ = make()
    with factory() as db:
        lease = acquire_download(db, db.get(ExportArtifact, identity), now=NOW + timedelta(seconds=170))
        db.commit()
    later = NOW + timedelta(seconds=261)
    assert not renew_download(factory, identity, lease, now=later)
    assert reclaim_exports(factory, root, now=later)["reclaimed"] == 1
    assert not path.exists()


def test_ineligible_old_rows_cannot_starve_expired_exports(exports):
    factory, root, make, _ = exports
    preserved = [make(status="processing", expires=NOW-timedelta(days=1))[1] for _ in range(3)]
    identity, path, _ = make()
    assert reclaim_exports(factory, root, now=NOW+timedelta(days=1), limit=1)["reclaimed"] == 1
    assert not path.exists() and all(item.is_file() for item in preserved)


@pytest.mark.parametrize("scope,status,kind", [
    ("archive_upload", "committed", "system_archive_preflight"),
    ("conversation", "processing", "conversation_export"),
    ("conversation", "committed", "offline_package"),
])
def test_non_export_and_active_inputs_are_preserved(exports, scope, status, kind):
    factory, root, make, owners = exports
    identity, path, _ = make(scope=scope, status=status, job_type=kind)
    assert reclaim_exports(factory, root, now=NOW + timedelta(days=1))["reclaimed"] == 0
    assert path.read_bytes() == BODY
    with factory() as db:
        with pytest.raises(HTTPException):
            owned_export(db, identity, OwnershipScope(owners[0]))


def test_other_account_cannot_read_download_or_release(exports):
    factory, _, make, owners = exports
    identity, _, _ = make()
    with factory() as db:
        with pytest.raises(HTTPException) as error:
            owned_export(db, identity, OwnershipScope(owners[1]), lock=True)
        assert error.value.status_code == 404


def test_unlink_failure_retries_without_claiming_space_released(exports, monkeypatch):
    factory, root, make, _ = exports
    identity, path, _ = make()
    stamp = NOW + timedelta(minutes=4)
    original = Path.unlink
    def fail(target, *args, **kwargs):
        if target == path:
            raise PermissionError("synthetic")
        return original(target, *args, **kwargs)
    monkeypatch.setattr(Path, "unlink", fail)
    assert reclaim_exports(factory, root, now=stamp) == {"reclaimed": 0, "bytes": 0, "failed": 1, "deferred": 0}
    with factory() as db:
        row = db.get(ExportArtifact, identity)
        assert row.lifecycle_state == "retry" and row.reclaimed_at is None
        assert row.failure_code == "unlink_failed"
    assert path.is_file()
    assert reclaim_exports(factory, root, now=stamp + timedelta(seconds=1))["failed"] == 0
    monkeypatch.setattr(Path, "unlink", original)
    assert reclaim_exports(factory, root, now=stamp + timedelta(minutes=1))["bytes"] == len(BODY)


def test_reclaiming_after_crash_and_missing_file_finishes_idempotently(exports):
    factory, root, make, _ = exports
    identity, path, _ = make()
    with factory() as db:
        db.get(ExportArtifact, identity).lifecycle_state = "reclaiming"
        db.commit()
    path.unlink()
    assert reclaim_exports(factory, root, now=NOW + timedelta(minutes=4))["bytes"] == 0
    with factory() as db:
        assert artifact_status(db.get(ExportArtifact, identity), now=NOW)["status"] == "reclaimed"


def test_changed_or_outside_file_is_held(exports):
    factory, root, make, _ = exports
    first, path, _ = make()
    path.write_bytes(b"changed")
    second, other, _ = make()
    outside = root.parent / "preserved.zip"
    outside.write_bytes(BODY)
    with factory() as db:
        db.get(ExportArtifact, second).storage_uri = str(outside)
        db.commit()
    result = reclaim_exports(factory, root, now=NOW + timedelta(days=1))
    assert result["failed"] == 2 and not result["reclaimed"]
    assert path.read_bytes() == b"changed" and outside.read_bytes() == BODY and other.is_file()


def test_http_range_download_releases_lease_and_usage_has_owner_boundary(exports):
    factory, root, make, owners = exports
    identity, path, _ = make(expires=datetime.now(timezone.utc) + timedelta(minutes=3))
    application = FastAPI()
    application.include_router(router)
    current = [OwnershipScope(owners[0])]
    def database():
        with factory() as db:
            yield db
    application.dependency_overrides[get_db] = database
    application.dependency_overrides[ownership_scope_from_request] = lambda: current[0]
    with TestClient(application) as client:
        viewer = str(uuid.uuid4())
        assert client.post(f"/api/exports/{identity}/usage", json={"session_id": viewer}).status_code == 200
        response = client.get(f"/api/exports/{identity}/download", headers={"Range": "bytes=13-241"})
        assert response.status_code == 206 and response.content == BODY[13:242]
        assert response.headers["cache-control"] == "private, no-store"
        with factory() as db:
            assert db.query(ExportArtifactLease).filter_by(kind="download").count() == 0
        current[0] = OwnershipScope(owners[1])
        for method, suffix, body in [("get", "", None), ("get", "/download", None),
                                     ("post", "/release", {"session_id": viewer}),
                                     ("post", "/download-claims", {"session_id": str(uuid.uuid4())})]:
            result = client.request(method, f"/api/exports/{identity}{suffix}", **({"json": body} if body else {}))
            assert result.status_code == 404
    assert path.read_bytes() == BODY


def test_asgi_disconnect_releases_actual_transfer_lease(exports):
    factory, root, make, _ = exports
    identity, path, _ = make(expires=datetime.now(timezone.utc) + timedelta(minutes=3))
    with factory() as db:
        lease_id = acquire_download(db, db.get(ExportArtifact, identity))
        db.commit()
    response = ExportFileResponse(path, session_factory=factory, artifact_id=identity, lease_id=lease_id)
    async def disconnected_send(message):
        if message["type"] == "http.response.body":
            raise ConnectionError("synthetic disconnect during transfer")
    async def receive():
        return {"type": "http.disconnect"}
    with pytest.raises(ExceptionGroup):
        asyncio.run(response({"type": "http", "method": "GET", "headers": []}, receive, disconnected_send))
    with factory() as db:
        assert db.get(ExportArtifactLease, (identity, lease_id)) is None


def test_real_slow_response_crosses_deadline_without_losing_download_bytes(exports):
    import anyio
    factory, root, make, _ = exports
    identity, path, _ = make(expires=datetime.now(timezone.utc) + timedelta(milliseconds=200))
    with factory() as db:
        lease_id = acquire_download(db, db.get(ExportArtifact, identity))
        db.commit()
    response = ExportFileResponse(path, session_factory=factory, artifact_id=identity, lease_id=lease_id)
    blocks = []
    checked_expired = False
    async def slow_send(message):
        nonlocal checked_expired
        if message["type"] != "http.response.body":
            return
        if not checked_expired:
            await anyio.sleep(0.25)
            with factory() as db:
                assert artifact_status(db.get(ExportArtifact, identity))["status"] == "expired"
            assert reclaim_exports(factory, root)["reclaimed"] == 0
            assert path.is_file()
            checked_expired = True
        blocks.append(message.get("body", b""))
    async def receive():
        return {"type": "http.request"}
    asyncio.run(response({"type": "http", "method": "GET", "headers": [], "extensions": {"http.response.pathsend": {}}}, receive, slow_send))
    assert checked_expired and b"".join(blocks) == BODY
    assert reclaim_exports(factory, root)["reclaimed"] == 1 and not path.exists()


def test_busy_worker_heartbeat_reclaims_exports_without_finishing_user_job(exports):
    from app.services.worker_liveness import WorkerHeartbeatReporter
    factory, root, make, _ = exports
    identity, path, _ = make()
    _, active_path, active_job = make(status="processing")
    waits = iter((False, True))
    results = []
    reporter = WorkerHeartbeatReporter(interval_seconds=15, session_factory=factory,
        wait=lambda _: next(waits), maintenance=lambda: results.append(reclaim_exports(factory, root, now=NOW + timedelta(days=1))))
    assert reporter.set_busy("job", active_job)
    reporter._run()
    assert results[0]["reclaimed"] == 1 and not path.exists()
    assert active_path.is_file()
    with factory() as db:
        assert db.get(BackgroundJob, active_job).status == "processing"


def test_regenerate_preserves_options_creates_real_zip_and_replays_one_job(client):
    from io import BytesIO
    from zipfile import ZipFile
    from test_cr_archive import _commit_source, _run_job
    from test_artifact_transaction_boundary import _factory_from_client
    conversation_id = _commit_source(client)
    original = client.post(f"/api/conversations/{conversation_id}/exports", json={
        "format": "context_package", "include_description": True,
        "include_source_refs": False, "context_attachment_policy": "metadata_only", "continuation_policy": "raw_only",
    }, headers={"Idempotency-Key": "synthetic-original-export"})
    assert original.status_code == 202, original.text
    _run_job(original.json()["job_id"])
    first = client.get(f"/api/tasks/{original.json()['job_id']}").json()
    assert first["status"] == "committed", first
    assert first["result"]["retention_seconds"] == 180
    identity = first["result"]["artifact_id"]
    factory = _factory_from_client()
    with factory() as db:
        row = db.get(ExportArtifact, uuid.UUID(identity))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        old_path = Path(row.storage_uri)
        db.commit()
    assert reclaim_exports(factory, Path(get_settings().export_storage_dir))["reclaimed"] == 1
    assert not old_path.exists()
    assert client.get(f"/api/tasks/{original.json()['job_id']}").json()["result"]["download_url"] is None
    headers = {"Idempotency-Key": "synthetic-regenerate"}
    rebuilt = client.post(f"/api/exports/{identity}/regenerate", headers=headers)
    assert rebuilt.status_code == 202, rebuilt.text
    assert rebuilt.json()["job_id"] != original.json()["job_id"]
    assert client.post(f"/api/exports/{identity}/regenerate", headers=headers).json()["job_id"] == rebuilt.json()["job_id"]
    _run_job(rebuilt.json()["job_id"])
    task = client.get(f"/api/tasks/{rebuilt.json()['job_id']}").json()
    assert task["status"] == "committed", task
    result = client.get(task["result"]["download_url"])
    assert result.status_code == 200
    with ZipFile(BytesIO(result.content)) as package:
        assert package.read("manifest.json")
        assert b"archive question" in package.read("conversation.canjsonl")
        assert not any(name.startswith("continuation/") for name in package.namelist())
    with factory() as db:
        old = db.get(BackgroundJob, uuid.UUID(original.json()["job_id"]))
        new = db.get(BackgroundJob, uuid.UUID(rebuilt.json()["job_id"]))
        assert {key: new.payload[key] for key in old.payload} == old.payload
        assert db.query(ExportArtifactLease).count() == 0
