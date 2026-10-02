"""Restore into a migrated PostgreSQL instance with real ownership and FK checks."""
import json
import os
import uuid
import zipfile
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.annotation import ConversationAnnotation, ConversationNotebook
from app.models.attachment import AssetObject, Attachment, MessageVersionAttachment
from app.models.auth import AuthPrincipal, AuthSession
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.project import Project
from app.models.reading_position import ReadingPosition
from app.models.user import User
from app.services.access import consume_password_reset, create_password_reset_grant
from app.services.assets.asset_store import get_asset_store
from app.services.auth import hash_password, verify_password
from app.services.exporting.system_archive import create_system_archive, restore_system_archive
from app.services.exporting.personal_archive import create_personal_archive
from test_import_profile_postgres import isolated_schema  # noqa: F401
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401

pytestmark = pytest.mark.skipif(os.environ.get("SETTINGS_POSTGRES_INTEGRATION") != "1", reason="requires disposable PostgreSQL")


def test_system_v5_restores_new_account_ownership_and_requires_password_reset(archive_db, isolated_schema, tmp_path, monkeypatch):
    users, conversations, job, _ = seed_archive_source(archive_db)
    users[1].role = "ADMIN"
    original_password = "synthetic old backup password"
    original_hash = hash_password(original_password)
    archive_db.add(AuthPrincipal(id=f"user:{users[0].id}", user_id=users[0].id, password_hash=original_hash))
    archive_db.add_all([
        ConversationAnnotation(subject_key=str(users[0].id), conversation_id=conversations[0].id, comment_markdown="Synthetic annotation"),
        ConversationNotebook(subject_key=str(users[0].id), conversation_id=conversations[0].id, title="Synthetic notebook"),
        ReadingPosition(subject_key=str(users[0].id), conversation_id=conversations[0].id),
    ])
    archive_db.commit()
    artifact = create_system_archive(archive_db, job_id=job.id, include_archived=True)
    archive_db.commit()
    with zipfile.ZipFile(artifact.storage_uri) as archive:
        identities = [json.loads(line) for line in archive.read("data/users.jsonl").splitlines()]
        assert len(identities) == 2
        assert original_hash.encode() not in archive.read("data/users.jsonl")
        assert not set(archive.namelist()).intersection({"data/auth_principals.jsonl", "data/auth_sessions.jsonl", "data/password_reset_grants.jsonl", "data/email_verification_grants.jsonl"})
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "target-assets"))
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    with Session(engine) as db:
        root = db.query(User).filter(User.role == "ADMIN").one()
        root_id = root.id
        principal = db.get(AuthPrincipal, "owner")
        if principal is None:
            principal = AuthPrincipal(id="owner", user_id=root_id, password_hash=hash_password("synthetic target administrator password"))
            db.add(principal); db.commit()
        root_hash = principal.password_hash
        result = restore_system_archive(db, Path(artifact.storage_uri), target_root_id=root_id)
        db.commit()
        assert result["users"] == 2 and result["conversations"] == 2
        restored_user = db.query(User).filter(User.normalized_email == users[0].normalized_email).one()
        assert restored_user.id != users[0].id
        assert db.get(Conversation, conversations[0].id).owner_user_id == restored_user.id
        assert db.get(Conversation, conversations[1].id).owner_user_id == root_id
        assert db.get(User, root_id).role == "ADMIN"
        assert db.get(AuthPrincipal, "owner").password_hash == root_hash
        assert all(row.owner_user_id in {root_id, restored_user.id} for row in db.query(Project))
        for model in (ConversationAnnotation, ConversationNotebook, ReadingPosition):
            assert db.query(model).one().subject_key == str(restored_user.id)
        assert db.query(AuthSession).count() == 0
        new_principal = db.query(AuthPrincipal).filter(AuthPrincipal.user_id == restored_user.id).one()
        assert not verify_password(new_principal.password_hash, original_password)
        token, _ = create_password_reset_grant(db, get_settings(), restored_user.id, actor_user_id=root_id)
        consume_password_reset(db, get_settings(), token, "synthetic recovered backup password")
        db.commit()
        assert verify_password(new_principal.password_hash, "synthetic recovered backup password")
        assert db.query(Message).count() == 1
        assert db.query(MessageVersion).count() == 2
        assert db.query(MessageVersionAttachment).count() == 1
        attachment = db.query(Attachment).one()
        asset = db.get(AssetObject, attachment.asset_object_id)
        assert get_asset_store().resolve_key(asset.storage_key).read_bytes() == b"synthetic attachment"


