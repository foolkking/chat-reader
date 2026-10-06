"""Actual ZIP bytes, worker outcomes and transaction cleanup; synthetic sources."""
import hashlib
import json
import uuid
import zipfile
from pathlib import Path
from urllib.parse import quote

import pytest
from sqlalchemy import event, select

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.conversation_event import ConversationEvent
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.background_jobs import queue_conversation_export, BackgroundJobCancelled, retry_background_job
from app.services.export_retention import reclaim_exports, regenerate_export
from app.services.exporting import attachment_bundle as bundle
from app.services.ownership import OwnershipScope
from test_conversation_batch_export import state, run  # noqa: F401


def prepare(state, tmp_path, monkeypatch):
    factory, root, owners, sources = state
    asset_root = tmp_path / "assets"
    asset_root.mkdir()
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(asset_root))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    get_settings.cache_clear()
    paths = [asset_root / f"synthetic-{i}" for i in range(2)]
    for index, path in enumerate(paths):
        path.write_bytes(bytes([65 + index]) * 128)
    with factory() as db:
        db.get(Conversation, sources[0]).display_title = "Synthetic 100x"
        db.get(Conversation, sources[0]).description_markdown = "BEFORE-DESCRIPTION"
        assets = [AssetObject(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), byte_size=128,
            storage_key=path.name, detected_mime_type="text/plain", scan_status="clean", status="available")
            for path in paths]
        db.add_all(assets)
        db.flush()
        attachment = Attachment(conversation_id=sources[0], asset_object_id=assets[0].id,
            original_filename="Report (100x) #1.txt", display_name="Report (100x) #1.txt", scan_status="clean")
        db.add(attachment)
        db.flush()
        messages = list(db.scalars(select(Message).where(Message.conversation_id == sources[0]).order_by(Message.order_key)))
        version = db.get(MessageVersion, messages[0].current_version_id)
        version.display_text += f"\n[Report](cr-asset://{attachment.id})"
        version.plain_text = version.display_text
        db.add(MessageVersionAttachment(message_version_id=version.id, attachment_id=attachment.id))
        notebook = ConversationNotebook(conversation_id=sources[0], subject_key=str(owners[0]),
            title="BEFORE-NOTEBOOK", blocks=[{"type": "markdown", "markdown": "BEFORE-NOTE"}])
        annotation = ConversationAnnotation(conversation_id=sources[0], subject_key=str(owners[0]),
            message_id=messages[0].id, message_version_id=version.id, comment_markdown="BEFORE-COMMENT")
        db.add_all([notebook, annotation])
        db.commit()
        return dict(factory=factory, root=root, owners=owners, sources=sources, paths=paths,
            assets=[a.id for a in assets], attachment=attachment.id, messages=[m.id for m in messages],
            notebook=notebook.id, annotation=annotation.id)


@pytest.fixture
def bundle_state(state, tmp_path, monkeypatch):
    yield prepare(state, tmp_path, monkeypatch)
    get_settings.cache_clear()


def queue(info, format="canjson_bundle"):
    with info["factory"]() as db:
        job = queue_conversation_export(db, conversation_id=info["sources"][0], idempotency_key=str(uuid.uuid4()),
            export_format=format, include_annotations=True, include_notebook=True, include_description=True,
            ownership_scope=OwnershipScope(info["owners"][0]))
        db.commit()
        return job.id


def assert_failed(info, identity, expected="failed"):
    with info["factory"]() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == expected, job.error_message
        assert db.query(ExportArtifact).count() == db.query(ConversationEvent).count() == 0
    assert not [p for p in info["root"].rglob("*") if p.is_file()]


