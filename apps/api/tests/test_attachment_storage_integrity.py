from __future__ import annotations

from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import uuid

from app.core.database import get_db
from app.main import app
from app.models.attachment import AssetObject, Attachment
from app.models.conversation import Conversation
from app.services.assets.attachment_storage_integrity import audit_local_attachment_storage
from scripts import verify_attachment_storage
from test_import_preview_api import client  # noqa: F401


def test_local_attachment_storage_audit_accepts_a_coherent_object(client, tmp_path: Path) -> None:
    db, generator = _database()
    root = tmp_path / "assets"
    content = b"coherent attachment"
    storage_key = "objects/ab/coherent"
    _write(root / storage_key, content)
    try:
        conversation = _conversation()
        asset = _asset(storage_key, content)
        attachment = _attachment(conversation.id, asset.id)
        db.add_all([conversation, asset, attachment])
        db.commit()

        report = audit_local_attachment_storage(db, root, verify_sha256=True)

        assert report.clean is True
        assert report.complete is True
        assert report.scanned_asset_object_count == 1
        assert report.scanned_active_attachment_count == 1
        assert report.scanned_file_count == 1
        assert report.sha256_verified_count == 1
        assert report.issue_counts == {}
    finally:
        db.close()
        generator.close()


def test_local_attachment_storage_audit_reports_both_sides_without_touching_staging(client, tmp_path: Path) -> None:
    db, generator = _database()
    root = tmp_path / "assets"
    orphan = root / "objects" / "ff" / "orphan"
    ignored = root / "temp" / "active-upload.part"
    _write(orphan, b"orphan")
    _write(ignored, b"staging")
    try:
        conversation = _conversation()
        missing = _asset("objects/aa/missing", b"missing")
        mismatched = _asset("objects/bb/mismatched", b"expected")
        _write(root / mismatched.storage_key, b"different-size")
        invalid = _asset("../outside", b"invalid")
        unavailable = _asset("objects/cc/staging", b"staging")
        unavailable.status = "staging"
        technical = _asset("temp/published", b"published")
        _write(root / technical.storage_key, b"published")
        db.add_all([
            conversation,
            missing,
            mismatched,
            invalid,
            unavailable,
            technical,
            _attachment(conversation.id, missing.id),
            _attachment(conversation.id, unavailable.id),
            _attachment(conversation.id, None),
        ])
        db.commit()

        report = audit_local_attachment_storage(db, root)

        assert report.complete is True
        assert report.issue_counts == {
            "ACTIVE_ATTACHMENT_WITHOUT_ASSET_OBJECT": 1,
            "ACTIVE_ATTACHMENT_WITH_UNAVAILABLE_ASSET": 1,
            "AVAILABLE_ASSET_IN_TECHNICAL_STORAGE": 1,
            "ASSET_SIZE_MISMATCH": 1,
            "INVALID_STORAGE_KEY": 1,
            "MISSING_ASSET_FILE": 1,
            "ORPHAN_ASSET_FILE": 1,
        }
        assert ignored.is_file()
        assert orphan.is_file()
        assert db.query(AssetObject).count() == 5
        assert db.query(Attachment).count() == 3
    finally:
        db.close()
        generator.close()


def test_local_attachment_storage_sha_check_is_explicit_and_limits_fail_closed(client, tmp_path: Path) -> None:
    db, generator = _database()
    root = tmp_path / "assets"
    expected = b"expected"
    actual = b"altered!"
    assert len(expected) == len(actual)
    asset = _asset("objects/dd/same-size", expected)
    _write(root / asset.storage_key, actual)
    try:
        db.add(asset)
        db.commit()

        metadata_only = audit_local_attachment_storage(db, root)
        content_verified = audit_local_attachment_storage(db, root, verify_sha256=True)
        bounded = audit_local_attachment_storage(db, root, max_records=1, max_files=1)

        assert metadata_only.clean is True
        assert content_verified.issue_counts == {"ASSET_SHA256_MISMATCH": 1}
        assert content_verified.sha256_verified_count == 1
        assert bounded.complete is True

        second = _asset("objects/ee/second", b"second")
        _write(root / second.storage_key, b"second")
        db.add(second)
        db.commit()
        truncated = audit_local_attachment_storage(db, root, max_records=1, max_files=1)
        assert truncated.complete is False
        assert truncated.clean is False
    finally:
        db.close()
        generator.close()


def test_attachment_storage_cli_is_aggregate_by_default_and_fails_on_missing_file(
    client,
    tmp_path: Path,
    monkeypatch,
    capsys,
) -> None:
    db, generator = _database()
    root = tmp_path / "assets"
    content = b"cli attachment"
    asset = _asset("objects/12/cli-object", content)
    path = root / asset.storage_key
    _write(path, content)
    try:
        db.add(asset)
        db.commit()
        monkeypatch.setattr(
            verify_attachment_storage,
            "get_settings",
            lambda: SimpleNamespace(asset_storage_backend="local", asset_storage_dir=str(root)),
        )
        monkeypatch.setattr(verify_attachment_storage, "SessionLocal", lambda: nullcontext(db))

        monkeypatch.setattr("sys.argv", ["verify_attachment_storage"])
        assert verify_attachment_storage.main() == 0
        clean_payload = json.loads(capsys.readouterr().out)
        assert clean_payload["clean"] is True
        assert clean_payload["issue_count"] == 0
        assert "issues" not in clean_payload

        path.unlink()
        monkeypatch.setattr("sys.argv", ["verify_attachment_storage", "--include-identities"])
        assert verify_attachment_storage.main() == 1
        failed_output = capsys.readouterr().out
        failed_payload = json.loads(failed_output)
        assert failed_payload["clean"] is False
        assert failed_payload["issue_counts"] == {"MISSING_ASSET_FILE": 1}
        assert failed_payload["issues"][0]["storage_key"] == asset.storage_key
        assert str(root) not in failed_output
    finally:
        db.close()
        generator.close()


def _database():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _conversation() -> Conversation:
    return Conversation(
        id=uuid.uuid4(),
        title="Storage integrity fixture",
        display_title="Storage integrity fixture",
        source_type="test",
        source_profile="test",
        parser_version="test-v1",
    )


def _asset(storage_key: str, content: bytes) -> AssetObject:
    return AssetObject(
        id=uuid.uuid4(),
        sha256=hashlib.sha256(content).hexdigest(),
        byte_size=len(content),
        detected_mime_type="application/octet-stream",
        storage_backend="local",
        storage_key=storage_key,
        scan_status="clean",
        status="available",
    )


def _attachment(conversation_id: uuid.UUID, asset_id: uuid.UUID | None) -> Attachment:
    return Attachment(
        id=uuid.uuid4(),
        conversation_id=conversation_id,
        asset_object_id=asset_id,
        original_filename="fixture.bin",
        display_name="fixture.bin",
        status="available",
        scan_status="clean",
        source_type="test",
        resolution_status="resolved",
    )


def _write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
