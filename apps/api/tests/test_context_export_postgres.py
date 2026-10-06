"""Context publication races against migrated PostgreSQL and actual worker ZIPs."""
import json
import os
import zipfile
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.annotation import ConversationAnnotation
from app.models.attachment import AssetObject
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.exporting import context_package as context
from test_attachment_bundle import queue, assert_failed
from test_attachment_bundle_postgres import bundle_state, isolated_schema  # noqa: F401
from test_conversation_batch_export import run


pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires disposable PostgreSQL")


@pytest.mark.parametrize("moment", ["serializing", "after_publish"])
@pytest.mark.parametrize("case", ["body", "annotation", "disabled", "owner_changed", "asset_deleted", "asset_blocked"])
def test_concurrent_change_rejects_output_and_leaves_no_artifact(bundle_state, monkeypatch, moment, case):
    info = bundle_state
    identity = queue(info, "context_package")
    changed = False

    def change():
        nonlocal changed
        if changed:
            return
        changed = True
        with info["factory"]() as db:
            if case == "body":
                message = db.get(Message, info["messages"][0])
                db.get(MessageVersion, message.current_version_id).display_text = "AFTER-CONTEXT-EDIT"
                db.get(Conversation, info["sources"][0]).offline_revision += 1
            elif case == "annotation":
                # Supplementary data is independently checked even without a message revision change.
                db.get(ConversationAnnotation, info["annotation"]).comment_markdown = "AFTER-CONTEXT-COMMENT"
            elif case == "disabled":
                db.get(User, info["owners"][0]).status = "DISABLED"
            elif case == "owner_changed":
                db.get(Conversation, info["sources"][0]).owner_user_id = info["owners"][1]
            elif case == "asset_deleted":
                db.get(AssetObject, info["assets"][0]).deleted_at = datetime.now(timezone.utc)
            else:
                db.get(AssetObject, info["assets"][0]).scan_status = "infected"
            db.commit()

    if moment == "serializing":
        original = context._JsonlRecords.append

        def append(writer, record):
            original(writer, record)
            if record["record_type"] == "manifest":
                change()
            if case == "body" and record["record_type"] == "message":
                assert "AFTER-" not in record["current_version"]["content_markdown"]
            if case == "annotation" and record["record_type"] == "annotation":
                assert record["comment_markdown"] == "BEFORE-COMMENT"
        monkeypatch.setattr(context._JsonlRecords, "append", append)
    else:
        original = context.publish_zip_artifact

        def publish(*args, **kwargs):
            result = original(*args, **kwargs)
            change()
            return result
        monkeypatch.setattr(context, "publish_zip_artifact", publish)

    run(info["factory"], identity)
    assert changed
    assert_failed(info, identity)
    with info["factory"]() as db:
        error = db.get(BackgroundJob, identity).error_message
        expected = {"body": "SOURCE_CHANGED", "annotation": "SOURCE_CHANGED", "disabled": "ACCOUNT_UNAVAILABLE",
                    "owner_changed": "SOURCE_UNAVAILABLE", "asset_deleted": "ASSET_UNAVAILABLE", "asset_blocked": "ASSET_UNAVAILABLE"}
        assert error == "CONTEXT_EXPORT_" + expected[case]


def test_postgres_worker_commits_consistent_context_and_retains_published_file(bundle_state):
    info = bundle_state
    identity = queue(info, "context_package")
    run(info["factory"], identity)
    with info["factory"]() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "committed", job.error_message
        artifact = db.scalar(select(ExportArtifact))
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            records = [json.loads(line) for line in archive.read("conversation.canjsonl").splitlines()]
            assert records[-1]["record_count"] == len(records)
            assert sum(row["record_type"] == "message" for row in records) == 2
            assert next(row for row in records if row["record_type"] == "annotation")["comment_markdown"] == "BEFORE-COMMENT"
            assert archive.testzip() is None
