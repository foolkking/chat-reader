import hashlib
import json
import uuid
import zipfile
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.archive_restore import ArchiveRestoreReceipt
from app.models.background_job import BackgroundJob
from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.import_profile import ImportProfileGrant, ImportProfilePublication, ImportProfileRevision
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.reading_position import ReadingPosition
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.user_skill import UserSkill
from app.services.assets.asset_store import get_asset_store
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from app.services.exporting.system_archive import SystemArchiveError
from test_personal_archive import seed_personal_data
from test_system_archive_integrity import archive_db  # noqa: F401


def restore_fixture(db):
    users, conversations, job = seed_personal_data(db)
    owner, conversation = users[0], conversations[0]
    message = db.query(Message).filter_by(conversation_id=conversation.id).one()
    attachment = db.query(Attachment).filter_by(conversation_id=conversation.id).one()
    attachment.status, attachment.deleted_at = "available", None
    version = db.get(MessageVersion, message.current_version_id)
    version.display_text = f"# Synthetic heading\n\nSynthetic answer [file](cr-asset://{attachment.id})."
    annotation = db.query(ConversationAnnotation).filter_by(subject_key=str(owner.id)).one()
    annotation.message_id, annotation.message_version_id = message.id, version.id
    annotation.quote, annotation.start_block_index, annotation.end_block_index = "Synthetic answer", 1, 1
    notebook = db.query(ConversationNotebook).filter_by(subject_key=str(owner.id)).one()
    notebook.blocks = [
        {"id": str(uuid.uuid4()), "type": "annotation_reference", "annotation_id": str(annotation.id)},
        {"id": str(uuid.uuid4()), "type": "markdown", "markdown": f"Synthetic [attachment](cr-asset://{attachment.id})"},
    ]
    position = db.query(ReadingPosition).filter_by(subject_key=str(owner.id)).one()
    position.message_id = message.id
    position.anchor_data = {"position_mode": "block-relative-v1", "current_version_id": str(version.id), "order_key": message.order_key, "ordinal": 0}
    db.commit()
    artifact = create_personal_archive(db, job_id=job.id, owner_user_id=owner.id)
    db.commit()
    target = User(normalized_email="restore-target@example.test")
    db.add(target); db.flush()
    db.add(Project(owner_user_id=target.id, name="Empty project", is_default=True))
    db.add(UserPreference(subject_key=str(target.id), theme_mode="light"))
    db.commit()
    return Path(artifact.storage_uri), target.id, conversation.id, attachment.id


def repack(path, destination, mutate=None):
    with zipfile.ZipFile(path) as source:
        files = {name: source.read(name) for name in source.namelist()}
    manifest = json.loads(files.pop("manifest.json"))
    if mutate: mutate(files, manifest)
    for entry in manifest["canonical_entries"]:
        data = files[entry["path"]]
        entry.update(byte_size=len(data), sha256=hashlib.sha256(data).hexdigest(), record_count=len(data.splitlines()))
    manifest["created_at"] = "2000-01-01T00:00:00Z"
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_STORED) as target:
        for name, data in reversed(list(files.items())): target.writestr(name, data)
        target.writestr("manifest.json", json.dumps(manifest))
    return destination


