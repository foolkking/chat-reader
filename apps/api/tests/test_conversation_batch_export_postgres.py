"""Cross-session export consistency and cancellation under actual PostgreSQL."""
import os
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.export_artifact import ExportArtifact
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.background_jobs import request_background_job_cancellation
from app.services.exporting import conversation_batch as batch
from app.services.ownership import OwnershipScope
from test_conversation_batch_export import seed, queue, run
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


@pytest.fixture
def state(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    root = tmp_path / "exports"
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(root))
    get_settings.cache_clear()
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    owners, sources = seed(factory)
    yield factory, root, owners, sources
    get_settings.cache_clear()


def test_concurrent_identical_submissions_create_one_job(state):
    factory, root, owners, sources = state
    barrier = Barrier(2)
    def submit():
        barrier.wait(timeout=10)
        return queue(state)
    with ThreadPoolExecutor(2) as pool:
        ids = list(pool.map(lambda _: submit(), range(2)))
    assert ids[0] == ids[1]
    with factory() as db:
        assert db.query(BackgroundJob).count() == 1


def test_one_snapshot_across_all_conversations_with_concurrent_writer(state, monkeypatch):
    factory, root, owners, sources = state
    identity = queue(state)
    original = batch.export_conversation_canjson_v2
    changed = False
    def concurrent(*args, **kwargs):
        nonlocal changed
        if not changed:
            with factory() as writer:
                for version in writer.scalars(select(MessageVersion)):
                    version.plain_text = version.display_text = "SYNTHETIC-AFTER"
                writer.get(Conversation, sources[1]).display_title = "After title"
                writer.commit()
            changed = True
        return original(*args, **kwargs)
    monkeypatch.setattr(batch, "export_conversation_canjson_v2", concurrent)
    run(factory, identity)
    with factory() as db:
        job = db.get(BackgroundJob, identity)
        assert changed and job.status == "committed", job.error_message
        artifact = db.scalar(select(ExportArtifact))
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            assert archive.namelist() == ["001-合成-甲.canonical.jsonl", "002-Synthetic B.canonical.jsonl"]
            for index, name in enumerate(archive.namelist()):
                body = archive.read(name)
                assert b"SYNTHETIC-AFTER" not in body
                assert f"SYNTHETIC-BEFORE-{index}-0".encode() in body
        assert db.get(Conversation, sources[1]).display_title == "After title"


@pytest.mark.parametrize("point", ["writing", "renamed", "commit", "disabled", "source_deleted"])
def test_cancel_and_authorization_change_never_publish_partial_zip(state, monkeypatch, point):
    factory, root, owners, sources = state
    identity = queue(state)
    original_export = batch.export_conversation_canjson_v2
    original_publish = batch.publish_zip_artifact
    def change():
        with factory() as writer:
            if point == "disabled":
                writer.get(User, owners[0]).status = "DISABLED"
            elif point == "source_deleted":
                writer.get(Conversation, sources[1]).deleted_at = datetime.now(timezone.utc)
            else:
                request_background_job_cancellation(writer.get(BackgroundJob, identity))
            writer.commit()
    if point == "commit":
        @event.listens_for(factory, "before_commit")
        def fail_commit(db):
            if db.query(ExportArtifact).count():
                raise RuntimeError("synthetic commit failure")
    elif point == "renamed":
        def publish(*args, **kwargs):
            result = original_publish(*args, **kwargs)
            change()
            return result
        monkeypatch.setattr(batch, "publish_zip_artifact", publish)
    else:
        def export(*args, **kwargs):
            change()
            return original_export(*args, **kwargs)
        monkeypatch.setattr(batch, "export_conversation_canjson_v2", export)
    run(factory, identity)
    with factory() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == ("cancelled" if point in {"writing", "renamed"} else "failed"), job.error_message
        assert db.query(ExportArtifact).count() == db.query(ConversationEvent).count() == 0
        assert db.query(Conversation).count() == 3
    assert not [path for path in root.rglob("*") if path.is_file()]
