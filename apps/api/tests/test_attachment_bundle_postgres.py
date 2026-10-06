"""Snapshot and access races against migrated PostgreSQL, not mock serializers."""
import hashlib
import json
import os
import zipfile
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.attachment import AssetObject, Attachment
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.exporting import attachment_bundle as bundle
from test_conversation_batch_export import seed, run
from test_attachment_bundle import prepare, queue, assert_failed
from test_import_profile_postgres import isolated_schema  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1",
    reason="requires disposable PostgreSQL")


@pytest.fixture
def bundle_state(isolated_schema, tmp_path, monkeypatch):
    engine, migrate = isolated_schema
    migrate("head")
    root = tmp_path / "exports"
    monkeypatch.setenv("EXPORT_STORAGE_DIR", str(root))
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    owners, sources = seed(factory)
    yield prepare((factory, root, owners, sources), tmp_path, monkeypatch)
    get_settings.cache_clear()


def during_first_write(monkeypatch, change):
    original = bundle._write_stream
    changed = False
    def write(archive, name, chunks, **kwargs):
        nonlocal changed
        iterator = iter(chunks)
        def intercepted():
            nonlocal changed
            try:
                for chunk in iterator:
                    yield chunk
                    if not changed:
                        change()
                        changed = True
            finally:
                close = getattr(iterator, "close", None)
                if close is not None:
                    close()
        return original(archive, name, intercepted(), **kwargs)
    monkeypatch.setattr(bundle, "_write_stream", write)


@pytest.mark.parametrize("format", ["canjson_bundle", "markdown_bundle"])
@pytest.mark.parametrize("change_kind", ["append", "edit_delete_reorder"])
def test_concurrent_messages_attachments_and_notes_use_one_snapshot(bundle_state, monkeypatch, format, change_kind):
    info = bundle_state
    identity = queue(info, format)
    def change():
        with info["factory"]() as db:
            conversation = db.get(Conversation, info["sources"][0])
            conversation.display_title = "AFTER-TITLE"
            conversation.description_markdown = "AFTER-DESCRIPTION"
            conversation.offline_revision += 1
            if change_kind == "append":
                message = Message(conversation_id=conversation.id, role="user", order_key="000002")
                db.add(message)
                db.flush()
                version = MessageVersion(message_id=message.id, version_number=1, plain_text="AFTER-APPEND",
                    display_text="AFTER-APPEND", edit_type="manual", content_hash=hashlib.sha256(b"AFTER-APPEND").hexdigest())
                db.add(version)
                db.flush()
                message.current_version_id = version.id
                conversation.message_count = 3
            else:
                first = db.get(Message, info["messages"][0])
                first.order_key = "000003"
                version = MessageVersion(message_id=first.id, version_number=2, plain_text="AFTER-EDIT",
                    display_text="AFTER-EDIT", edit_type="manual", content_hash=hashlib.sha256(b"AFTER-EDIT").hexdigest())
                db.add(version)
                db.flush()
                first.current_version_id = version.id
                db.get(Message, info["messages"][1]).is_deleted = True
                conversation.message_count = 1
            attachment = db.get(Attachment, info["attachment"])
            attachment.asset_object_id = info["assets"][1]
            attachment.display_name = "AFTER-ATTACHMENT.txt"
            db.get(ConversationNotebook, info["notebook"]).blocks = [{"type": "markdown", "markdown": "AFTER-NOTE"}]
            db.get(ConversationAnnotation, info["annotation"]).comment_markdown = "AFTER-COMMENT"
            db.commit()
    during_first_write(monkeypatch, change)
    run(info["factory"], identity)
    with info["factory"]() as db:
        assert db.get(Conversation, info["sources"][0]).display_title == "AFTER-TITLE"
        job = db.get(BackgroundJob, identity)
        assert job.status == "committed", job.error_message
        artifact = db.scalar(select(ExportArtifact))
        assert "100x" in artifact.filename
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            body = archive.read("conversation.canjsonl" if format == "canjson_bundle" else "conversation.md")
            assert b"AFTER-" not in body
            for value in [b"SYNTHETIC-BEFORE-0-0", b"SYNTHETIC-BEFORE-0-1", b"BEFORE-NOTE", b"BEFORE-COMMENT", b"BEFORE-DESCRIPTION"]:
                assert value in body
            if format == "canjson_bundle":
                manifest = json.loads(archive.read("manifest.json"))
                records = [json.loads(line) for line in body.splitlines()]
                assert manifest["conversation"]["message_count"] == records[-1]["message_count"] == 2
                assert sum(r["record_type"] == "message" for r in records) == 2
                attachment = next(r for r in records if r["record_type"] == "attachment")
                assert archive.read(attachment["object"]["path"]) == b"A" * 128
                assert hashlib.sha256(b"A" * 128).hexdigest() == attachment["object"]["sha256"]
                assert manifest["attachments"]["reference_count"] == 1
            else:
                assert archive.read("attachments/Report (100x) #1.txt") == b"A" * 128


@pytest.mark.parametrize("case", ["disabled", "source_deleted", "owner_changed", "asset_blocked", "asset_deleted"])
def test_authorization_and_asset_revocation_before_publication(bundle_state, monkeypatch, case):
    info = bundle_state
    identity = queue(info)
    def change():
        with info["factory"]() as db:
            if case == "disabled":
                db.get(User, info["owners"][0]).status = "DISABLED"
            elif case == "source_deleted":
                db.get(Conversation, info["sources"][0]).deleted_at = datetime.now(timezone.utc)
            elif case == "owner_changed":
                db.get(Conversation, info["sources"][0]).owner_user_id = info["owners"][1]
            elif case == "asset_blocked":
                db.get(AssetObject, info["assets"][0]).scan_status = "infected"
            else:
                db.get(AssetObject, info["assets"][0]).deleted_at = datetime.now(timezone.utc)
            db.commit()
    during_first_write(monkeypatch, change)
    run(info["factory"], identity)
    assert_failed(info, identity)