def test_personal_restore_adds_data_remaps_references_and_is_durable_idempotent(archive_db, tmp_path):
    path, owner, original_conversation, old_attachment = restore_fixture(archive_db)
    preview = inspect_personal_archive(path)
    assert preview["counts"]["conversations"] == 1 and not preview["include_preferences_default"]
    before_profile_versions = archive_db.query(ImportProfileRevision).count()
    result = restore_personal_archive(archive_db, path, owner_user_id=owner, expected_digest=preview["content_digest"])
    archive_db.commit()
    conversation = archive_db.get(Conversation, uuid.UUID(result["conversation_ids"][0]))
    assert conversation.id != original_conversation and conversation.owner_user_id == owner
    assert archive_db.get(Conversation, original_conversation) is not None
    message = archive_db.query(Message).filter_by(conversation_id=conversation.id).one()
    assert archive_db.query(MessageVersion).filter_by(message_id=message.id).count() == 2
    current = archive_db.get(MessageVersion, message.current_version_id)
    attachment = archive_db.query(Attachment).filter_by(conversation_id=conversation.id).one()
    assert attachment.id != old_attachment
    assert str(attachment.id) in current.display_text and str(old_attachment) not in current.display_text
    assert attachment.asset_object_id == archive_db.get(Attachment, old_attachment).asset_object_id
    annotation = archive_db.query(ConversationAnnotation).filter_by(conversation_id=conversation.id).one()
    notebook = archive_db.query(ConversationNotebook).filter_by(conversation_id=conversation.id).one()
    position = archive_db.query(ReadingPosition).filter_by(conversation_id=conversation.id).one()
    assert annotation.message_id == message.id and annotation.message_version_id == current.id
    assert notebook.blocks[0]["annotation_id"] == str(annotation.id)
    assert str(attachment.id) in notebook.blocks[1]["markdown"]
    assert position.message_id == message.id and position.anchor_data["current_version_id"] == str(current.id)
    assert {annotation.subject_key, notebook.subject_key, position.subject_key} == {str(owner)}
    assert archive_db.query(ImportProfileGrant).filter_by(user_id=owner).count() == 1
    assert archive_db.query(ImportProfileRevision).count() == before_profile_versions
    assert archive_db.query(ImportProfilePublication).count() == 0
    assert archive_db.query(UserSkill).filter_by(subject_key=str(owner)).count() == 1
    assert archive_db.get(UserPreference, str(owner)).theme_mode == "light"
    assert archive_db.query(Project).filter_by(owner_user_id=owner).count() == 2
    assert archive_db.query(Project).filter_by(owner_user_id=owner, is_default=True).count() == 1
    same_content = repack(path, tmp_path / "repacked.cr")
    assert inspect_personal_archive(same_content)["content_digest"] == preview["content_digest"]
    again = restore_personal_archive(archive_db, same_content, owner_user_id=owner,
        expected_digest=preview["content_digest"], include_preferences=True)
    archive_db.commit()
    assert again["already_restored"] and not again["preferences_imported"]
    assert again["conversation_ids"] == result["conversation_ids"]
    assert archive_db.query(ArchiveRestoreReceipt).count() == 1
    assert archive_db.query(Conversation).filter_by(owner_user_id=owner).count() == 1
    assert archive_db.get(UserPreference, str(owner)).theme_mode == "light"


def test_personal_restore_preferences_require_opt_in_and_advance_field_versions(archive_db):
    path, owner, _, _ = restore_fixture(archive_db)
    preview = inspect_personal_archive(path)
    restore_personal_archive(archive_db, path, owner_user_id=owner, expected_digest=preview["content_digest"], include_preferences=True)
    archive_db.commit()
    preference = archive_db.get(UserPreference, str(owner))
    assert preference.theme_mode == "dark"
    assert preference.field_revisions["theme_mode"] == 2


def test_missing_attachment_survives_restore_export_restore_without_false_completeness(archive_db, tmp_path):
    path, owner, _, _ = restore_fixture(archive_db)
    def missing(files, manifest):
        rows = [json.loads(line) for line in files["data/asset_objects.jsonl"].splitlines()]
        for row in rows:
            files.pop(row["archive_path"], None)
            row["archive_path"] = None
        files["data/asset_objects.jsonl"] = b"".join((json.dumps(row) + "\n").encode() for row in rows)
    source = repack(path, tmp_path / "missing.cr", missing)
    preview = inspect_personal_archive(source)
    result = restore_personal_archive(archive_db, source, owner_user_id=owner, expected_digest=preview["content_digest"])
    archive_db.commit()
    assert result["missing_assets"] == 1
    job = BackgroundJob(owner_user_id=owner, job_type="personal_archive_export")
    archive_db.add(job); archive_db.commit()
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=owner)
    archive_db.commit()
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert not manifest["assets"]["complete"]
        assert manifest["assets"]["unbacked_attachments"] == 1
    preview = inspect_personal_archive(Path(artifact.storage_uri))
    assert preview["missing_assets"] == preview["missing_attachments"] == 1
    result = restore_personal_archive(archive_db, Path(artifact.storage_uri), owner_user_id=owner, expected_digest=preview["content_digest"])
    archive_db.commit()
    attachment = archive_db.query(Attachment).filter_by(conversation_id=uuid.UUID(result["conversation_ids"][0])).one()
    assert attachment.asset_object_id is None and attachment.status == "missing"
    assert result["missing_assets"] == 1


