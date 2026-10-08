"""Real authenticated API/worker system restore, ownership review and retry paths."""
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core import auth_middleware
from app.core.config import get_settings
from app.models.administration import SystemBackupRecord
from app.models.archive_restore import ArchiveRestoreAccount, ArchiveRestoreReceipt
from app.models.background_job import BackgroundJob
from app.models.conversation import Conversation
from app.models.export_artifact import ExportArtifact
from app.models.project import Project
from app.models.user import User
from app.services.auth import ROOT_ADMIN_USER_ID
from app.services.background_jobs import claim_next_job, process_background_job
from test_auth import auth_client, owner_login  # noqa: F401
from test_admin_system import _normal_user_session
from test_system_archive_configuration import configuration_source
from test_system_archive_integrity import archive_db, archive_bytes  # noqa: F401


def run_job(job_id, kind):
    with auth_middleware.SessionLocal() as db:
        assert claim_next_job(db, job_type=kind) == uuid.UUID(job_id)
        db.commit()
    process_background_job(uuid.UUID(job_id), session_factory=auth_middleware.SessionLocal)


def upload(client, path, key=None):
    response = client.post("/api/system/archive/previews", headers={"Idempotency-Key": key or str(uuid.uuid4())},
        files={"file": ("synthetic-system.cr", path.read_bytes(), "application/octet-stream")})
    assert response.status_code == 202, response.text
    return response.json()


def preview(client, path):
    task = upload(client, path)
    assert client.get(f"/api/system/archive/previews/{task['job_id']}/accounts").status_code == 409
    run_job(task["job_id"], "system_archive_preflight")
    task = client.get(f"/api/tasks/{task['job_id']}").json()
    assert task["status"] == "committed", task
    assert task["result"]["artifact_available"] is True
    return task


def confirmation(client, task):
    review = client.get(f"/api/system/archive/previews/{task['job_id']}/accounts").json()
    return {"preview_job_id": task["job_id"], "content_digest": task["result"]["content_digest"], "ownership_revision": review["revision"]}


def test_system_archive_preview_restore_and_duplicate_receipt(auth_client, archive_db):
    path, users = configuration_source(archive_db)
    assert owner_login(auth_client).status_code == 200
    task = preview(auth_client, path)
    review = auth_client.get(f"/api/system/archive/previews/{task['job_id']}/accounts").json()
    assert review["total"] == 2 and review["unresolved"] == 0
    assert {row["decision"] for row in review["items"]} == {"ROOT", "NEW"}
    with auth_middleware.SessionLocal() as db:
        assert db.query(Conversation).count() == 0
        assert db.query(ArchiveRestoreAccount).count() == 2
        upload_artifact = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(task["job_id"])).one()
        assert auth_client.get(f"/api/exports/{upload_artifact.id}/download").status_code == 404
    payload = confirmation(auth_client, task)
    queued = auth_client.post("/api/system/archive/restores", json=payload)
    assert queued.status_code == 202, queued.text
    listed = auth_client.get("/api/system/archive/tasks").json()
    assert next(row for row in listed if row["job_id"] == queued.json()["job_id"])["result"]["parent_task_id"] == task["job_id"]
    assert auth_client.post("/api/system/archive/restores", json=payload).json()["job_id"] == queued.json()["job_id"]
    assert auth_client.delete(f"/api/system/archive/previews/{task['job_id']}").status_code == 409
    run_job(queued.json()["job_id"], "system_archive_restore")
    restored = auth_client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert restored["status"] == "committed", restored
    assert restored["result"]["counts"]["conversations"] == 2
    with auth_middleware.SessionLocal() as db:
        assert db.query(ArchiveRestoreReceipt).count() == 1
        assert db.query(SystemBackupRecord).one().status == "COMPLETED"
        restored_owner = db.query(User).filter_by(normalized_email=users[0].normalized_email).one()
        assert db.query(Conversation).filter_by(owner_user_id=restored_owner.id).count() == 1
    again = preview(auth_client, path)
    repeated = auth_client.post("/api/system/archive/restores", json=confirmation(auth_client, again))
    assert repeated.status_code == 202, repeated.text
    run_job(repeated.json()["job_id"], "system_archive_restore")
    result = auth_client.get(f"/api/tasks/{repeated.json()['job_id']}").json()
    assert result["status"] == "committed" and result["result"]["already_restored"]
    with auth_middleware.SessionLocal() as db:
        assert db.query(Conversation).count() == 2
        assert db.query(ArchiveRestoreReceipt).count() == 1
    assert auth_client.delete(f"/api/system/archive/previews/{task['job_id']}").status_code == 204
    assert auth_client.get(f"/api/tasks/{task['job_id']}").json()["result"]["artifact_available"] is False


