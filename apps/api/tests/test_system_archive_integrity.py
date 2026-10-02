"""Synthetic archive corruption, bounded reads and historical attachment contracts."""
import hashlib
import io
import json
import stat
import uuid
import warnings
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.database import Base
from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.user import User
from app.services.assets.asset_store import LocalAssetStore, get_asset_store
from app.services.exporting.system_archive import (
    TABLE_MODELS, SystemArchiveError, _canonical_queries, _read_jsonl,
    _validate_members, create_system_archive, restore_system_archive,
)
from app.services.ownership import OwnershipScope
from app.services.exporting.archive_transaction import track_archive_object


@pytest.fixture
def archive_db(tmp_path, monkeypatch):
    for key, folder in (("EXPORT_STORAGE_DIR", "exports"), ("ASSET_STORAGE_DIR", "assets")):
        monkeypatch.setenv(key, str(tmp_path / folder))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    get_settings.cache_clear()
    engine = create_engine(f"sqlite:///{tmp_path / 'archive.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()
    get_settings.cache_clear()


def archive_bytes(rows=None, *, transform=None, assets=None):
    rows = rows or {}
    entries = {}
    declarations = []
    for name in TABLE_MODELS:
        path = f"data/{name}.jsonl"
        payload = b"".join((json.dumps(row) + "\n").encode() for row in rows.get(name, []))
        entries[path] = payload
        declarations.append({"path": path, "byte_size": len(payload), "sha256": hashlib.sha256(payload).hexdigest(), "record_count": len(rows.get(name, []))})
    manifest = {"format": "chat-reader-system-archive", "version": 4, "canonical_entries": declarations}
    entries.update(assets or {})
    if transform:
        transform(entries, manifest)
    entries["manifest.json"] = json.dumps(manifest).encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)
    return buffer.getvalue()


def attempt_restore(db, tmp_path, data):
    path = tmp_path / "synthetic.cr"
    path.write_bytes(data)
    try:
        result = restore_system_archive(db, path)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@pytest.mark.parametrize("fault", ["same_size_body", "record_count", "missing_table", "missing_checksum", "duplicate_json", "not_json", "invalid_manifest"])
def test_corrupt_canonical_data_is_rejected_before_any_restore(archive_db, tmp_path, fault):
    project = {"id": str(uuid.uuid4()), "name": "Synthetic", "is_default": False}
    def damage(entries, manifest):
        path = "data/projects.jsonl"
        declaration = next(entry for entry in manifest["canonical_entries"] if entry["path"] == path)
        if fault == "same_size_body": entries[path] = entries[path].replace(b"Synthetic", b"Tampering")
        if fault == "record_count": declaration["record_count"] += 1
        if fault == "missing_table": del entries[path]
        if fault == "missing_checksum": del declaration["sha256"]
        if fault in {"duplicate_json", "not_json"}:
            entries[path] = b'{"id":"first","id":"second"}\n' if fault == "duplicate_json" else b"not-json\n"
            declaration.update(byte_size=len(entries[path]), sha256=hashlib.sha256(entries[path]).hexdigest())
        if fault == "invalid_manifest": manifest["version"] = "invalid"
    with pytest.raises(SystemArchiveError):
        attempt_restore(archive_db, tmp_path, archive_bytes({"projects": [project]}, transform=damage))
    assert archive_db.query(Project).count() == 0
    assert archive_db.query(AssetObject).count() == 0
    assert not list((tmp_path / "assets" / "objects").rglob("*.*"))


@pytest.mark.parametrize("fault", ["same_size_body", "missing", "bad_path", "oversized"])
def test_corrupt_assets_are_rejected_before_rows_or_files(archive_db, tmp_path, fault):
    original = b"synthetic bytes"
    checksum = hashlib.sha256(original).hexdigest()
    entry = f"assets/objects/{checksum[:2]}/{checksum}"
    asset = {"id": str(uuid.uuid4()), "sha256": checksum, "byte_size": len(original), "archive_path": entry}
    files = {entry: original}
    if fault == "same_size_body": files[entry] = b"corrupted bytes"
    if fault == "missing": files = {}
    if fault == "bad_path": asset["archive_path"] = "data/projects.jsonl"
    if fault == "oversized": asset["byte_size"] = get_settings().bundle_max_object_bytes + 1
    with pytest.raises(SystemArchiveError):
        attempt_restore(archive_db, tmp_path, archive_bytes({"asset_objects": [asset]}, assets=files))
    assert archive_db.query(AssetObject).count() == 0
    assert not [p for p in (tmp_path / "assets").rglob("*") if p.is_file()]


