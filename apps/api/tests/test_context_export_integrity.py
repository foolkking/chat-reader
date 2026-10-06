"""Context-specific real ZIP, job and filesystem regressions; synthetic rows only."""
import hashlib
import json
import uuid
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import event, select

from app.core.config import get_settings
from app.models.attachment import AssetObject
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.user import User
from app.services.exporting import context_package as context
from app.services.ownership import OwnershipScope
from test_conversation_batch_export import state, run  # noqa: F401
from test_attachment_bundle import bundle_state, queue, assert_failed  # noqa: F401


def test_context_worker_delivers_actual_checksums_and_source(bundle_state):
    info = bundle_state
    identity = queue(info, "context_package")
    run(info["factory"], identity)
    with info["factory"]() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "committed", job.error_message
        artifact = db.scalar(select(ExportArtifact))
        assert artifact.filename == "Synthetic 100x.context.zip"
        assert artifact.retention_seconds == 180
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            records = [json.loads(line) for line in archive.read("conversation.canjsonl").splitlines()]
            assert manifest["conversation"]["message_count"] == records[-1]["message_count"] == 2
            for name, expected in manifest["files"].items():
                data = archive.read(name)
                assert len(data) == expected["byte_size"]
                assert hashlib.sha256(data).hexdigest() == expected["sha256"]
            assert next(row for row in records if row["record_type"] == "annotation")["comment_markdown"] == "BEFORE-COMMENT"
            assert next(row for row in records if row["record_type"] == "notebook")["content_markdown"] == "BEFORE-NOTE"
    assert not list(info["root"].rglob("*.tmp.*"))


@pytest.mark.parametrize("case", ["same_size", "write", "growth", "jsonl", "rename", "after_rename", "commit", "mkdir"])
def test_context_failure_removes_staging_and_published_files(bundle_state, monkeypatch, case):
    info = bundle_state
    identity = queue(info, "context_package")
    if case == "same_size":
        info["paths"][0].write_bytes(b"C" * 128)
    elif case in {"write", "growth"}:
        original = context._asset_chunks
        def fault(source, expected):
            if source == info["paths"][0]:
                if case == "growth":
                    source.write_bytes(b"A" * 129)
                else:
                    yield b"A" * 64
                    raise OSError("synthetic interrupted object")
            yield from original(source, expected)
        monkeypatch.setattr(context, "_asset_chunks", fault)
    elif case == "jsonl":
        original = Path.open
        class Broken:
            def __init__(self, handle): self.handle = handle
            def __enter__(self): return self
            def __exit__(self, *_): self.handle.close()
            def tell(self): return self.handle.tell()
            def write(self, data):
                self.handle.write(data[:8])
                raise OSError("synthetic partial JSONL write")
        def opening(path, *args, **kwargs):
            handle = original(path, *args, **kwargs)
            return Broken(handle) if path.name.startswith(".conversation.canjsonl.tmp.") and args == ("wb",) else handle
        monkeypatch.setattr(Path, "open", opening)
    elif case in {"rename", "after_rename"}:
        original = context.publish_zip_artifact
        def fail(*args, **kwargs):
            if case == "after_rename": original(*args, **kwargs)
            raise OSError("synthetic publication failure")
        monkeypatch.setattr(context, "publish_zip_artifact", fail)
    elif case == "mkdir":
        def fail(*args, **kwargs): raise OSError("synthetic directory failure")
        monkeypatch.setattr(context, "staging_path", fail)
    else:
        @event.listens_for(info["factory"], "before_commit")
        def fail(db):
            if db.query(ExportArtifact).count(): raise RuntimeError("synthetic commit failure")
    run(info["factory"], identity)
    assert_failed(info, identity)


@pytest.mark.parametrize("setting,value", [("bundle_max_expanded_bytes", 50), ("bundle_max_compressed_bytes", 50),
    ("bundle_max_object_bytes", 100), ("bundle_max_entries", 2), ("bundle_max_objects", 0),
    ("canjson_max_messages", 1), ("canjson_max_line_bytes", 10)])
def test_context_limits_are_enforced_without_output(bundle_state, monkeypatch, setting, value):
    info = bundle_state
    identity = queue(info, "context_package")
    monkeypatch.setattr(get_settings(), setting, value)
    run(info["factory"], identity)
    assert_failed(info, identity)
    with info["factory"]() as db:
        assert db.get(BackgroundJob, identity).error_message == "CONTEXT_EXPORT_LIMIT"


@pytest.mark.parametrize("change", ["disabled", "rejected", "asset_deleted", "asset_blocked", "owner_changed"])
def test_source_access_is_rechecked_at_publication(bundle_state, change):
    info = bundle_state
    with info["factory"]() as db:
        def revoke(phase, *_):
            if phase != "packaging_assets": return
            if change == "disabled": db.get(User, info["owners"][0]).status = "DISABLED"
            elif change == "rejected": db.get(User, info["owners"][0]).approval_status = "REJECTED"
            elif change == "asset_deleted": db.get(AssetObject, info["assets"][0]).status = "deleted"
            elif change == "asset_blocked": db.get(AssetObject, info["assets"][0]).scan_status = "infected"
            else: db.get(Conversation, info["sources"][0]).owner_user_id = info["owners"][1]
            db.flush()
        with pytest.raises(context.ContextPackageError, match="CONTEXT_EXPORT_(ACCOUNT|ASSET|SOURCE)_UNAVAILABLE"):
            context.create_context_package(db, conversation_id=info["sources"][0], job_id=uuid.uuid4(),
                scope_kind="full_conversation", start_message_id=None, progress_callback=revoke,
                subject_key=str(info["owners"][0]), ownership_scope=OwnershipScope(info["owners"][0]),
                output_directory=info["root"], record_artifact=False)
        db.rollback()
    assert not [p for p in info["root"].rglob("*") if p.is_file()]