def test_personal_export_executes_scoped_subqueries_on_postgresql(isolated_schema, tmp_path, monkeypatch):
    for variable, directory in (("ASSET_STORAGE_DIR", "assets"), ("EXPORT_STORAGE_DIR", "exports")):
        monkeypatch.setenv(variable, str(tmp_path / directory))
    monkeypatch.setenv("ASSET_STORAGE_BACKEND", "local")
    get_settings.cache_clear()
    engine, migrate = isolated_schema; migrate("head")
    with Session(engine) as db:
        users, conversations, job, _ = seed_archive_source(db)
        # Cross the serialization batch boundary with real persisted messages.
        db.add_all([Message(conversation_id=conversations[0].id, role="assistant", order_key=f"b{index:04d}") for index in range(501)])
        db.commit()
        added = False
        def concurrent_edit(phase, *_):
            nonlocal added
            if phase == "serializing" and not added:
                added = True
                with Session(engine) as editor:
                    editor.add(Message(conversation_id=conversations[0].id, role="assistant", order_key="concurrent"))
                    editor.commit()
        artifact = create_personal_archive(db, job_id=job.id, owner_user_id=users[0].id, progress_callback=concurrent_edit)
        db.commit()
        with zipfile.ZipFile(artifact.storage_uri) as archive:
            messages = [json.loads(line) for line in archive.read("data/messages.jsonl").splitlines()]
            assert len(messages) == 502
            assert {row["conversation_id"] for row in messages} == {str(conversations[0].id)}
            exported = [json.loads(line) for line in archive.read("data/conversations.jsonl").splitlines()]
            assert [row["owner_user_id"] for row in exported] == [str(users[0].id)]
        assert added and db.query(Message).count() == 503


def test_system_configuration_restores_on_postgresql_with_real_foreign_keys(archive_db, isolated_schema, tmp_path, monkeypatch):
    from test_system_archive_configuration import configuration_source, bootstrap_target, assert_restored_configuration
    path, users = configuration_source(archive_db)
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "target-config-assets"))
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    with Session(engine) as db:
        root, original_hash = bootstrap_target(db)
        result = restore_system_archive(db, path, target_root_id=root)
        db.commit()
        assert result["system_skills"] > 0
        assert_restored_configuration(db, users, root, original_hash)


@pytest.mark.parametrize("outcome", ["rollback", "commit_failure"])
def test_system_configuration_and_assets_rollback_together(archive_db, isolated_schema, tmp_path, monkeypatch, outcome):
    from test_system_archive_configuration import configuration_source, bootstrap_target
    from app.models.import_profile import ImportProfile
    from app.models.administration import SystemSkill
    from app.models.user_preference import UserPreference
    path, _ = configuration_source(archive_db)
    engine, migrate = isolated_schema
    migrate("head")
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "rollback-config-assets"))
    get_settings.cache_clear()
    with Session(engine) as db:
        root, original_hash = bootstrap_target(db)
        original_skills = {row.id for row in db.query(SystemSkill)}
        restore_system_archive(db, path, target_root_id=root)
        stored = get_asset_store().resolve_key(db.query(AssetObject).one().storage_key)
        assert stored.is_file() and db.query(ImportProfile).count() == 1
        if outcome == "commit_failure":
            db.add_all([User(normalized_email="duplicate-system@example.test"), User(normalized_email="duplicate-system@example.test")])
            with pytest.raises(IntegrityError):
                db.commit()
        db.rollback()
        assert not stored.exists()
        assert db.query(Conversation).count() == db.query(ImportProfile).count() == 0
        assert db.query(User).count() == 1
        assert {row.id for row in db.query(SystemSkill)} == original_skills
        assert db.get(AuthPrincipal, "owner").password_hash == original_hash
        assert db.get(UserPreference, str(root)).theme_mode == "dark"
        assert db.get(UserPreference, str(root)).field_revisions["theme_mode"] == 7