def test_legacy_system_ownership_is_explicit_paginated_and_persistent(auth_client, tmp_path):
    assert owner_login(auth_client).status_code == 200
    sources = sorted(str(uuid.uuid4()) for _ in range(3))
    path = tmp_path / "legacy-system.cr"
    path.write_bytes(archive_bytes({"projects": [{"id": str(uuid.uuid4()), "owner_user_id": key,
        "name": "Synthetic legacy project", "is_default": False} for key in sources]}))
    task = preview(auth_client, path)
    url = f"/api/system/archive/previews/{task['job_id']}/accounts"
    first = auth_client.get(url, params={"limit": 2}).json()
    second = auth_client.get(url, params={"offset": 2, "limit": 2}).json()
    assert first["total"] == first["unresolved"] == 3
    assert len(first["items"]) == 2 and len(second["items"]) == 1
    assert auth_client.post("/api/system/archive/restores", json=confirmation(auth_client, task)).status_code == 409
    revision = first["revision"]
    for source in sources:
        response = auth_client.patch(f"{url}/{source}", json={"decision": "EXISTING", "target_user_id": str(ROOT_ADMIN_USER_ID), "base_revision": revision})
        assert response.status_code == 200, response.text
        revision = response.json()["revision"]
    assert auth_client.patch(f"{url}/{sources[0]}", json={"decision": "EXISTING", "target_user_id": str(ROOT_ADMIN_USER_ID), "base_revision": first["revision"]}).status_code == 409
    assert auth_client.get(url, params={"unresolved_only": True}).json()["items"] == []
    queued = auth_client.post("/api/system/archive/restores", json=confirmation(auth_client, task))
    assert queued.status_code == 202, queued.text
    run_job(queued.json()["job_id"], "system_archive_restore")
    result = auth_client.get(f"/api/tasks/{queued.json()['job_id']}").json()
    assert result["status"] == "committed", result
    with auth_middleware.SessionLocal() as db:
        projects = db.query(Project).all()
        assert len(projects) == 3 and len({row.name for row in projects}) == 3
        assert {row.owner_user_id for row in projects} == {ROOT_ADMIN_USER_ID}


def test_system_archive_all_entry_points_hide_from_normal_user(auth_client, archive_db):
    path, _ = configuration_source(archive_db)
    assert owner_login(auth_client).status_code == 200
    task = preview(auth_client, path)
    payload = confirmation(auth_client, task)
    _, token = _normal_user_session(auth_client)
    auth_client.cookies.set("chat_reader_session", token)
    auth_client.cookies.set("chat_reader_session_present", "1")
    for endpoint in ("capabilities", "tasks", "account-targets", f"previews/{task['job_id']}/accounts"):
        assert auth_client.get(f"/api/system/archive/{endpoint}").status_code == 404
    assert auth_client.post("/api/system/archive/previews", files={"file": ("synthetic.cr", path.read_bytes())}, headers={"Idempotency-Key": "denied"}).status_code == 404
    assert auth_client.post("/api/system/archive/restores", json=payload).status_code == 404
    assert auth_client.delete(f"/api/system/archive/previews/{task['job_id']}").status_code == 404
    assert auth_client.get(f"/api/tasks/{task['job_id']}").status_code == 404


def test_system_archive_upload_expiry_and_queue_admission(auth_client, archive_db):
    path, _ = configuration_source(archive_db)
    assert owner_login(auth_client).status_code == 200
    expired = preview(auth_client, path)
    with auth_middleware.SessionLocal() as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(expired["job_id"])).one()
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert auth_client.post("/api/system/archive/restores", json=confirmation(auth_client, expired)).status_code == 410
    admitted = preview(auth_client, path)
    queued = auth_client.post("/api/system/archive/restores", json=confirmation(auth_client, admitted))
    assert queued.status_code == 202
    with auth_middleware.SessionLocal() as db:
        artifact = db.query(ExportArtifact).filter_by(job_id=uuid.UUID(admitted["job_id"])).one()
        artifact.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    run_job(queued.json()["job_id"], "system_archive_restore")
    assert auth_client.get(f"/api/tasks/{queued.json()['job_id']}").json()["status"] == "committed"


def test_system_archive_corruption_and_cancel_retain_no_restored_data(auth_client, tmp_path):
    assert owner_login(auth_client).status_code == 200
    path = tmp_path / "corrupt.cr"
    path.write_bytes(b"not an archive")
    queued = upload(auth_client, path, "same-upload")
    assert upload(auth_client, path, "same-upload")["job_id"] == queued["job_id"]
    run_job(queued["job_id"], "system_archive_preflight")
    assert auth_client.get(f"/api/tasks/{queued['job_id']}").json()["status"] == "failed"
    assert auth_client.post(f"/api/tasks/{queued['job_id']}/retry").status_code == 200
    cancelled = auth_client.post(f"/api/tasks/{queued['job_id']}/cancel")
    assert cancelled.status_code == 200
    assert auth_client.delete(f"/api/system/archive/previews/{queued['job_id']}").status_code == 204
    with auth_middleware.SessionLocal() as db:
        assert db.query(Conversation).count() == db.query(ArchiveRestoreAccount).count() == 0
        assert db.query(ExportArtifact).count() == 0


def test_system_backup_duplicate_options_and_queued_cancel_update_records(auth_client):
    from app.models.administration import AdminAuditLog
    assert owner_login(auth_client).status_code == 200
    headers = {"Idempotency-Key": "cancel-system-export"}
    first = auth_client.post("/api/system/archive/exports", json={"include_archived": True}, headers=headers)
    assert first.status_code == 202
    repeated = auth_client.post("/api/system/archive/exports", json={"include_archived": True}, headers=headers)
    assert repeated.json()["job_id"] == first.json()["job_id"]
    assert auth_client.post("/api/system/archive/exports", json={"include_archived": False}, headers=headers).status_code == 409
    identity = first.json()["job_id"]
    assert auth_client.post(f"/api/tasks/{identity}/cancel").json()["status"] == "cancelled"
    assert auth_client.post(f"/api/tasks/{identity}/cancel").json()["status"] == "cancelled"
    with auth_middleware.SessionLocal() as db:
        assert db.query(SystemBackupRecord).one().status == "CANCELLED"
        assert db.query(AdminAuditLog).filter_by(action="SYSTEM_BACKUP_CANCELLED").count() == 1
        assert db.query(ExportArtifact).count() == 0