def test_context_missing_object_remains_usable_raw_package(bundle_state):
    info = bundle_state
    info["paths"][0].unlink()
    identity = queue(info, "context_package")
    run(info["factory"], identity)
    with info["factory"]() as db:
        job = db.get(BackgroundJob, identity)
        assert job.status == "committed", job.error_message
        with zipfile.ZipFile(db.scalar(select(ExportArtifact)).storage_uri) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["asset_completeness"] == "partial"
            assert manifest["attachments"]["missing_object_count"] == 1
            assert not any(name.startswith("assets/") for name in archive.namelist())


def test_temporary_context_is_not_removed_by_session_close(bundle_state):
    info = bundle_state
    progress = []
    with info["factory"]() as db:
        artifact = context.create_context_package(db, conversation_id=info["sources"][0], job_id=uuid.uuid4(),
            scope_kind="full_conversation", start_message_id=None, subject_key=str(info["owners"][0]),
            output_directory=info["root"], record_artifact=False,
            progress_callback=lambda phase, percent, *_: progress.append((phase, percent)))
    assert {"serializing", "packaging", "packaging_assets", "publishing"} <= {phase for phase, _ in progress}
    percentages = [percent for _, percent in progress]
    assert percentages == sorted(percentages)
    assert Path(artifact.storage_uri).is_file()
    with zipfile.ZipFile(artifact.storage_uri) as archive: assert archive.testzip() is None


def test_reading_scope_limit_counts_selected_messages_and_preserves_sequence(bundle_state, monkeypatch):
    info = bundle_state
    monkeypatch.setattr(get_settings(), "canjson_max_messages", 1)
    with info["factory"]() as db:
        artifact = context.create_context_package(db, conversation_id=info["sources"][0], job_id=uuid.uuid4(),
            scope_kind="reading_scope", start_message_id=info["messages"][1], subject_key=str(info["owners"][0]),
            output_directory=info["root"], record_artifact=False)
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        records = [json.loads(line) for line in archive.read("conversation.canjsonl").splitlines()]
        assert manifest["scope"]["first_message_seq"] == manifest["scope"]["last_message_seq"] == 2
        assert manifest["conversation_completeness"] == "partial"
        assert manifest["attachments"]["reference_count"] == manifest["attachments"]["record_count"] == 0
        assert [row["seq"] for row in records if row["record_type"] == "message"] == [2]
        assert records[-1]["record_count"] == len(records)


@pytest.mark.parametrize("cancel", [False, True])
def test_large_source_streams_bodies_and_jsonl_and_cancels_without_residue(bundle_state, cancel):
    from app.services.background_jobs import BackgroundJobCancelled

    info = bundle_state
    body = "Synthetic bounded context. " * 1400
    with info["factory"]() as db:
        for index in range(600):
            message = Message(conversation_id=info["sources"][0], role="user", order_key=f"large-{index:06}")
            db.add(message)
            db.flush()
            version = MessageVersion(message_id=message.id, version_number=1, display_text=body,
                plain_text=body, content_hash=hashlib.sha256(body.encode()).hexdigest(), edit_type="manual")
            db.add(version)
            db.flush()
            message.current_version_id = version.id
        db.commit()
    observed = False
    with info["factory"]() as db:
        def progress(phase, _percent, processed, _total):
            nonlocal observed
            if phase != "serializing" or processed < 250:
                return
            observed = True
            retained = sum(len(row.display_text.encode()) for row in db.identity_map.values() if isinstance(row, MessageVersion))
            assert retained < 8 * 1024 * 1024
            # The real temporary JSONL already contains the exported prefix.
            paths = list(info["root"].rglob(".conversation.canjsonl.tmp.*"))
            assert len(paths) == 1
            assert paths[0].stat().st_size > 200 * len(body)
            if cancel:
                raise BackgroundJobCancelled("synthetic cancellation")
        arguments = dict(conversation_id=info["sources"][0], job_id=uuid.uuid4(), scope_kind="full_conversation",
            start_message_id=None, subject_key=str(info["owners"][0]), output_directory=info["root"],
            record_artifact=False, progress_callback=progress)
        if cancel:
            with pytest.raises(BackgroundJobCancelled):
                context.create_context_package(db, **arguments)
        else:
            artifact = context.create_context_package(db, **arguments)
    assert observed
    if cancel:
        assert not [p for p in info["root"].rglob("*") if p.is_file()]
    else:
        with zipfile.ZipFile(artifact.storage_uri) as archive, archive.open("conversation.canjsonl") as raw:
            count = 0
            for line in raw:
                row = json.loads(line)
                if row["record_type"] == "message":
                    count += 1
                    if row["order_key"].startswith("large-"):
                        assert row["current_version"]["content_markdown"] == body
            assert count == 602
