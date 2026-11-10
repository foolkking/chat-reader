"""Actual advisory-lock and snapshot boundaries for recoverable single exports."""
import os
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier

import pytest
from sqlalchemy import select

from test_conversation_batch_export_postgres import state  # noqa: F401
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_plain_export_recovery import queue
from test_conversation_batch_export import run
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.editing.message_edit_service import MessageEditError
from app.services.exporting import plain_export as plain

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


@pytest.mark.parametrize("different", [False, True])
def test_concurrent_receipt_is_single_and_different_options_conflict(state, different):
    factory, _, _, _ = state
    barrier = Barrier(2)
    def submit(index):
        barrier.wait(timeout=10)
        try:
            return queue(state, options={"format": "canjson_v2", "include_description": different and bool(index)})
        except MessageEditError as error:
            assert error.status_code == 409
            return "conflict"
    with ThreadPoolExecutor(2) as pool:
        ids = list(pool.map(submit, range(2)))
    assert ids.count("conflict") == int(different)
    if not different:
        assert ids[0] == ids[1]
    with factory() as db:
        assert db.query(BackgroundJob).count() == 1


@pytest.mark.parametrize("change", ["content", "disabled", "source_deleted"])
def test_single_snapshot_but_fresh_authorization_before_publication(state, monkeypatch, change):
    factory, root, owners, sources = state
    job_id = queue(state)
    original = plain.export_conversation_canjson_v2
    def export(*args, **kwargs):
        with factory() as writer:
            if change == "disabled":
                writer.get(User, owners[0]).status = "DISABLED"
            elif change == "source_deleted":
                writer.get(Conversation, sources[0]).deleted_at = datetime.now(timezone.utc)
            else:
                for version in writer.scalars(select(MessageVersion)):
                    version.plain_text = version.display_text = "SYNTHETIC-AFTER"
                writer.get(Conversation, sources[0]).display_title = "After title"
            writer.commit()
        return original(*args, **kwargs)
    monkeypatch.setattr(plain, "export_conversation_canjson_v2", export)
    run(factory, job_id)
    with factory() as db:
        job = db.get(BackgroundJob, job_id)
        assert job.status == ("committed" if change == "content" else "failed"), job.error_message
        if change == "content":
            artifact = db.scalar(select(ExportArtifact))
            with zipfile.ZipFile(artifact.storage_uri) as archive:
                body = archive.read(archive.namelist()[0])
                assert b"SYNTHETIC-AFTER" not in body and b"SYNTHETIC-BEFORE-0-0" in body
            assert db.get(Conversation, sources[0]).display_title == "After title"
        else:
            assert db.query(ExportArtifact).count() == 0
            assert not [path for path in root.rglob("*") if path.is_file()]
