"""Real serializers, jobs, artifact delivery and rollback; synthetic data only."""
import hashlib
import io
import json
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from app.api.routes.archive_exports import router
from app.core.config import get_settings
from app.core.database import Base, get_db
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.background_jobs import claim_next_job, process_background_job, BackgroundJobCancelled, request_background_job_cancellation, retry_background_job
from app.services.exporting import conversation_batch as batch
from app.services.exporting.export_service import ExportError
from app.services.export_retention import reclaim_exports, regenerate_export
from app.services.ownership import OwnershipScope


def seed(factory):
    with factory() as db:
        users = [User(normalized_email=f"batch-{i}@example.test") for i in range(2)]
        db.add_all(users)
        db.flush()
        sources = []
        for index, title in enumerate(["合成/甲", "Synthetic B", "Other account"]):
            conversation = Conversation(owner_user_id=users[index // 2].id, title=title, display_title=title,
                source_type="manual", source_profile="test", parser_version="test", message_count=2)
            db.add(conversation)
            db.flush()
            for number, role in enumerate(["user", "assistant"]):
                message = Message(conversation_id=conversation.id, role=role, order_key=f"{number:06}")
                db.add(message)
                db.flush()
                body = f"SYNTHETIC-BEFORE-{index}-{number}"
                version = MessageVersion(message_id=message.id, version_number=1, plain_text=body, display_text=body,
                    edit_type="manual", content_hash=hashlib.sha256(body.encode()).hexdigest())
                db.add(version)
                db.flush()
                message.current_version_id = version.id
            sources.append(conversation.id)
        db.commit()
        return [u.id for u in users], sources


@pytest.fixture
def state(tmp_path, monkeypatch):
    root = tmp_path / "exports"
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(root))
    get_settings.cache_clear()
    engine = create_engine(f"sqlite:///{tmp_path / 'batch.db'}")
    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    owners, sources = seed(factory)
    yield factory, root, owners, sources
    engine.dispose()
    get_settings.cache_clear()


def queue(state, *, ids=None, key="first", owner=0):
    factory, _, owners, sources = state
    with factory() as db:
        job = batch.queue_conversation_batch_export(db, conversation_ids=ids or sources[:2],
            idempotency_key=key, ownership_scope=OwnershipScope(owners[owner]))
        db.commit()
        return job.id


def run(factory, job_id):
    with factory() as db:
        assert claim_next_job(db) == job_id
        db.commit()
    process_background_job(job_id, session_factory=factory)


def test_ordered_zip_persistent_job_and_policy_lifetime(state):
    factory, root, owners, sources = state
    identity = queue(state, ids=sources[1::-1])
    assert queue(state, ids=sources[1::-1]) == identity
    with pytest.raises(ExportError) as error:
        queue(state)
    assert error.value.status_code == 409
    run(factory, identity)
    with factory() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "committed", job.error_message
        assert job.processed_items == job.total_items == 2
        artifact = db.scalar(select(ExportArtifact).where(ExportArtifact.job_id == identity))
        assert artifact.retention_seconds == 180 and artifact.release_on_close
        body = Path(artifact.storage_uri).read_bytes()
        assert hashlib.sha256(body).hexdigest() == artifact.sha256
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            assert archive.namelist() == ["001-Synthetic B.canonical.jsonl", "002-合成-甲.canonical.jsonl"]
            for index, name in enumerate(archive.namelist()):
                records = [json.loads(line) for line in archive.read(name).splitlines()]
                assert records[-1]["message_count"] == 2
                assert sum(r["record_type"] == "message" for r in records) == 2
                assert f"SYNTHETIC-BEFORE-{1-index}-0".encode() in archive.read(name)
        assert db.query(ConversationEvent).count() == 2
    assert not list(root.rglob("*.tmp.*"))


@pytest.mark.parametrize("case", ["foreign", "missing", "disabled", "duplicate", "empty"])
def test_invalid_sources_do_not_queue(state, case):
    factory, root, owners, sources = state
    with factory() as db:
        if case == "disabled":
            db.get(User, owners[0]).status = "DISABLED"
            db.commit()
        ids = {"foreign": [sources[0], sources[2]], "missing": [uuid.uuid4()],
               "disabled": sources[:2], "duplicate": [sources[0]] * 2, "empty": []}[case]
        with pytest.raises(ExportError):
            batch.queue_conversation_batch_export(db, conversation_ids=ids, idempotency_key="same",
                ownership_scope=OwnershipScope(owners[0]))
        assert db.query(BackgroundJob).count() == 0
    assert not root.exists()