@pytest.mark.parametrize("path", ["../payload", "/payload", "C:/payload", "data/../payload", "data//payload", "data\\payload"])
def test_unsafe_archive_paths_are_rejected(path):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        member = zipfile.ZipInfo("synthetic")
        member.filename = path  # Preserve raw backslashes even on Windows.
        archive.writestr(member, b"synthetic")
    with zipfile.ZipFile(data) as archive, pytest.raises(SystemArchiveError, match="unsafe path"):
        _validate_members(archive)


def test_duplicate_paths_and_symlinks_are_rejected():
    for symlink in (False, True):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as archive:
            member = zipfile.ZipInfo("manifest.json")
            if symlink: member.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(member, b"{}")
            if not symlink:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr("manifest.json", b"{}")
        with zipfile.ZipFile(data) as archive, pytest.raises(SystemArchiveError): _validate_members(archive)


def test_jsonl_read_is_bounded_before_materializing_line(monkeypatch):
    class Source(io.BytesIO):
        def readline(self, size=-1):
            assert size == 65
            return super().readline(size)
    class Archive:
        def open(self, _): return Source(b"x" * 1000)
    monkeypatch.setenv("CANJSON_MAX_LINE_BYTES", "64")
    get_settings.cache_clear()
    try:
        with pytest.raises(SystemArchiveError, match="oversized"): list(_read_jsonl(Archive(), "synthetic"))
    finally: get_settings.cache_clear()


def seed_archive_source(db):
    users = [User(normalized_email=f"backup-{i}@example.test") for i in range(2)]
    db.add_all(users); db.flush()
    conversations = [Conversation(owner_user_id=user.id, title="Synthetic", display_title="Synthetic", source_type="test", source_profile="test", parser_version="test") for user in users]
    db.add_all(conversations); db.flush()
    db.add_all([Project(owner_user_id=user.id, name="Empty project") for user in users])
    message = Message(conversation_id=conversations[0].id, role="assistant", order_key="a")
    db.add(message); db.flush()
    versions = [MessageVersion(message_id=message.id, version_number=i, plain_text="Synthetic", display_text="Synthetic", edit_type="test", content_hash="synthetic") for i in (1, 2)]
    db.add_all(versions); db.flush(); message.current_version_id = versions[1].id
    store = get_asset_store()
    staged = store.stage(io.BytesIO(b"synthetic attachment"), max_bytes=1024, quarantine=False)
    key = store.object_key(); store.promote(staged.path, key)
    asset = AssetObject(sha256=staged.sha256, byte_size=staged.byte_size, detected_mime_type="text/plain", storage_key=key, status="available")
    db.add(asset); db.flush()
    attachment = Attachment(conversation_id=conversations[0].id, asset_object_id=asset.id, original_filename="synthetic.txt", display_name="Synthetic", status="detached", deleted_at=users[0].created_at)
    db.add(attachment); db.flush()
    db.add(MessageVersionAttachment(message_version_id=versions[0].id, attachment_id=attachment.id))
    job = BackgroundJob(owner_user_id=users[0].id, job_type="system_archive_export", status="processing", phase="exporting", payload={}, result={})
    db.add(job); db.commit()
    return users, conversations, job, asset


def test_export_keeps_empty_projects_history_and_deleted_attachment_references(archive_db):
    users, conversations, job, _ = seed_archive_source(archive_db)
    rows = _canonical_queries(archive_db, include_archived=True, ownership_scope=OwnershipScope(users[0].id), subject_keys=[str(users[0].id)])
    assert [row.id for row in rows["conversations"]] == [conversations[0].id]
    assert rows["projects"].count() == 1
    artifact = create_system_archive(archive_db, job_id=job.id, include_archived=True)
    archive_db.commit()
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        assert len(list(_read_jsonl(archive, "data/projects.jsonl"))) == 2
        assert len(list(_read_jsonl(archive, "data/message_versions.jsonl"))) == 2
        attachments = list(_read_jsonl(archive, "data/attachments.jsonl"))
        assert len(attachments) == 1 and attachments[0]["deleted_at"] is not None
        assert len(list(_read_jsonl(archive, "data/attachment_occurrences.jsonl"))) == 1