@pytest.mark.parametrize("format", ["canjson_bundle", "markdown_bundle"])
def test_real_worker_bytes_checksums_and_filename(bundle_state, format):
    info = bundle_state
    identity = queue(info, format)
    run(info["factory"], identity)
    with info["factory"]() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "committed", job.error_message
        artifact = db.scalar(select(ExportArtifact))
        assert "100x" in artifact.filename
        assert artifact.retention_seconds == 180 and artifact.release_on_close
        assert hashlib.sha256(Path(artifact.storage_uri).read_bytes()).hexdigest() == artifact.sha256
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            if format == "canjson_bundle":
                manifest = json.loads(archive.read("manifest.json"))
                records = [json.loads(line) for line in archive.read("conversation.canjsonl").splitlines()]
                assert manifest["conversation"]["message_count"] == records[-1]["message_count"] == 2
                assert sum(r["record_type"] == "message" for r in records) == 2
                for path, meta in manifest["files"].items():
                    data = archive.read(path)
                    assert len(data) == meta["byte_size"]
                    assert hashlib.sha256(data).hexdigest() == meta["sha256"]
                attachment = next(r for r in records if r["record_type"] == "attachment")
                assert archive.read(attachment["object"]["path"]) == b"A" * 128
                assert attachment["object"]["sha256"] == hashlib.sha256(b"A" * 128).hexdigest()
                assert manifest["attachments"]["reference_count"] == 1
            else:
                attachment_path = "attachments/Report (100x) #1.txt"
                assert archive.read(attachment_path) == b"A" * 128
                body = archive.read("conversation.md").decode()
                assert f"[Report]({quote(attachment_path, safe='/')})" in body
                assert "cr-asset://" not in body
            assert archive.testzip() is None
        assert db.query(ConversationEvent).count() == 1
    assert not list(info["root"].rglob("*.tmp.*"))


@pytest.mark.parametrize("case", ["same_size_corruption", "growth", "write", "rename", "after_rename", "commit", "mkdir"])
def test_failure_has_no_partial_or_published_output(bundle_state, monkeypatch, case):
    info = bundle_state
    identity = queue(info)
    if case == "same_size_corruption":
        info["paths"][0].write_bytes(b"C" * 128)
    elif case == "growth":
        original = bundle._asset_chunks
        def grow(source, expected):
            source.write_bytes(b"A" * 129)
            yield from original(source, expected)
        monkeypatch.setattr(bundle, "_asset_chunks", grow)
    elif case == "write":
        def broken(source, expected):
            yield b"A" * 64
            raise OSError("synthetic interruption")
        monkeypatch.setattr(bundle, "_asset_chunks", broken)
    elif case in {"rename", "after_rename"}:
        original = bundle.publish_zip_artifact
        def fail(*args, **kwargs):
            if case == "after_rename":
                original(*args, **kwargs)
            raise OSError("synthetic publication failure")
        monkeypatch.setattr(bundle, "publish_zip_artifact", fail)
    elif case == "mkdir":
        def fail(*args, **kwargs):
            raise OSError("synthetic directory failure")
        monkeypatch.setattr(bundle, "staging_path", fail)
    else:
        @event.listens_for(info["factory"], "before_commit")
        def fail(db):
            if db.query(ExportArtifact).count():
                raise RuntimeError("synthetic commit failure")
    run(info["factory"], identity)
    assert_failed(info, identity)


@pytest.mark.parametrize("setting,value", [("bundle_max_expanded_bytes", 50), ("bundle_max_compressed_bytes", 50),
    ("bundle_max_object_bytes", 100), ("bundle_max_entries", 2), ("bundle_max_objects", 0),
    ("canjson_max_messages", 1), ("canjson_max_line_bytes", 10)])
def test_limits_fail_cleanly(bundle_state, monkeypatch, setting, value):
    info = bundle_state
    identity = queue(info)
    monkeypatch.setattr(get_settings(), setting, value)
    run(info["factory"], identity)
    assert_failed(info, identity)
    with info["factory"]() as db:
        assert db.get(BackgroundJob, identity).error_message == "ATTACHMENT_EXPORT_LIMIT"