def test_personal_restore_failure_rolls_back_new_data_preferences_and_files(archive_db, monkeypatch):
    path, owner, _, attachment_id = restore_fixture(archive_db)
    preview = inspect_personal_archive(path)
    asset = archive_db.get(AssetObject, archive_db.get(Attachment, attachment_id).asset_object_id)
    old_key = asset.storage_key
    get_asset_store().resolve_key(old_key).unlink()  # Only this test's synthetic asset.
    monkeypatch.setenv("ATTACHMENT_SCANNER", "disabled")
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    def fail(phase, *_):
        if phase == "publishing": raise InterruptedError("Synthetic restore interruption")
    with pytest.raises(InterruptedError):
        restore_personal_archive(archive_db, path, owner_user_id=owner, expected_digest=preview["content_digest"], include_preferences=True, progress_callback=fail)
    archive_db.commit()  # A caller can commit unrelated work; the failed restore is already rolled back.
    assert archive_db.query(ArchiveRestoreReceipt).count() == 0
    assert archive_db.query(Conversation).filter_by(owner_user_id=owner).count() == 0
    assert archive_db.query(Project).filter_by(owner_user_id=owner).count() == 1
    assert archive_db.get(UserPreference, str(owner)).theme_mode == "light"
    assert archive_db.get(AssetObject, asset.id).storage_key == old_key
    root = Path(get_settings().asset_storage_dir)
    assert not [item for item in root.rglob("*") if item.is_file()]
    restored = restore_personal_archive(archive_db, path, owner_user_id=owner, expected_digest=preview["content_digest"])
    archive_db.commit()
    assert not restored["already_restored"]
    assert archive_db.query(Conversation).filter_by(owner_user_id=owner).count() == 1


def test_missing_archive_bytes_cannot_claim_another_accounts_asset(archive_db, tmp_path):
    path, owner, _, attachment_id = restore_fixture(archive_db)
    original_asset = archive_db.get(Attachment, attachment_id).asset_object_id
    def remove_asset(files, _):
        records = [json.loads(line) for line in files["data/asset_objects.jsonl"].splitlines()]
        for row in records:
            del files[row["archive_path"]]; row["archive_path"] = None
        files["data/asset_objects.jsonl"] = b"".join((json.dumps(row) + "\n").encode() for row in records)
    missing = repack(path, tmp_path / "missing.cr", remove_asset)
    preview = inspect_personal_archive(missing)
    result = restore_personal_archive(archive_db, missing, owner_user_id=owner, expected_digest=preview["content_digest"])
    archive_db.commit()
    restored = archive_db.query(Attachment).filter_by(conversation_id=uuid.UUID(result["conversation_ids"][0])).one()
    assert preview["missing_assets"] == 1 and result["missing_assets"] == 1
    assert restored.asset_object_id is None and restored.status == "missing"
    assert archive_db.get(AssetObject, original_asset) is not None


@pytest.mark.parametrize("fault", ["reference", "mixed_owner", "skill_digest", "different_preview"])
def test_personal_restore_rejects_invalid_graph_and_changed_preview(archive_db, tmp_path, fault):
    path, owner, _, _ = restore_fixture(archive_db)
    original = inspect_personal_archive(path)
    def corrupt(files, _):
        table = "messages" if fault == "reference" else "conversations" if fault == "mixed_owner" else "skills"
        records = [json.loads(line) for line in files[f"data/{table}.jsonl"].splitlines()]
        if fault == "reference": records[0]["conversation_id"] = str(uuid.uuid4())
        if fault == "mixed_owner": records[0]["owner_user_id"] = str(uuid.uuid4())
        if fault == "skill_digest": records[0]["content"] = "Invalid synthetic replacement"
        files[f"data/{table}.jsonl"] = b"".join((json.dumps(row) + "\n").encode() for row in records)
    if fault != "different_preview": path = repack(path, tmp_path / "invalid.cr", corrupt)
    expected = "0" * 64 if fault == "different_preview" else original["content_digest"]
    with pytest.raises(SystemArchiveError):
        restore_personal_archive(archive_db, path, owner_user_id=owner, expected_digest=expected)
    archive_db.rollback()
    assert archive_db.query(Conversation).filter_by(owner_user_id=owner).count() == 0
    assert archive_db.query(ArchiveRestoreReceipt).count() == 0
