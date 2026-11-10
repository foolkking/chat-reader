"""Synthetic ordinary-file recovery: real worker/serializers/leases, no user ZIP."""
import gzip
import io
import json
from pathlib import Path
from types import SimpleNamespace
import uuid
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from test_conversation_batch_export import state, run  # noqa: F401
from app.api.routes.archive_exports import router
from app.core.config import get_settings
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.user import User
from app.schemas.export import ExportRequest
from app.services.background_jobs import queue_conversation_export
from app.services.editing.message_edit_service import MessageEditError
from app.services.exporting import plain_export as plain
from app.services.exporting.export_service import ExportError
from app.services.export_retention import regenerate_export
from app.services.ownership import OwnershipScope


def queue(state, *, options=None, key="original", source=None):
    factory, _, owners, sources = state
    request = ExportRequest(**(options or {"format": "canjson_v2"}))
    with factory() as db:
        job = queue_conversation_export(db, conversation_id=source or sources[0],
            idempotency_key=key, export_format=request.format,
            plain_options=request.model_dump(mode="json"), ownership_scope=OwnershipScope(owners[0]))
        db.commit()
        return job.id


@pytest.mark.parametrize("format,compression", [("markdown_v2", "none"), ("canjson_v2", "none"), ("canjson_v2", "gzip")])
def test_original_options_selected_messages_and_regeneration(state, format, compression):
    factory, root, owners, sources = state
    with factory() as db:
        selected = db.scalar(select(Message).where(Message.conversation_id == sources[0]).order_by(Message.order_key.desc()))
        selected_id = str(selected.id)
    options = dict(format=format, compression=compression, message_ids=[selected_id],
        version_scope="all", include_metadata=False, include_description=True,
        annotation_scope="all", notebook_scope="current", include_source_refs=False,
        toc_mode="message_index" if format == "markdown_v2" else "none")
    job_id = queue(state, options=options)
    assert queue(state, options=options) == job_id
    run(factory, job_id)
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "committed", job.error_message
        assert job.processed_items == job.total_items == 1
        artifact = db.scalar(select(ExportArtifact).where(ExportArtifact.job_id == job_id))
        assert artifact.format == plain.FORMAT and artifact.retention_seconds == 180
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            assert len(archive.namelist()) == 1
            raw = archive.read(archive.namelist()[0])
            body = gzip.decompress(raw) if compression == "gzip" else raw
            assert b"SYNTHETIC-BEFORE-0-1" in body
            assert b"SYNTHETIC-BEFORE-0-0" not in body
            assert b"storage_uri" not in body and b"raw_storage_uri" not in body
            if format == "canjson_v2":
                records = [json.loads(line) for line in body.splitlines()]
                assert records[-1]["message_count"] == 1
        regenerated = regenerate_export(db, artifact, OwnershipScope(owners[0]), "again")
        assert regenerated.payload["plain_options"] == ExportRequest(**options).model_dump(mode="json")
        regenerated_id = regenerated.id
        db.commit()
    run(factory, regenerated_id)
    with factory() as db:
        assert db.get(BackgroundJob, regenerated_id).status == "committed"
    assert not list(root.rglob("*.tmp.*"))


def test_gzip_does_not_bypass_expanded_byte_budget(state, monkeypatch):
    factory, root, _, _ = state
    monkeypatch.setattr(get_settings(), "bundle_max_expanded_bytes", 1024)
    identity = queue(state, options={"format": "canjson_v2", "compression": "gzip"})
    run(factory, identity)
    with factory() as db:
        assert db.get(BackgroundJob, identity).error_message == "PLAIN_EXPORT_LIMIT"
        assert db.query(ExportArtifact).count() == 0
    assert not [path for path in root.rglob("*") if path.is_file()]


@pytest.mark.parametrize("status", ["queued", "processing", "failed", "cancelled", "committed"])
def test_request_identity_survives_all_terminal_results_and_conflicts(state, status):
    factory, _, _, sources = state
    job_id = queue(state)
    with factory() as db:
        db.get(BackgroundJob, job_id).status = status
        db.commit()
    assert queue(state) == job_id
    for changed in ({"include_source_refs": False}, {"version_scope": "all"}):
        with pytest.raises(MessageEditError) as error:
            queue(state, options={"format": "canjson_v2", **changed})
        assert error.value.status_code == 409
    with pytest.raises(MessageEditError):
        queue(state, source=sources[1])
    with factory() as db:
        assert db.query(BackgroundJob).count() == 1


