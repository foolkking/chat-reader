"""Exporter output must remain readable under the same configured restore limits."""
import hashlib
import io
import uuid
import zipfile
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.models.export_artifact import ExportArtifact
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.assets.asset_store import get_asset_store
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from app.services.exporting.system_archive import SystemArchiveError, _validate_members, create_system_archive
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401


def export(db, job, owner, kind, **kwargs):
    if kind == "personal":
        return create_personal_archive(db, job_id=job.id, owner_user_id=owner, **kwargs)
    return create_system_archive(db, job_id=job.id, include_archived=True, **kwargs)


def repetitive_source(db):
    users, conversations, job, asset = seed_archive_source(db)
    text = "Synthetic repeated content. " * 6000
    version = db.query(MessageVersion).order_by(MessageVersion.version_number.desc()).first()
    version.plain_text = version.display_text = text
    payload = b"Synthetic repeated attachment. " * 6000
    get_asset_store().resolve_key(asset.storage_key).write_bytes(payload)
    asset.sha256, asset.byte_size = hashlib.sha256(payload).hexdigest(), len(payload)
    db.commit()
    return users, conversations, job, text, payload


@pytest.mark.parametrize("kind", ["personal", "system"])
def test_repetitive_content_exports_with_safe_ratio_and_unchanged_bytes(archive_db, kind):
    users, _, job, original, payload = repetitive_source(archive_db)
    artifact = export(archive_db, job, users[0].id, kind)
    archive_db.commit()
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        _validate_members(archive)
        assert archive.getinfo("data/message_versions.jsonl").compress_type == zipfile.ZIP_STORED
        asset = next(info for info in archive.infolist() if info.filename.startswith("assets/objects/"))
        assert asset.compress_type == zipfile.ZIP_STORED
        assert archive.read(asset) == payload
    if kind == "personal":
        preview = inspect_personal_archive(Path(artifact.storage_uri))
        result = restore_personal_archive(archive_db, Path(artifact.storage_uri), owner_user_id=users[1].id,
                                          expected_digest=preview["content_digest"])
        archive_db.commit()
        assert result["counts"]["conversations"] == 1
        message = archive_db.query(Message).filter_by(conversation_id=uuid.UUID(result["conversation_ids"][0])).one()
        assert archive_db.get(MessageVersion, message.current_version_id).display_text == original


@pytest.mark.parametrize("kind", ["personal", "system"])
@pytest.mark.parametrize("setting,value", [
    ("bundle_max_object_bytes", 10), ("bundle_max_objects", 0),
    ("bundle_max_entries", 3), ("bundle_max_expanded_bytes", 1000),
    ("bundle_max_compressed_bytes", 1000), ("canjson_max_line_bytes", 200),
])
def test_export_limit_failure_never_publishes_a_backup(archive_db, tmp_path, monkeypatch, kind, setting, value):
    users, _, job, _ = seed_archive_source(archive_db)
    monkeypatch.setattr(get_settings(), setting, value)
    with pytest.raises(SystemArchiveError, match="limit"):
        export(archive_db, job, users[0].id, kind)
    archive_db.rollback()
    assert archive_db.query(ExportArtifact).count() == 0
    assert not [path for path in (tmp_path / "exports").rglob("*") if path.is_file()]


def test_stored_repack_respects_upload_limit_and_cancellation(archive_db, tmp_path, monkeypatch):
    users, _, job, _, _ = repetitive_source(archive_db)
    monkeypatch.setattr(get_settings(), "bundle_max_compressed_bytes", 50_000)
    with pytest.raises(SystemArchiveError, match="limit"):
        export(archive_db, job, users[0].id, "personal")
    archive_db.rollback()
    monkeypatch.setattr(get_settings(), "bundle_max_compressed_bytes", 512 * 1024 * 1024)
    def cancel(phase, *_):
        if phase == "validating":
            raise InterruptedError("Synthetic cancellation during archive validation")
    with pytest.raises(InterruptedError):
        export(archive_db, job, users[0].id, "personal", progress_callback=cancel)
    archive_db.rollback()
    assert archive_db.query(ExportArtifact).count() == 0
    assert not [path for path in (tmp_path / "exports").rglob("*") if path.is_file()]


def test_restore_checks_compressed_bytes_and_object_count(monkeypatch):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as archive:
        archive.writestr("assets/objects/aa/synthetic", b"synthetic")
    monkeypatch.setattr(get_settings(), "bundle_max_compressed_bytes", len(data.getvalue()) - 1)
    with zipfile.ZipFile(data) as archive, pytest.raises(SystemArchiveError, match="upload size limit"):
        _validate_members(archive)
    monkeypatch.setattr(get_settings(), "bundle_max_compressed_bytes", len(data.getvalue()))
    monkeypatch.setattr(get_settings(), "bundle_max_objects", 0)
    with zipfile.ZipFile(data) as archive, pytest.raises(SystemArchiveError, match="object count limit"):
        _validate_members(archive)
