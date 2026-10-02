import uuid

import pytest

from app.core.config import get_settings
from app.models.project import Project
from app.models.user import User
from app.services.exporting.system_archive import SystemArchiveError, restore_system_archive
from app.services.exporting.archive_accounts import restore_account_mapping
from test_system_archive_integrity import archive_db, archive_bytes  # noqa: F401


def test_legacy_archive_requires_explicit_ownership_mapping(archive_db, tmp_path, monkeypatch):
    root = User(role="ADMIN", normalized_email="target-root@example.test")
    archive_db.add(root); archive_db.commit()
    source = uuid.uuid4()
    path = tmp_path / "legacy.cr"
    path.write_bytes(archive_bytes({"projects": [{"id": str(uuid.uuid4()), "owner_user_id": str(source), "name": "Synthetic legacy project", "is_default": False}]}))
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    with pytest.raises(SystemArchiveError, match="explicit mapping") as error:
        restore_system_archive(archive_db, path, target_root_id=root.id)
    assert error.value.status_code == 409
    archive_db.rollback()
    assert archive_db.query(Project).count() == 0
    restored = restore_system_archive(archive_db, path, target_root_id=root.id, owner_mapping={str(source): str(root.id)})
    archive_db.commit()
    assert restored["projects"] == 1
    assert archive_db.query(Project).one().owner_user_id == root.id


def test_legacy_mapping_cannot_target_nonexistent_account(archive_db, tmp_path, monkeypatch):
    path = tmp_path / "legacy.cr"
    path.write_bytes(archive_bytes({"projects": [{"id": str(uuid.uuid4()), "owner_user_id": None, "name": "Unowned synthetic", "is_default": False}]}))
    monkeypatch.setenv("AUTH_ENABLED", "true")
    get_settings.cache_clear()
    with pytest.raises(SystemArchiveError, match="unavailable"):
        restore_system_archive(archive_db, path, owner_mapping={"unowned": str(uuid.uuid4())})
    archive_db.rollback()
    assert archive_db.query(Project).count() == 0


@pytest.mark.parametrize("status,approval,verification,can_login", [
    ("ACTIVE", "APPROVED", False, True),
    ("ACTIVE", "APPROVED", True, False),
    ("PENDING", "APPROVED", False, False),
    ("DISABLED", "APPROVED", False, False),
    ("ACTIVE", "REJECTED", False, False),
])
def test_restored_identity_keeps_all_login_requirements(archive_db, status, approval, verification, can_login):
    source = str(uuid.uuid4())
    mapping = restore_account_mapping(
        archive_db, identities=[{"id": source, "role": "USER", "status": status,
            "approval_status": approval, "email_verification_required": verification,
            "normalized_email": "restored-synthetic@example.test"}],
        referenced_owners={source}, target_root_id=None, owner_mapping=None, legacy=False,
    )
    archive_db.commit()
    restored = archive_db.get(User, mapping[source])
    assert restored.id != uuid.UUID(source)
    assert restored.status == status and restored.approval_status == approval
    assert restored.email_verification_required is verification
    assert restored.can_login is can_login