def test_missing_asset_is_honest_partial_bundle(bundle_state):
    info = bundle_state
    info["paths"][0].unlink()
    identity = queue(info)
    run(info["factory"], identity)
    with info["factory"]() as db:
        assert db.get(BackgroundJob, identity).status == "committed"
        with zipfile.ZipFile(db.scalar(select(ExportArtifact)).storage_uri) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["asset_completeness"] == "partial"
            assert manifest["attachments"]["missing_object_count"] == 1
            records = [json.loads(line) for line in archive.read("conversation.canjsonl").splitlines()]
            attachment = next(r for r in records if r["record_type"] == "attachment")
            assert attachment["object"] is None and attachment["resolution_status"] == "missing"


def test_writer_interruption_closes_the_original_serializer(bundle_state, monkeypatch):
    info = bundle_state
    identity = queue(info)
    original = bundle.export_conversation_canjson_v2
    closed = []
    def export(*args, **kwargs):
        result = original(*args, **kwargs)
        source = iter(result.content)
        def wrapped():
            try:
                yield from source
            finally:
                source.close()
                closed.append(True)
        from dataclasses import replace
        return replace(result, content=wrapped())
    monkeypatch.setattr(bundle, "export_conversation_canjson_v2", export)
    def interrupt(self, archive):
        raise BackgroundJobCancelled("synthetic callback interruption")
    monkeypatch.setattr(bundle._WriteBudget, "check", interrupt)
    run(info["factory"], identity)
    assert_failed(info, identity, "cancelled")
    assert closed == [True]


def test_real_retry_expiry_and_regeneration_preserve_source_objects(bundle_state):
    from datetime import datetime, timedelta, timezone
    info = bundle_state
    identity = queue(info)
    info["paths"][0].write_bytes(b"C" * 128)
    run(info["factory"], identity)
    assert_failed(info, identity)
    info["paths"][0].write_bytes(b"A" * 128)
    with info["factory"]() as db:
        retry_background_job(db.get(BackgroundJob, identity))
        db.commit()
    run(info["factory"], identity)
    with info["factory"]() as db:
        assert db.get(BackgroundJob, identity).status == "committed"
        artifact = db.scalar(select(ExportArtifact))
        old_path = Path(artifact.storage_uri)
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        artifact_id = artifact.id
    reclaim_exports(info["factory"], info["root"])
    assert not old_path.exists()
    assert info["paths"][0].read_bytes() == b"A" * 128
    with info["factory"]() as db:
        replacement = regenerate_export(db, db.get(ExportArtifact, artifact_id), OwnershipScope(info["owners"][0]), "retry")
        db.commit()
        next_id = replacement.id
        assert next_id != identity
    run(info["factory"], next_id)
    with info["factory"]() as db:
        assert db.get(BackgroundJob, next_id).status == "committed"
        artifact = db.scalar(select(ExportArtifact).where(ExportArtifact.job_id == next_id))
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["asset_completeness"] == "complete"
        assert db.query(Attachment).count() == 1
        assert db.query(AssetObject).count() == 2


def test_copy_reads_bounded_chunks_and_rechecks_hash(bundle_state, monkeypatch):
    info = bundle_state
    source = info["paths"][0]
    original_open = Path.open
    read_sizes = []
    class Bounded:
        def __init__(self, handle): self.handle = handle
        def __enter__(self): return self
        def __exit__(self, *args): self.handle.close()
        def read(self, size):
            assert 0 < size <= 1024 * 1024
            read_sizes.append(size)
            return self.handle.read(size)
    def tracked(path, *args, **kwargs):
        handle = original_open(path, *args, **kwargs)
        return Bounded(handle) if path == source and args == ("rb",) else handle
    monkeypatch.setattr(Path, "open", tracked)
    identity = queue(info)
    run(info["factory"], identity)
    with info["factory"]() as db:
        assert db.get(BackgroundJob, identity).status == "committed"
    assert read_sizes