def test_export_corrupt_asset_and_cancellation_leave_no_artifact_or_staging(archive_db, tmp_path):
    _, _, job, asset = seed_archive_source(archive_db)
    source = get_asset_store().resolve_key(asset.storage_key)
    source.write_bytes(b"x" * asset.byte_size)
    with pytest.raises(SystemArchiveError, match="checksum"):
        create_system_archive(archive_db, job_id=job.id, include_archived=True)
    archive_db.rollback()
    assert archive_db.query(ExportArtifact).count() == 0
    assert not [p for p in (tmp_path / "exports").rglob("*") if p.is_file()]
    source.write_bytes(b"synthetic attachment")
    def cancel(*_): raise InterruptedError("Synthetic cancellation")
    with pytest.raises(InterruptedError):
        create_system_archive(archive_db, job_id=job.id, include_archived=True, progress_callback=cancel)
    assert not [p for p in (tmp_path / "exports").rglob("*") if p.is_file()]


def test_asset_staging_cleans_partial_read_failure(tmp_path):
    class BrokenStream(io.BytesIO):
        def read(self, size=-1):
            if self.tell(): raise OSError("Synthetic interrupted input")
            return super().read(4)
    store = LocalAssetStore(tmp_path / "assets")
    with pytest.raises(OSError): store.stage(BrokenStream(b"synthetic bytes"), max_bytes=1024, quarantine=False)
    assert not list((tmp_path / "assets" / "temp").iterdir())


@pytest.mark.parametrize("outcome", ["commit", "rollback", "close", "commit_failure"])
def test_restore_assets_follow_outer_transaction_outcome(archive_db, tmp_path, outcome):
    data = b"synthetic asset for transaction"
    checksum = hashlib.sha256(data).hexdigest()
    entry = f"assets/objects/{checksum[:2]}/{checksum}"
    payload = {"id": str(uuid.uuid4()), "sha256": checksum, "byte_size": len(data), "detected_mime_type": "text/plain", "archive_path": entry, "status": "available"}
    path = tmp_path / "transaction.cr"
    path.write_bytes(archive_bytes({"asset_objects": [payload]}, assets={entry: data}))
    assert restore_system_archive(archive_db, path)["asset_objects"] == 1
    key = archive_db.query(AssetObject).one().storage_key
    stored = get_asset_store().resolve_key(key)
    assert stored.read_bytes() == data
    if outcome == "commit": archive_db.commit()
    if outcome == "rollback": archive_db.rollback()
    if outcome == "close": archive_db.close()
    if outcome == "commit_failure":
        archive_db.add_all([User(normalized_email="duplicate@example.test"), User(normalized_email="duplicate@example.test")])
        with pytest.raises(IntegrityError): archive_db.commit()
        archive_db.rollback()
    assert stored.exists() is (outcome == "commit")
    assert archive_db.query(AssetObject).count() == (1 if outcome == "commit" else 0)


def test_nested_archive_transaction_only_cleans_its_own_assets(archive_db):
    store = get_asset_store()
    def create_tracked():
        staged = store.stage(io.BytesIO(b"synthetic"), max_bytes=32, quarantine=False)
        key = store.object_key()
        track_archive_object(archive_db, store, key)
        return store.promote(staged.path, key)
    archive_db.begin()
    outer = create_tracked()
    nested = archive_db.begin_nested()
    inner = create_tracked()
    nested.rollback()
    assert outer.exists() and not inner.exists()
    archive_db.commit()
    assert outer.exists()
    archive_db.begin()
    nested = archive_db.begin_nested()
    transferred = create_tracked()
    nested.commit()
    assert transferred.exists()
    archive_db.rollback()
    assert not transferred.exists() and outer.exists()