@pytest.mark.parametrize("point", ["limit", "compressed", "write", "commit", "after_rename", "revoked"])
def test_failed_publication_never_leaves_partial_artifact(state, monkeypatch, point):
    factory, root, owners, sources = state
    job_id = queue(state)
    if point in {"limit", "compressed"}:
        monkeypatch.setattr(get_settings(),
            "bundle_max_expanded_bytes" if point == "limit" else "bundle_max_compressed_bytes", 8)
    elif point == "commit":
        @event.listens_for(factory, "before_commit")
        def rejected_commit(db):
            if db.query(ExportArtifact).count():
                raise RuntimeError("Synthetic rejected commit")
    elif point == "after_rename":
        monkeypatch.setattr(plain, "_write_export_event",
            lambda *args: (_ for _ in ()).throw(OSError("Synthetic event failure")))
    elif point == "revoked":
        with factory() as db:
            db.get(User, owners[0]).status = "DISABLED"
            db.commit()
    else:
        original = plain.export_conversation_canjson_v2
        def interrupted(*args, **kwargs):
            result = original(*args, **kwargs)
            def chunks():
                yield next(iter(result.content))
                raise OSError("Synthetic capacity failure")
            return SimpleNamespace(content=chunks(), message_count=2, filename=result.filename)
        monkeypatch.setattr(plain, "export_conversation_canjson_v2", interrupted)
    run(factory, job_id)
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == "failed"
        if point in {"limit", "compressed"}:
            assert job.error_message == "PLAIN_EXPORT_LIMIT"
        if point in {"write", "after_rename"}:
            assert job.error_message == "PLAIN_EXPORT_STORAGE_UNAVAILABLE"
        assert db.query(ExportArtifact).count() == db.query(ConversationEvent).count() == 0
    assert not [path for path in root.rglob("*") if path.is_file()]


def test_source_rechecked_after_serialization(state, monkeypatch):
    factory, root, owners, sources = state
    job_id = queue(state)
    original = plain.export_conversation_canjson_v2
    def revoke(*args, **kwargs):
        result = original(*args, **kwargs)
        def chunks():
            yield from result.content
            args[0].get(Conversation, sources[0]).owner_user_id = owners[1]
            args[0].flush()
        return SimpleNamespace(content=chunks(), message_count=2, filename=result.filename)
    monkeypatch.setattr(plain, "export_conversation_canjson_v2", revoke)
    run(factory, job_id)
    with factory() as db:
        assert db.get(BackgroundJob, job_id).error_message == "PLAIN_EXPORT_SOURCE_UNAVAILABLE"
        assert db.query(ExportArtifact).count() == 0
    assert not [p for p in root.rglob("*") if p.is_file()]


def test_http_direct_compatibility_lookup_owner_scope_and_native_zip_delivery(state):
    factory, _, owners, sources = state
    app = FastAPI()
    app.include_router(router)
    owner = [owners[0]]
    @app.middleware("http")
    async def identity(request, call_next):
        request.state.auth = SimpleNamespace(user_id=owner[0], principal_id="synthetic")
        return await call_next(request)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        url = f"/api/conversations/{sources[0]}/exports"
        options = {"format": "canjson_v2", "include_source_refs": False}
        direct = client.post(url, json=options)
        assert direct.status_code == 200 and direct.headers["content-type"].startswith("application/x-ndjson")
        assert client.post(url + "?background=true", json=options).status_code == 422
        missing = client.get(url + "/by-request/synthetic")
        assert missing.status_code == 200 and missing.json() == {"task": None}
        assert "no-store" in missing.headers["cache-control"]
        response = client.post(url + "?background=true", json=options, headers={"Idempotency-Key": "synthetic"})
        assert response.status_code == 202, response.text
        task = response.json()
        assert task["export_format"] == "canjson_v2"
        assert client.get(url + "/by-request/synthetic").json()["task"]["job_id"] == task["job_id"]
        assert client.get(f"/api/conversations/{sources[1]}/exports/by-request/synthetic").json() == {"task": None}
        run(factory, uuid.UUID(task["job_id"]))
        with factory() as db:
            result = db.get(BackgroundJob, uuid.UUID(task["job_id"])).result
        download = client.get(result["download_url"])
        assert download.status_code == 200 and download.headers["content-type"] == "application/zip"
        assert zipfile.is_zipfile(io.BytesIO(download.content))
        owner[0] = owners[1]
        assert client.get(url + "/by-request/synthetic").status_code == 404
        assert client.get(result["download_url"]).status_code == 404
