"""Owned task navigation and real failed-package recovery, without browser mocks."""
import io
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from zipfile import ZipFile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.offline import router as offline_router
from app.api.routes.tasks import router as tasks_router
from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.annotation import ConversationNotebook
from app.models.background_job import BackgroundJob
from app.models.message_version import MessageVersion
from test_attachment_bundle import bundle_state, state  # noqa: F401
from test_conversation_batch_export import run
from test_import_preview_api import client  # noqa: F401


@pytest.mark.parametrize("scope,mode", [
    ("conversation", "none"), ("project", "small"), ("all", "all"), ("conversation", None),
])
def test_owned_task_exposes_only_the_reusable_download_scope(client, scope, mode):
    conversation_id, project_id = str(uuid.uuid4()), str(uuid.uuid4())
    payload = dict(scope=scope, conversation_id=conversation_id, project_id=project_id,
        known_revisions={conversation_id: 1}, subject_key="private-subject", private_path="/private/test-only")
    if mode is not None:
        payload["include_assets"] = mode
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = BackgroundJob(job_type="offline_package", status="failed", phase="failed",
            completed_at=datetime.now(timezone.utc), payload=payload)
        db.add(job)
        db.commit()
        identity = str(job.id)
    finally:
        db.close()
        generator.close()
    single = client.get(f"/api/tasks/{identity}")
    listing = client.get("/api/tasks/active")
    assert single.status_code == listing.status_code == 200
    expected = dict(scope=scope, include_assets=mode or "all",
        conversation_id=conversation_id if scope == "conversation" else None,
        project_id=project_id if scope == "project" else None)
    assert single.json()["offline_target"] == expected
    assert next(item for item in listing.json() if item["job_id"] == identity)["offline_target"] == expected
    for response in [single, listing]:
        for private in ["private-subject", "/private/test-only", "known_revisions", "subject_key"]:
            assert private not in response.text
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = db.get(BackgroundJob, uuid.UUID(identity))
        assert job.status == "failed" and job.payload == payload
    finally:
        db.close()
        generator.close()


@pytest.mark.parametrize("job_type,payload", [
    ("offline_package", {}),
    ("offline_package", {"scope": "conversation"}),
    ("offline_package", {"scope": "project", "project_id": "invalid"}),
    ("offline_package", {"scope": "unknown"}),
    ("offline_package", {"scope": "all", "include_assets": {"invalid": True}}),
    ("conversation_export", {"scope": "all", "include_assets": "all"}),
])
def test_legacy_or_unrelated_tasks_do_not_invent_a_download_target(client, job_type, payload):
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        job = BackgroundJob(job_type=job_type, status="failed", phase="failed", payload=payload)
        db.add(job)
        db.commit()
        identity = str(job.id)
    finally:
        db.close()
        generator.close()
    response = client.get(f"/api/tasks/{identity}")
    assert response.status_code == 200
    assert response.json()["offline_target"] is None


def test_failed_task_target_requeues_real_bytes_and_never_grants_another_owner_access(bundle_state, tmp_path, monkeypatch):
    info = bundle_state
    monkeypatch.setenv("OFFLINE_STORAGE_DIR", str(tmp_path / "offline"))
    get_settings.cache_clear()
    with info["factory"]() as db:
        notebook = db.get(ConversationNotebook, info["notebook"])
        notebook.blocks = [{**block, "id": str(uuid.uuid4())} for block in notebook.blocks]
        db.commit()
        source_before = {str(row.id): row.display_text for row in db.query(MessageVersion).all()}

    fixture = FastAPI()
    fixture.include_router(tasks_router)
    fixture.include_router(offline_router)
    current_owner = [info["owners"][0]]

    @fixture.middleware("http")
    async def identity(request, call_next):
        request.state.auth = SimpleNamespace(user_id=current_owner[0], principal_id="test")
        return await call_next(request)

    def database():
        with info["factory"]() as db:
            yield db

    fixture.dependency_overrides[get_db] = database
    with TestClient(fixture) as client:
        request = dict(scope="conversation", conversation_id=str(info["sources"][0]), include_assets="all")
        first = client.post("/api/offline/packages", json=request, headers={"Idempotency-Key": "first-device"})
        assert first.status_code == 202
        failed_id = uuid.UUID(first.json()["job_id"])
        info["paths"][0].write_bytes(b"X" * 128)
        run(info["factory"], failed_id)
        failed = client.get(f"/api/tasks/{failed_id}")
        assert failed.status_code == 200
        assert failed.json()["status"] == "failed"
        assert failed.json()["error_message"] == "OFFLINE_ASSET_INTEGRITY"
        target = failed.json()["offline_target"]
        assert target["conversation_id"] == request["conversation_id"]

        current_owner[0] = info["owners"][1]
        assert client.get(f"/api/tasks/{failed_id}").status_code == 404
        assert not any(row["job_id"] == str(failed_id) for row in client.get("/api/tasks/active").json())
        assert client.post("/api/offline/packages", json=target, headers={"Idempotency-Key": "foreign"}).status_code == 404
        current_owner[0] = info["owners"][0]

        info["paths"][0].write_bytes(b"A" * 128)
        headers = {"Idempotency-Key": "new-device"}
        retried = client.post("/api/offline/packages", json={**target, "known_revisions": {}}, headers=headers)
        assert retried.status_code == 202
        new_id = uuid.UUID(retried.json()["job_id"])
        assert new_id != failed_id
        repeated = client.post("/api/offline/packages", json={**target, "known_revisions": {}}, headers=headers)
        assert repeated.status_code == 202 and repeated.json()["job_id"] == str(new_id)
        run(info["factory"], new_id)
        completed = client.get(f"/api/tasks/{new_id}").json()
        assert completed["status"] == "committed"
        download = client.get(completed["result"]["download_url"])
        assert download.status_code == 200
        with ZipFile(io.BytesIO(download.content)) as archive:
            assert archive.read(f"assets/objects/{info['assets'][0]}") == b"A" * 128
        with info["factory"]() as db:
            assert db.query(BackgroundJob).count() == 2
            assert db.get(BackgroundJob, failed_id).status == "failed"
            assert {str(row.id): row.display_text for row in db.query(MessageVersion).all()} == source_before
        current_owner[0] = info["owners"][1]
        assert client.get(f"/api/tasks/{new_id}").status_code == 404
        assert client.get(completed["result"]["download_url"]).status_code == 404
