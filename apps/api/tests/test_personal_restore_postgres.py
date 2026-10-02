import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.archive_restore import ArchiveRestoreReceipt
from app.models.attachment import AssetObject, Attachment
from app.models.conversation import Conversation
from app.models.import_profile import ImportProfileGrant, ImportProfilePublication, ImportProfileRevision
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.reading_position import ReadingPosition
from app.models.user import User
from app.services.adaptive_import.profiles import match_profile
from app.services.assets.asset_store import get_asset_store
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from test_import_profile_postgres import isolated_schema, analysis_fixture  # noqa: F401
from test_personal_restore import restore_fixture
from test_system_archive_integrity import archive_db  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


@pytest.fixture
def personal_restore_target(archive_db, isolated_schema, tmp_path, monkeypatch):
    path, _, _, _ = restore_fixture(archive_db)
    preview = inspect_personal_archive(path)
    engine, migrate = isolated_schema; migrate("head")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "target-assets"))
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    with Session(engine) as db:
        owner = User(normalized_email="personal-target@example.test")
        db.add(owner); db.commit(); owner_id = owner.id
    return engine, path, preview["content_digest"], owner_id, migrate


def test_personal_restore_new_instance_has_real_foreign_keys_and_usable_formats(personal_restore_target):
    engine, path, digest, owner, _ = personal_restore_target
    with Session(engine) as db:
        result = restore_personal_archive(db, path, owner_user_id=owner, expected_digest=digest)
        db.commit()
    with Session(engine) as db:
        conversation = db.get(Conversation, uuid.UUID(result["conversation_ids"][0]))
        assert conversation.owner_user_id == owner
        message = db.query(Message).filter_by(conversation_id=conversation.id).one()
        version = db.get(MessageVersion, message.current_version_id)
        annotation = db.query(ConversationAnnotation).one()
        notebook = db.query(ConversationNotebook).one()
        position = db.query(ReadingPosition).one()
        assert annotation.message_id == message.id and annotation.message_version_id == version.id
        assert notebook.blocks[0]["annotation_id"] == str(annotation.id)
        assert position.anchor_data["current_version_id"] == str(version.id)
        attachment = db.query(Attachment).one()
        asset = db.get(AssetObject, attachment.asset_object_id)
        assert get_asset_store().resolve_key(asset.storage_key).read_bytes() == b"synthetic attachment"
        assert db.query(ArchiveRestoreReceipt).count() == 1
        grant = db.query(ImportProfileGrant).filter_by(user_id=owner).one()
        restored_revision = db.get(ImportProfileRevision, grant.revision_id)
        assert restored_revision.verification_summary["valid"] is False
        assert db.query(ImportProfilePublication).count() == 0
        assert match_profile(db, analysis_fixture(), [], owner_user_id=owner).status == "EXACT_MATCH"


def test_concurrent_personal_restore_is_one_atomic_import(personal_restore_target):
    engine, path, digest, owner, _ = personal_restore_target
    barrier = Barrier(2)
    def restore(_):
        with Session(engine) as db:
            barrier.wait(timeout=15)
            result = restore_personal_archive(db, path, owner_user_id=owner, expected_digest=digest)
            db.commit()
            return result
    with ThreadPoolExecutor(max_workers=2) as pool: results = list(pool.map(restore, range(2)))
    assert sorted(result["already_restored"] for result in results) == [False, True]
    assert results[0]["conversation_ids"] == results[1]["conversation_ids"]
    with Session(engine) as db:
        assert db.query(Conversation).filter_by(owner_user_id=owner).count() == 1
        assert db.query(Message).count() == 1
        assert db.query(MessageVersion).count() == 2
        assert db.query(ArchiveRestoreReceipt).count() == 1
        assert db.query(AssetObject).count() == 1


def test_outer_commit_failure_rolls_back_personal_restore_and_new_files(personal_restore_target):
    engine, path, digest, owner, _ = personal_restore_target
    with Session(engine) as db:
        restore_personal_archive(db, path, owner_user_id=owner, expected_digest=digest)
        db.add(User(normalized_email="personal-target@example.test"))
        with pytest.raises(IntegrityError): db.commit()
        db.rollback()
    with Session(engine) as db:
        assert db.query(Conversation).count() == 0
        assert db.query(ArchiveRestoreReceipt).count() == 0
        assert db.query(AssetObject).count() == 0
        assert db.query(ImportProfileRevision).count() == 0
    assert not [path for path in Path(get_settings().asset_storage_dir).rglob("*") if path.is_file()]


def test_restore_receipt_migration_round_trip(personal_restore_target):
    engine, _, _, _, migrate = personal_restore_target
    assert "archive_restore_receipts" in inspect(engine).get_table_names()
    migrate("20261001_0040", operation="downgrade")
    assert "archive_restore_receipts" not in inspect(engine).get_table_names()
    migrate("head")
    assert "archive_restore_receipts" in inspect(engine).get_table_names()
