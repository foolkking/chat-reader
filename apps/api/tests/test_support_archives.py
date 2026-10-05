"""Private support history is portable; individual archives never grant privileges."""
import hashlib
import json
import uuid
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.models.background_job import BackgroundJob
from app.models.support_request import SupportMessage, SupportRequest, UserLimitOverride
from app.models.user import User
from app.services.exporting.archive_preflight import inspect_personal_archive
from app.services.exporting.personal_archive import create_personal_archive
from app.services.exporting.personal_restore import restore_personal_archive
from app.services.exporting.system_archive import create_system_archive, restore_system_archive
from test_system_archive_integrity import archive_db, seed_archive_source  # noqa: F401
from test_system_archive_configuration import bootstrap_target, configuration_target  # noqa: F401
from test_personal_restore import repack


def seed_support(db, owner, root, *, key="synthetic"):
    row = SupportRequest(owner_user_id=owner.id, kind="LIMIT", title="Synthetic request", status="APPROVED",
        requested_limits={"import_size_mb": 200}, approved_limits={"import_size_mb": 200},
        creation_key=key, creation_digest=hashlib.sha256(key.encode()).hexdigest())
    db.add(row); db.flush()
    message = SupportMessage(request_id=row.id, author_user_id=root.id, author_role="ADMIN", operation="APPROVE",
        body="Synthetic private reply", operation_key="approval", operation_digest="a" * 64, mail_state="SENDING", notification_attempts=1)
    db.add_all([message, UserLimitOverride(user_id=owner.id, import_size_mb=200, updated_by_user_id=root.id)])
    db.commit()
    return row


def test_personal_history_is_scoped_recoverable_and_never_reapproves(archive_db):
    db = archive_db
    users, _, job, _ = seed_archive_source(db)
    row = seed_support(db, users[0], users[1])
    artifact = create_personal_archive(db, job_id=job.id, owner_user_id=users[0].id)
    db.commit()
    with zipfile.ZipFile(artifact.storage_uri) as files:
        assert "data/user_limit_overrides.jsonl" not in files.namelist()
        stored = json.loads(files.read("data/support_messages.jsonl"))
        assert stored["author_user_id"] is None and stored["notification_job_id"] is None
        assert stored["mail_state"] == "UNKNOWN"
        assert str(users[1].id).encode() not in files.read("data/support_messages.jsonl")
    target = User(normalized_email="support-restored@example.test")
    db.add(target); db.commit()
    path = Path(artifact.storage_uri)
    digest = inspect_personal_archive(path)["content_digest"]
    count_jobs = db.query(BackgroundJob).count()
    restore_personal_archive(db, path, owner_user_id=target.id, expected_digest=digest)
    db.commit()
    restored = db.scalar(select(SupportRequest).where(SupportRequest.owner_user_id == target.id))
    assert restored.id != row.id and restored.status == "IMPORTED" and not restored.notify_replies
    assert restored.approved_limits == {"import_size_mb": 200}
    assert db.get(UserLimitOverride, target.id) is None
    restored_message = db.query(SupportMessage).filter_by(request_id=restored.id).one()
    assert restored_message.mail_state == "NOT_REQUESTED" and restored_message.notification_job_id is None
    count = db.query(SupportMessage).count()
    result = restore_personal_archive(db, path, owner_user_id=target.id, expected_digest=digest)
    db.commit()
    assert result["already_restored"] and db.query(SupportMessage).count() == count
    assert db.query(BackgroundJob).count() == count_jobs


def test_system_support_roundtrip_remaps_accounts_and_bounds_grants(archive_db, configuration_target, tmp_path, monkeypatch):
    source = archive_db
    users, _, job, _ = seed_archive_source(source)
    users[1].role = "ADMIN"
    row = seed_support(source, users[0], users[1])
    artifact = create_system_archive(source, job_id=job.id, include_archived=True)
    source.commit()
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "target-objects"))
    monkeypatch.setenv("IMPORT_GATEWAY_FILE_LIMIT_MB", "100")
    monkeypatch.setenv("MAX_IMPORT_FILE_SIZE_MB", "500")
    get_settings.cache_clear()
    root, _ = bootstrap_target(configuration_target)
    restore_system_archive(configuration_target, Path(artifact.storage_uri), target_root_id=root)
    configuration_target.commit()
    restored = configuration_target.get(SupportRequest, row.id)
    assert restored.owner_user_id != users[0].id
    grant = configuration_target.get(UserLimitOverride, restored.owner_user_id)
    assert grant.import_size_mb == 100 and grant.updated_by_user_id == root
    message = configuration_target.query(SupportMessage).filter_by(request_id=restored.id).one()
    assert message.author_user_id == root and message.mail_state == "NOT_REQUESTED"
    assert configuration_target.query(BackgroundJob).count() == 0


def test_old_personal_archive_without_extension_is_readable(archive_db, tmp_path):
    users, _, job, _ = seed_archive_source(archive_db)
    artifact = create_personal_archive(archive_db, job_id=job.id, owner_user_id=users[0].id)
    archive_db.commit()
    def legacy(files, manifest):
        manifest.pop("support_requests_version")
        removed = {"data/support_requests.jsonl", "data/support_messages.jsonl"}
        for name in removed:
            del files[name]
        manifest["canonical_entries"] = [row for row in manifest["canonical_entries"] if row["path"] not in removed]
    path = repack(artifact.storage_uri, tmp_path / "legacy.cr", legacy)
    assert inspect_personal_archive(path)["counts"]["conversations"] == 1