@pytest.mark.parametrize("point", ["during_write", "after_rename", "commit", "limit", "mkdir"])
def test_failure_removes_partial_and_final_files(state, monkeypatch, point):
    factory, root, owners, sources = state
    identity = queue(state)
    if point == "during_write":
        original = batch.export_conversation_canjson_v2
        def broken(*args, **kwargs):
            result = original(*args, **kwargs)
            def chunks():
                yield next(iter(result.content))
                raise OSError("synthetic write failure")
            return SimpleNamespace(content=chunks(), message_count=2)
        monkeypatch.setattr(batch, "export_conversation_canjson_v2", broken)
    elif point == "after_rename":
        def broken(*args, **kwargs):
            raise BackgroundJobCancelled("synthetic cancellation")
        monkeypatch.setattr(batch, "_write_export_event", broken)
    elif point == "commit":
        @event.listens_for(factory, "before_commit")
        def fail_publish(db):
            if db.query(ExportArtifact).count():
                raise RuntimeError("synthetic commit failure")
    elif point == "limit":
        monkeypatch.setattr(get_settings(), "bundle_max_expanded_bytes", 10)
    else:
        original = Path.mkdir
        def fail_directory(path, *args, **kwargs):
            if path == root / str(identity):
                raise OSError("synthetic capacity failure")
            return original(path, *args, **kwargs)
        monkeypatch.setattr(Path, "mkdir", fail_directory)
    run(factory, identity)
    with factory() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == ("cancelled" if point == "after_rename" else "failed")
        assert db.query(ExportArtifact).count() == db.query(ConversationEvent).count() == 0
        if point in {"during_write", "mkdir"}:
            assert job.error_message == "BATCH_EXPORT_STORAGE_UNAVAILABLE"
    assert not [p for p in root.rglob("*") if p.is_file()]


def test_expiry_reclaims_and_regenerates_original_order(state):
    factory, root, owners, sources = state
    identity = queue(state, ids=sources[1::-1])
    run(factory, identity)
    with factory() as db:
        artifact = db.scalar(select(ExportArtifact))
        path, artifact_id = Path(artifact.storage_uri), artifact.id
    assert reclaim_exports(factory, root, now=datetime.now(timezone.utc) + timedelta(minutes=5))["reclaimed"] == 1
    assert not path.exists()
    with factory() as db:
        renewed = regenerate_export(db, db.get(ExportArtifact, artifact_id), OwnershipScope(owners[0]), "again")
        renewed_id = renewed.id
        db.commit()
        assert renewed.payload["conversation_ids"] == list(map(str, sources[1::-1]))
    run(factory, renewed_id)
    with factory() as db:
        assert db.get(BackgroundJob, renewed_id).status == "committed"


def test_http_schema_owner_delivery_and_download_type(state):
    factory, root, owners, sources = state
    app = FastAPI()
    app.include_router(router)
    current_owner = [owners[0]]
    @app.middleware("http")
    async def identity(request, call_next):
        request.state.auth = SimpleNamespace(user_id=current_owner[0], principal_id="test")
        return await call_next(request)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        url = "/api/conversations/batch-export"
        payload = {"conversation_ids": list(map(str, sources[:2]))}
        assert client.post(url, json=payload).status_code == 422
        headers = {"Idempotency-Key": "http"}
        response = client.post(url, json=payload, headers=headers)
        assert response.status_code == 202, response.text
        identity = uuid.UUID(response.json()["job_id"])
        assert client.post(url, json=payload, headers=headers).json()["job_id"] == str(identity)
        run(factory, identity)
        with factory() as db:
            result = db.get(BackgroundJob, identity).result
        download = client.get(result["download_url"])
        assert download.status_code == 200 and download.headers["content-type"] == "application/zip"
        assert zipfile.is_zipfile(io.BytesIO(download.content))
        current_owner[0] = owners[1]
        assert client.get(result["download_url"]).status_code == 404
        assert client.post(url, json=payload, headers=headers).status_code == 404


@pytest.mark.parametrize("limit", ["bundle_max_entries", "bundle_max_compressed_bytes", "bundle_max_expanded_bytes"])
def test_size_limits_fail_whole_job_then_retry_succeeds(state, monkeypatch, limit):
    factory, root, owners, sources = state
    original = getattr(get_settings(), limit)
    monkeypatch.setattr(get_settings(), limit, 1)
    identity = queue(state)
    run(factory, identity)
    with factory() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "failed" and job.error_message == "BATCH_EXPORT_LIMIT"
        assert db.query(ExportArtifact).count() == 0
        retry_background_job(job)
        db.commit()
    monkeypatch.setattr(get_settings(), limit, original)
    run(factory, identity)
    with factory() as db:
        assert db.get(BackgroundJob, identity).status == "committed"
        assert db.query(ExportArtifact).count() == 1
    assert len([p for p in root.rglob("*") if p.is_file()]) == 1


def test_queued_cancellation_writes_no_export(state):
    factory, root, owners, sources = state
    identity = queue(state)
    with factory() as db:
        request_background_job_cancellation(db.get(BackgroundJob, identity))
        db.commit()
    process_background_job(identity, session_factory=factory)
    with factory() as db:
        assert db.get(BackgroundJob, identity).status == "cancelled"
        assert db.query(ExportArtifact).count() == 0
    assert not root.exists()
