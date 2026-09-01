from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core import auth_middleware
from app.core.config import get_settings
from app.models.administration import AdminAuditLog, SystemBackupRecord
from app.models.attachment import AssetObject, Attachment
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.user import User
from app.services.auth import ROOT_ADMIN_USER_ID, issue_session, register_user
from app.services.background_jobs import claim_next_job, process_background_job
from app.services.user_deletion import queue_user_account_delete
from test_auth import auth_client, owner_login  # noqa: F401


def _normal_user_session(client: TestClient) -> tuple[uuid.UUID, str]:
    with auth_middleware.SessionLocal() as db:
        user, principal = register_user(
            db,
            f"normal-{uuid.uuid4()}@example.test",
            "normal user secure passphrase",
            display_name="Normal User",
        )
        token, _ = issue_session(db, principal, get_settings(), device_label="normal-test")
        return user.id, token


def test_root_feature_policies_are_audited_and_enforced(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    updated = auth_client.put(
        "/api/admin/features",
        json={
            "allow_share_links": False,
            "allow_user_skills": False,
            "allow_skill_import": False,
            "allow_user_import": False,
            "maximum_import_size_mb": 4,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["maximum_import_size_mb"] == 4

    skill = auth_client.post(
        "/api/skills",
        data={"category": "EXPORT_CONTEXT", "locale": "en", "name": "blocked"},
        files={"file": ("blocked.md", b"# blocked", "text/markdown")},
    )
    assert skill.status_code == 403
    imported = auth_client.post(
        "/api/imports/preview",
        files={"files": ("blocked.json", b"{}", "application/json")},
    )
    assert imported.status_code == 403

    audit = auth_client.get("/api/admin/audit?action=GLOBAL_FEATURE_CHANGED")
    assert audit.status_code == 200
    assert audit.json()[0]["metadata"]["changed_fields"]


def test_normal_user_cannot_reach_root_system_apis(auth_client: TestClient) -> None:
    normal_user_id, token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    auth_client.cookies.set("chat_reader_session_present", "1")
    for path in ("/api/admin/features", "/api/admin/system-skills", "/api/admin/backups", "/api/admin/audit"):
        assert auth_client.get(path).status_code == 404
    assert normal_user_id != ROOT_ADMIN_USER_ID


def test_system_skill_override_default_and_restore(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    listed = auth_client.get("/api/admin/system-skills")
    assert listed.status_code == 200
    bundled = next(
        row for row in listed.json()
        if row["category"] == "EXPORT_CONTEXT" and row["locale"] == "en" and row["source_kind"] == "BUNDLED"
    )
    overridden = auth_client.patch(
        f"/api/admin/system-skills/{bundled['id']}",
        json={"content": "# administrator override"},
    )
    assert overridden.status_code == 200, overridden.text
    assert overridden.json()["is_customized"] is True
    resolved = auth_client.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en").json()
    assert resolved["source"] == "BUILTIN"
    assert resolved["content"] == "# administrator override"

    custom = auth_client.post(
        "/api/admin/system-skills",
        json={
            "category": "EXPORT_CONTEXT",
            "locale": "en",
            "name": "Instance Export",
            "content": "# instance export",
            "default_enabled": True,
        },
    )
    assert custom.status_code == 201, custom.text
    resolved = auth_client.get("/api/skills/resolve?category=EXPORT_CONTEXT&locale=en").json()
    assert resolved["source"] == "SYSTEM"
    assert resolved["content"] == "# instance export"
    assert auth_client.delete(f"/api/admin/system-skills/{custom.json()['id']}").status_code == 204

    restored = auth_client.post(f"/api/admin/system-skills/{bundled['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["is_customized"] is False


def test_system_backup_queue_has_record_and_audit(auth_client: TestClient) -> None:
    assert owner_login(auth_client).status_code == 200
    queued = auth_client.post(
        "/api/admin/backups",
        json={"include_archived": True},
        headers={"Idempotency-Key": "admin-system-backup-fixture"},
    )
    assert queued.status_code == 202, queued.text
    records = auth_client.get("/api/admin/backups")
    assert records.status_code == 200
    assert records.json()[0]["background_job_id"] == queued.json()["job_id"]
    audit = auth_client.get("/api/admin/audit?action=SYSTEM_BACKUP")
    assert audit.status_code == 200
    assert audit.json()[0]["resource_type"] == "system_backup"


def test_user_deletion_job_preserves_shared_asset_and_removes_exclusive_asset(
    auth_client: TestClient,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert owner_login(auth_client).status_code == 200
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "assets"))
    get_settings.cache_clear()
    target_user_id, _ = _normal_user_session(auth_client)
    shared_id = uuid.uuid4()
    exclusive_id = uuid.uuid4()
    shared_path = tmp_path / "assets" / "objects" / "shared"
    exclusive_path = tmp_path / "assets" / "objects" / "exclusive"
    shared_path.parent.mkdir(parents=True, exist_ok=True)
    shared_path.write_bytes(b"shared")
    exclusive_path.write_bytes(b"exclusive")

    with auth_middleware.SessionLocal() as db:
        root_conversation = _conversation(ROOT_ADMIN_USER_ID, "Root")
        target_conversation = _conversation(target_user_id, "Target")
        db.add_all([root_conversation, target_conversation])
        db.flush()
        db.add_all([
            AssetObject(id=shared_id, sha256="1" * 64, byte_size=6, detected_mime_type="text/plain", storage_backend="local", storage_key="objects/shared", status="available", scan_status="clean"),
            AssetObject(id=exclusive_id, sha256="2" * 64, byte_size=9, detected_mime_type="text/plain", storage_backend="local", storage_key="objects/exclusive", status="available", scan_status="clean"),
        ])
        db.flush()
        db.add_all([
            _attachment(root_conversation.id, shared_id, "root-shared"),
            _attachment(target_conversation.id, shared_id, "target-shared"),
            _attachment(target_conversation.id, exclusive_id, "target-exclusive"),
        ])
        db.flush()
        job, _ = queue_user_account_delete(
            db,
            actor_user_id=ROOT_ADMIN_USER_ID,
            target_user_id=target_user_id,
            idempotency_key="delete-normal-user-fixture",
        )
        job_id = job.id
        db.commit()
        claimed = claim_next_job(db, job_type="user_account_delete", exclude_job_types=())
        assert claimed == job_id
        db.commit()

    process_background_job(job_id, session_factory=auth_middleware.SessionLocal)
    with auth_middleware.SessionLocal() as db:
        assert db.get(User, target_user_id) is None
        assert db.get(AssetObject, shared_id) is not None
        assert db.get(AssetObject, exclusive_id) is None
        assert db.get(BackgroundJob, job_id).status == "committed"
        assert db.query(SystemBackupRecord).count() == 0
        event = db.query(AdminAuditLog).filter(AdminAuditLog.action == "USER_DELETED").one()
        assert event.target_user_id == target_user_id
    assert shared_path.exists()
    assert not exclusive_path.exists()


def _conversation(owner_user_id: uuid.UUID, title: str) -> Conversation:
    return Conversation(
        owner_user_id=owner_user_id,
        title=title,
        display_title=title,
        source_type="manual",
        source_profile="manual",
        parser_version="test",
        message_count=0,
        turn_count=0,
    )


def _attachment(conversation_id: uuid.UUID, asset_id: uuid.UUID, source_id: str) -> Attachment:
    return Attachment(
        conversation_id=conversation_id,
        asset_object_id=asset_id,
        original_filename=f"{source_id}.txt",
        display_name=f"{source_id}.txt",
        detected_mime_type="text/plain",
        status="available",
        scan_status="clean",
        source_type="manual",
        source_attachment_id=source_id,
        resolution_status="resolved",
    )
